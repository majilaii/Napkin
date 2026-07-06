-- TICKET-112 — taste drill-in. Aggregate the four secondary rating axes on
-- `entries` (flavor/service/value/vibe — 20260416000000) plus per-cuisine
-- overall averages, in ONE flat-SQL row. Per TICKET-099: never aggregate a
-- base table client-side; the whole computation lives here.
--
-- NULLs: per-entry axis values may be NULL; AVG/COUNT(col) exclude them, so
-- each axis reports the mean+count over ITS rated entries. Cuisine ranking
-- uses e.rating (overall) over rated entries, n>=2 to qualify.

CREATE OR REPLACE FUNCTION public.fn_user_taste(p_user_id uuid)
RETURNS TABLE (
    entry_count      integer,
    overall_avg      double precision,
    flavor_avg       double precision,
    flavor_n         integer,
    service_avg      double precision,
    service_n        integer,
    value_avg        double precision,
    value_n          integer,
    vibe_avg         double precision,
    vibe_n           integer,
    top_cuisines     jsonb,
    bottom_cuisines  jsonb
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
        GROUP BY cuisine
        HAVING COUNT(*) >= 2
    ),
    top3 AS (
        SELECT jsonb_agg(jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall DESC, n DESC, cuisine ASC) AS arr
        FROM (SELECT * FROM cuisine_stats
              ORDER BY avg_overall DESC, n DESC, cuisine ASC LIMIT 3) t
    ),
    bottom3 AS (
        SELECT jsonb_agg(jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall ASC, n DESC, cuisine ASC) AS arr
        FROM (SELECT * FROM cuisine_stats
              ORDER BY avg_overall ASC, n DESC, cuisine ASC LIMIT 3) b
    )
    SELECT
        COUNT(*)::int                                   AS entry_count,
        AVG(rated.rating)                               AS overall_avg,
        AVG(rated.flavor_rating)                        AS flavor_avg,
        COUNT(rated.flavor_rating)::int                 AS flavor_n,
        AVG(rated.service_rating)                       AS service_avg,
        COUNT(rated.service_rating)::int                AS service_n,
        AVG(rated.value_rating)                         AS value_avg,
        COUNT(rated.value_rating)::int                  AS value_n,
        AVG(rated.vibe_rating)                          AS vibe_avg,
        COUNT(rated.vibe_rating)::int                   AS vibe_n,
        COALESCE((SELECT arr FROM top3), '[]'::jsonb)   AS top_cuisines,
        COALESCE((SELECT arr FROM bottom3), '[]'::jsonb) AS bottom_cuisines
    FROM rated;
$$;

COMMENT ON FUNCTION public.fn_user_taste(uuid) IS
    'TICKET-112: per-category (flavor/service/value/vibe) avg+count, overall '
    'avg, and top/bottom cuisines (n>=2, capped 3) for one user, in a single '
    'row. NULL axis values excluded per-axis. Service-role only — the '
    'user-profile edge fn validates the JWT and enforces owner-only (v1) '
    'before calling. Public taste is a later ticket (TICKET-093 aggregate '
    'semantics).';

REVOKE ALL ON FUNCTION public.fn_user_taste(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_taste(uuid) TO service_role;
