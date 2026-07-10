-- TICKET-150 — taste drill-in v2. Three fixes to fn_user_taste (TICKET-112):
--
-- 1. rating_histogram: sparse jsonb [{r, n}] of overall ratings snapped to the
--    nearest half star (clamped 0.5–5.0), for the Letterboxd-style histogram.
--    Server-side per TICKET-099 doctrine — never aggregate a base table
--    client-side.
-- 2. Cuisine junk filter: `restaurants.cuisine` is a humanized Google Places
--    primaryType, so generic VENUE types ("Restaurant", "Hotel") leak into the
--    cuisine rankings. Exclude them here — the fn caps the lists at 3, so a
--    client-side filter could never recover the real entries behind the junk.
-- 3. Disjoint bottom list: bottom_cuisines previously re-ranked the same pool,
--    so with ≤6 qualifying cuisines the two lists shared rows (top AND bottom
--    showed "Hotel 4.0"). Bottom now excludes anything already in the top —
--    empty when there's nothing distinct to say.
--
-- Return type changes (new column) → DROP + CREATE, not CREATE OR REPLACE.
-- Sole caller is the user-profile edge fn (action=taste), updated in the same
-- release.

DROP FUNCTION IF EXISTS public.fn_user_taste(uuid);

CREATE FUNCTION public.fn_user_taste(p_user_id uuid)
RETURNS TABLE (
    entry_count       integer,
    overall_avg       double precision,
    flavor_avg        double precision,
    flavor_n          integer,
    service_avg       double precision,
    service_n         integer,
    value_avg         double precision,
    value_n           integer,
    vibe_avg          double precision,
    vibe_n            integer,
    top_cuisines      jsonb,
    bottom_cuisines   jsonb,
    rating_histogram  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH rated AS (
        SELECT e.rating, e.flavor_rating, e.service_rating,
               e.value_rating, e.vibe_rating, r.cuisine
        FROM public.entries e
        LEFT JOIN public.restaurants r ON r.id = e.restaurant_id
        WHERE e.user_id = p_user_id
          AND e.rating IS NOT NULL
    ),
    cuisine_stats AS (
        SELECT cuisine,
               AVG(rating) AS avg_overall,
               COUNT(*)    AS n
        FROM rated
        WHERE cuisine IS NOT NULL AND btrim(cuisine) <> ''
          -- Generic Places venue types are not cuisines.
          AND lower(btrim(cuisine)) NOT IN (
              'restaurant', 'food', 'hotel', 'lodging', 'resort hotel',
              'meal takeaway', 'meal delivery', 'point of interest',
              'establishment', 'store', 'food court', 'event venue',
              'tourist attraction', 'market', 'shopping mall')
        GROUP BY cuisine
        HAVING COUNT(*) >= 2
    ),
    top_set AS (
        SELECT * FROM cuisine_stats
        ORDER BY avg_overall DESC, n DESC, cuisine ASC LIMIT 3
    ),
    bottom_set AS (
        SELECT * FROM cuisine_stats cs
        WHERE cs.cuisine NOT IN (SELECT ts.cuisine FROM top_set ts)
        ORDER BY avg_overall ASC, n DESC, cuisine ASC LIMIT 3
    ),
    top3 AS (
        SELECT jsonb_agg(jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall DESC, n DESC, cuisine ASC) AS arr
        FROM top_set
    ),
    bottom3 AS (
        SELECT jsonb_agg(jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall ASC, n DESC, cuisine ASC) AS arr
        FROM bottom_set
    ),
    hist AS (
        SELECT GREATEST(0.5, LEAST(5.0, round(rating * 2) / 2.0)) AS r,
               COUNT(*) AS n
        FROM rated
        GROUP BY 1
    ),
    hist_json AS (
        SELECT jsonb_agg(jsonb_build_object('r', r, 'n', n) ORDER BY r) AS arr
        FROM hist
    )
    SELECT
        COUNT(*)::int                                     AS entry_count,
        AVG(rated.rating)                                 AS overall_avg,
        AVG(rated.flavor_rating)                          AS flavor_avg,
        COUNT(rated.flavor_rating)::int                   AS flavor_n,
        AVG(rated.service_rating)                         AS service_avg,
        COUNT(rated.service_rating)::int                  AS service_n,
        AVG(rated.value_rating)                           AS value_avg,
        COUNT(rated.value_rating)::int                    AS value_n,
        AVG(rated.vibe_rating)                            AS vibe_avg,
        COUNT(rated.vibe_rating)::int                     AS vibe_n,
        COALESCE((SELECT arr FROM top3), '[]'::jsonb)     AS top_cuisines,
        COALESCE((SELECT arr FROM bottom3), '[]'::jsonb)  AS bottom_cuisines,
        COALESCE((SELECT arr FROM hist_json), '[]'::jsonb) AS rating_histogram
    FROM rated;
$$;

COMMENT ON FUNCTION public.fn_user_taste(uuid) IS
    'TICKET-150 (v2 of TICKET-112): per-category avg+count, overall avg, '
    'top/bottom cuisines (n>=2, generic venue types excluded, bottom disjoint '
    'from top, capped 3 each), and a half-star rating histogram — one row per '
    'user. Service-role only; the user-profile edge fn validates the JWT and '
    'enforces owner-only before calling.';

REVOKE ALL ON FUNCTION public.fn_user_taste(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_taste(uuid) TO service_role;
