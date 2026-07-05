-- TICKET-102 — always-visible rail: Google-rated fallback below the trending
-- floor.
--
-- The trending rail (TICKET-098) hides entirely below the k=3 floor, which is
-- honest but leaves a fresh, zero-friend user staring at nothing. Fix: below
-- the floor, DON'T lower the bar — SWITCH THE SOURCE. Mode 2 fills the rail from
-- restaurants ALREADY persisted in `restaurants`, ranked by their stored Google
-- rating. Wholly non-user-derived (one global list for everyone), so it caches
-- as a single row exactly like mode 1.
--
-- Mode 1 (fn_compute_trending / fn_get_trending, 20260704130000) is LOCKED and
-- byte-untouched by this migration — this file is CREATE OR REPLACE of two NEW
-- functions only. The fallback payload lives in the SAME `trending_cache` table
-- under a SECOND key (id='fallback') with its OWN advisory lock, so the two
-- payloads recompute independently and never contend.
--
-- Doctrine: Google rating is a SIBLING signal, never merged with a Napkin
-- number. The payload carries the raw google_rating + google_rating_count; the
-- card labels it "on Google". Quality floor (google_rating >= 4.3 AND
-- google_rating_count >= 100) keeps "worth a look" a credible claim on day one —
-- the exact day this mode is guaranteed to run — by excluding the 5.0-from-3-
-- reviews traps. Zero new Places API calls: stored columns only.

-- ── fn_compute_fallback — the (non-user-derived) fallback ranking ────────────
-- Source: restaurants already in `restaurants` passing the quality floor.
-- Rank: google_rating DESC, google_rating_count DESC, id ASC (deterministic).
-- Cap 10. No viewer param, no wishlist/follow/entry read — one global list.
-- neighborhood maps to restaurants.city, identical to fn_get_trending's mode-1
-- hydration (there is no neighborhood column), so the client card is source-
-- agnostic across both modes.
CREATE OR REPLACE FUNCTION public.fn_compute_fallback()
RETURNS TABLE (
    restaurant_id       uuid,
    name                text,
    cuisine             text,
    neighborhood        text,
    photo_url           text,
    google_rating       numeric,
    google_rating_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        r.id,
        r.name,
        r.cuisine,
        r.city AS neighborhood,
        r.photo_url,
        r.google_rating,
        r.google_rating_count
    FROM public.restaurants r
    WHERE r.google_rating IS NOT NULL
      AND r.google_rating_count IS NOT NULL
      -- quality floor — excludes 5.0-from-3-reviews traps so "worth a look" is credible
      AND r.google_rating >= 4.3
      AND r.google_rating_count >= 100
    ORDER BY r.google_rating DESC, r.google_rating_count DESC, r.id ASC
    LIMIT 10;
$$;

COMMENT ON FUNCTION public.fn_compute_fallback() IS
    'TICKET-102: fallback rail ranking. Restaurants already in `restaurants` '
    'passing the quality floor (google_rating>=4.3 AND google_rating_count>=100), '
    'ranked google_rating DESC, google_rating_count DESC, id ASC, cap 10. Zero '
    'user-derived data, zero new Places calls. neighborhood=city. Service-role only.';

REVOKE ALL ON FUNCTION public.fn_compute_fallback() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_fallback() TO service_role;

-- ── fn_get_fallback — dispatch-on-read cache dance (SECOND key) ──────────────
-- Mirrors fn_get_trending EXACTLY: the whole read → lock → re-check → compute →
-- upsert cycle lives in ONE transaction so the advisory xact lock covers the
-- write. DISTINCT key (id='fallback') + DISTINCT advisory lock
-- (hashtext('trending_cache:fallback')) so mode 1 and mode 2 recompute
-- independently and never block each other. lock_timeout (function SET clause)
-- bounds the pg_advisory_xact_lock wait — statement_timeout cannot re-arm
-- mid-call [ARCH-REVIEW-3 precedent]. Absolute floor: the payload is whatever
-- fn_compute_fallback returns (possibly []), which the edge fn + client re-gate;
-- an empty `restaurants` table (or nothing passing the floor) → [] → rail hides.
CREATE OR REPLACE FUNCTION public.fn_get_fallback(p_max_age_seconds int default 3600)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '8s'
AS $$
declare
    v_row     public.trending_cache%rowtype;
    v_payload jsonb;
begin
    -- Fast path: fresh cache, no lock taken.
    select * into v_row from public.trending_cache where id = 'fallback';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    -- Stale or missing: serialize recompute on the fallback-specific advisory lock.
    perform pg_advisory_xact_lock(hashtext('trending_cache:fallback'));

    -- Re-check — the winner may have refreshed while we blocked.
    select * into v_row from public.trending_cache where id = 'fallback';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    -- Compute; the payload is already hydrated (fn_compute_fallback selects the
    -- restaurant fields directly), so cached reads need zero joins.
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'restaurant_id',       f.restaurant_id,
                'name',                f.name,
                'cuisine',             f.cuisine,
                'neighborhood',        f.neighborhood,
                'photo_url',           f.photo_url,
                'google_rating',       f.google_rating,
                'google_rating_count', f.google_rating_count
            )
            order by f.google_rating desc, f.google_rating_count desc, f.restaurant_id asc
        ),
        '[]'::jsonb
    )
    into v_payload
    from public.fn_compute_fallback() f;

    insert into public.trending_cache as tc (id, payload, computed_at)
    values ('fallback', v_payload, now())
    on conflict (id) do update
        set payload = excluded.payload,
            computed_at = excluded.computed_at;

    return v_payload;
end;
$$;

COMMENT ON FUNCTION public.fn_get_fallback(int) IS
    'TICKET-102: read-through 1h fallback cache (trending_cache id=''fallback''). '
    'Second key + own advisory lock (hashtext(''trending_cache:fallback'')) so it '
    'recomputes independently of mode-1 trending; lock_timeout bounds the wait. '
    'Payload = fn_compute_fallback (may be []). Service-role only.';

REVOKE ALL ON FUNCTION public.fn_get_fallback(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_fallback(int) TO service_role;
