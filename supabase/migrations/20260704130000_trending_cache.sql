-- TICKET-098 Phase B — trending wishlist rail: cache table + locked algorithm.
--
-- Signal = wishlist INTENT only. No ratings, no Napkin score, no cross-Table
-- aggregate anywhere in this pipeline — counts of distinct savers are the only
-- number that leaves. Same aggregate trick as the shipped Table-wishlist
-- overlap counts; the k=3 floor is the k-anonymity guard (residual inference
-- at k=3 is founder-accepted).
--
-- Compute is dispatch-on-read with a 1h global cache row (TICKET-095 pattern —
-- no cron, no push). The aggregation reads ALL users' wishlist_items under
-- SECURITY DEFINER: wishlist RLS (own/Table rows only) is DELIBERATELY
-- bypassed for the aggregate. Invariant: only (restaurant fields + integer
-- counts) ever leave — raw wishlist rows and user ids never appear in any
-- payload. Deleted accounts cascade wishlist_items, so their saves drop out on
-- the next recompute (≤1h staleness accepted per AC).

-- ── 1. trending_cache — one global kv row ────────────────────────────────────
create table public.trending_cache (
    id          text primary key default 'global',
    payload     jsonb not null default '[]'::jsonb,
    computed_at timestamptz not null default now()
);

comment on table public.trending_cache is
    'TICKET-098: single global cached trending payload (id=''global''). '
    'Written/read only by fn_get_trending under service role. Deny-all RLS.';

-- [ARCH-REVIEW-6] RLS enabled with ZERO policies (deny-all) + privileges
-- revoked from anon/authenticated — service_role only. Without this PostgREST
-- would expose the table via the default grants.
alter table public.trending_cache enable row level security;
revoke all on table public.trending_cache from PUBLIC, anon, authenticated;
grant all on table public.trending_cache to service_role;

-- ── 2. fn_compute_trending — the locked algorithm ────────────────────────────
-- Event set: wishlist saves from the last 14 days, restaurant resolved
--   (import placeholders with restaurant_id IS NULL are not events yet).
-- One event per (user, restaurant): schema-enforced by the unique
--   (user_id, restaurant_id) index; the DISTINCT ON is defence in depth and
--   pins earliest-created_at deterministically if duplicates ever existed.
-- Weight: 0.5 when job_id IS NOT NULL (the import-batch marker — bulk intent
--   is diluted; job_id wins even for a manual save later linked to a batch),
--   else 1.0.
-- Score: Σ_days log2(1 + Σ day_weights) · 2^(−age_days/7) — 7-day half-life;
--   the per-day log2 damps same-day pile-ons. Day buckets are UTC dates.
-- Qualify: ≥3 DISTINCT savers in the last 7 days (k-floor window; also the
--   displayed "saved this week" integer).
-- Floor: fewer than 3 qualifying restaurants → return NOTHING (rail hidden;
--   a one-card rail advertises the ghost town).
-- Order: score DESC, then saver_count_7d DESC, then restaurant_id ASC
--   (deterministic ties). Cap 10.
create or replace function public.fn_compute_trending()
returns table (
    restaurant_id  uuid,
    score          double precision,
    saver_count_7d int
)
language sql
stable
security definer
set search_path = public
as $$
    with events as (
        select distinct on (w.user_id, w.restaurant_id)
            w.user_id,
            w.restaurant_id,
            w.created_at,
            (w.created_at at time zone 'UTC')::date as day,
            case when w.job_id is not null then 0.5 else 1.0 end as weight
        from public.wishlist_items w
        where w.restaurant_id is not null
          and w.created_at >= now() - interval '14 days'
        order by w.user_id, w.restaurant_id, w.created_at asc
    ),
    qualifying as (
        select e.restaurant_id, count(distinct e.user_id)::int as savers_7d
        from events e
        where e.created_at >= now() - interval '7 days'
        group by e.restaurant_id
        having count(distinct e.user_id) >= 3
    ),
    daily as (
        select e.restaurant_id, e.day, sum(e.weight) as day_weight
        from events e
        group by e.restaurant_id, e.day
    ),
    scored as (
        select
            d.restaurant_id,
            sum(
                log(2, (1 + d.day_weight)::numeric)::double precision
                * power(2, -((current_date - d.day)::double precision / 7.0))
            ) as score
        from daily d
        group by d.restaurant_id
    )
    select s.restaurant_id, s.score, q.savers_7d
    from scored s
    join qualifying q on q.restaurant_id = s.restaurant_id
    -- rail hides entirely below 3 qualifying restaurants
    where (select count(*) from qualifying) >= 3
    order by s.score desc, q.savers_7d desc, s.restaurant_id asc
    limit 10;
$$;

comment on function public.fn_compute_trending() is
    'TICKET-098: trending-by-wishlist-intent. 14d event set / 7d k-floor '
    '(>=3 distinct savers) / weight 0.5 for import-batch saves (job_id) / '
    'score = per-day log2(1+w) with 7d half-life / cap 10 / empty below 3 '
    'qualifiers. Aggregate counts only — never user ids.';

revoke all on function public.fn_compute_trending() from PUBLIC, anon, authenticated;
grant execute on function public.fn_compute_trending() to service_role;

-- ── 3. fn_get_trending — dispatch-on-read cache dance ────────────────────────
-- The entire read → lock → re-check → compute → hydrate → upsert cycle lives
-- in ONE transaction so the advisory xact lock actually covers the write.
-- [ARCH-REVIEW-3]: pg_advisory_xact_lock (NOT FOR UPDATE SKIP LOCKED — with
-- one global row the second reader would skip the only row and double-compute
-- or return nothing; the gather precedent locks a SET of work items). The
-- loser blocks on the lock, then re-reads the winner's fresh row.
-- Bounding the wait: lock_timeout (function SET clause) is what actually
-- bounds pg_advisory_xact_lock inside a single statement — statement_timeout
-- is consulted only at statement start and cannot re-arm mid-call.
create or replace function public.fn_get_trending(p_max_age_seconds int default 3600)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '8s'
as $$
declare
    v_row     public.trending_cache%rowtype;
    v_payload jsonb;
begin
    -- Fast path: fresh cache, no lock taken.
    select * into v_row from public.trending_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    -- Stale or missing: serialize recompute on a global advisory lock.
    perform pg_advisory_xact_lock(hashtext('trending_cache'));

    -- Re-check — the winner may have refreshed while we blocked.
    select * into v_row from public.trending_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    -- Compute + hydrate restaurant fields; store the hydrated payload so cached
    -- reads need zero joins. neighborhood maps to restaurants.city (closest
    -- real column — there is no neighborhood field in the schema).
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'restaurant_id',  t.restaurant_id,
                'name',           r.name,
                'cuisine',        r.cuisine,
                'neighborhood',   r.city,
                'photo_url',      r.photo_url,
                'saver_count_7d', t.saver_count_7d
            )
            order by t.score desc, t.saver_count_7d desc, t.restaurant_id asc
        ),
        '[]'::jsonb
    )
    into v_payload
    from public.fn_compute_trending() t
    join public.restaurants r on r.id = t.restaurant_id;

    insert into public.trending_cache as tc (id, payload, computed_at)
    values ('global', v_payload, now())
    on conflict (id) do update
        set payload = excluded.payload,
            computed_at = excluded.computed_at;

    return v_payload;
end;
$$;

comment on function public.fn_get_trending(int) is
    'TICKET-098: read-through 1h trending cache (global row). Advisory-xact-lock '
    'serialized recompute [ARCH-REVIEW-3]; loser re-reads winner''s row; '
    'lock_timeout bounds the wait. Service-role only.';

revoke all on function public.fn_get_trending(int) from PUBLIC, anon, authenticated;
grant execute on function public.fn_get_trending(int) to service_role;
