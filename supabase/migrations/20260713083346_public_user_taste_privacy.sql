-- Public Taste drill-in: add a visibility-scoped overload without removing the
-- existing owner-only fn_user_taste(uuid) contract. Deploying this migration
-- before the Edge Function is therefore backwards-compatible: the old Edge
-- build keeps calling the one-argument function, while the new build calls this
-- overload with p_include_private=true only for the authenticated owner.
--
-- SECURITY INVOKER is sufficient because the sole grantee/caller is
-- service_role, which already bypasses RLS. The user-profile Edge Function
-- authenticates the caller, applies the profile/block audience gate, and
-- chooses the privacy flag.

CREATE FUNCTION public.fn_user_taste(
    p_user_id uuid,
    p_include_private boolean
)
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
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH rated AS (
        SELECT e.rating, e.flavor_rating, e.service_rating,
               e.value_rating, e.vibe_rating, r.cuisine
        FROM public.entries e
        LEFT JOIN public.restaurants r ON r.id = e.restaurant_id
        WHERE e.user_id = p_user_id
          AND e.rating IS NOT NULL
          -- Public profile aggregates use the same fail-closed base predicate
          -- as diary / spots: NULL visibility is not publicly eligible.
          AND (p_include_private OR e.visibility <> 'private')
    ),
    cuisine_stats AS (
        SELECT cuisine,
               pg_catalog.avg(rating) AS avg_overall,
               pg_catalog.count(*)    AS n
        FROM rated
        WHERE cuisine IS NOT NULL AND pg_catalog.btrim(cuisine) <> ''
          AND pg_catalog.lower(pg_catalog.btrim(cuisine)) NOT IN (
              'restaurant', 'food', 'hotel', 'lodging', 'resort hotel',
              'meal takeaway', 'meal delivery', 'point of interest',
              'establishment', 'store', 'food court', 'event venue',
              'tourist attraction', 'market', 'shopping mall')
        GROUP BY cuisine
        HAVING pg_catalog.count(*) >= 2
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
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall DESC, n DESC, cuisine ASC) AS arr
        FROM top_set
    ),
    bottom3 AS (
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'cuisine', cuisine, 'avg', avg_overall, 'n', n)
               ORDER BY avg_overall ASC, n DESC, cuisine ASC) AS arr
        FROM bottom_set
    ),
    hist AS (
        SELECT GREATEST(0.5, LEAST(5.0, pg_catalog.round(rating * 2) / 2.0)) AS r,
               pg_catalog.count(*) AS n
        FROM rated
        GROUP BY 1
    ),
    hist_json AS (
        SELECT pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object('r', r, 'n', n) ORDER BY r
               ) AS arr
        FROM hist
    )
    SELECT
        pg_catalog.count(*)::int                           AS entry_count,
        pg_catalog.avg(rated.rating)                       AS overall_avg,
        pg_catalog.avg(rated.flavor_rating)                AS flavor_avg,
        pg_catalog.count(rated.flavor_rating)::int         AS flavor_n,
        pg_catalog.avg(rated.service_rating)               AS service_avg,
        pg_catalog.count(rated.service_rating)::int        AS service_n,
        pg_catalog.avg(rated.value_rating)                 AS value_avg,
        pg_catalog.count(rated.value_rating)::int          AS value_n,
        pg_catalog.avg(rated.vibe_rating)                  AS vibe_avg,
        pg_catalog.count(rated.vibe_rating)::int           AS vibe_n,
        COALESCE((SELECT arr FROM top3), '[]'::jsonb)      AS top_cuisines,
        COALESCE((SELECT arr FROM bottom3), '[]'::jsonb)   AS bottom_cuisines,
        COALESCE((SELECT arr FROM hist_json), '[]'::jsonb) AS rating_histogram
    FROM rated;
$$;

COMMENT ON FUNCTION public.fn_user_taste(uuid, boolean) IS
    'Visibility-scoped Taste aggregate. p_include_private=true is owner-only; '
    'false excludes visibility=private and NULL visibility. Security invoker, service-role only; '
    'the user-profile Edge Function validates JWT, blocks, and profile audience.';

REVOKE ALL ON FUNCTION public.fn_user_taste(uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_taste(uuid, boolean) TO service_role;
