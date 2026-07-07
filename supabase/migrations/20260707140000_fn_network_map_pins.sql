-- TICKET-124 — network map pins.
--
-- fn_network_map_pins: the follow-graph fan-out of the single-user `spots`
-- surface (user-profile action=spots). Given a viewer, resolve their follow set
-- server-side (avoids the following_list 50-cap, mirrors fn_friends_feed),
-- filter the followees' entries by the DIARY/SPOTS (looser) visibility
-- predicate — the SAME predicate each followee's own /dining-map already
-- exposes (DECISION 1) — join `restaurants` for non-null coords, and collapse
-- to ONE row per restaurant carrying that restaurant's most-recent eligible log
-- (primary author + rating + note snippet + entry_id) plus a count of the OTHER
-- distinct followees who also logged it (others_count → "+N others" in the peek
-- card). Capped at 500 rows (mirror fetchSpots), ordered by most-recent network
-- activity.
--
-- Predicate = diary/spots (looser), intentionally NOT fn_public_eligible_entries
-- (the stricter feed gate). No rating/content requirement: the network map is
-- the union of maps you could already open one-by-one, so it carries the same
-- rows — the peek card degrades gracefully when a log has no note. Encodes:
--   • diary base: restaurant_id IS NOT NULL AND visibility <> 'private'
--     ('<>' excludes NULL visibility, matching .neq('visibility','private'))
--   • coords present: r.lat/r.lng NOT NULL
--   • author account public (fn_public_account — gates.ts public_only)
--   • no either-direction blocked_users row vs the viewer (gates.ts
--     fetchBlockState — any row, either direction, denies)
--
-- SECURITY DEFINER + service_role-only EXECUTE: the user-profile edge fn
-- validates the caller's JWT and passes auth.uid() as p_viewer. Only public,
-- non-private followee logs ever leave. Table context (entry_tables, table_id,
-- threads) is never read or returned. All referenced objects (follows, entries,
-- restaurants, blocked_users, fn_public_account) predate this migration, so the
-- LANGUAGE sql body replays from zero with no check_function_bodies toggle.
--
-- Index note: the hot path filters entries by author (entries(user_id)); same
-- posture as fn_friends_feed — fine at friends scale, revisit at scale.

CREATE OR REPLACE FUNCTION public.fn_network_map_pins(p_viewer uuid)
RETURNS TABLE (
    restaurant_id uuid,
    name          text,
    city          text,
    cuisine       text,
    lat           double precision,
    lng           double precision,
    author_id     uuid,
    entry_id      uuid,
    rating        double precision,
    note_snippet  text,
    others_count  int,
    sort_date     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH followees AS (
        SELECT f.following_id AS user_id
        FROM public.follows f
        WHERE f.follower_id = p_viewer
          -- self-exclusion is guaranteed by the follows CHECK
          -- (follower_id <> following_id); kept as defence in depth.
          AND f.following_id <> p_viewer
    ),
    eligible AS (
        SELECT
            e.id                                AS entry_id,
            e.user_id                           AS author_id,
            e.rating,
            e.content,
            r.id                                AS restaurant_id,
            r.name,
            r.city,
            r.cuisine,
            r.lat::double precision             AS lat,
            r.lng::double precision             AS lng,
            COALESCE(e.visited_at, e.created_at) AS sort_date
        FROM public.entries e
        JOIN public.restaurants r ON r.id = e.restaurant_id
        WHERE e.user_id IN (SELECT user_id FROM followees)
          -- diary/spots (looser) predicate — DECISION 1. No rating/content gate.
          AND e.restaurant_id IS NOT NULL
          AND e.visibility <> 'private'          -- <> excludes NULL, matches .neq
          AND r.lat IS NOT NULL AND r.lng IS NOT NULL
          AND public.fn_public_account(e.user_id) -- author account public
          AND NOT EXISTS (                        -- block, either direction
              SELECT 1 FROM public.blocked_users b
              WHERE (b.blocker_id = p_viewer AND b.blocked_id = e.user_id)
                 OR (b.blocker_id = e.user_id AND b.blocked_id = p_viewer)
          )
    ),
    -- Distinct authors per restaurant. A dedicated GROUP BY CTE, NOT a
    -- COUNT(DISTINCT ...) OVER () window — Postgres does not implement DISTINCT
    -- inside window functions (0A000), so the count is aggregated here and
    -- joined back into the primary-author row below.
    restaurant_authors AS (
        SELECT eligible.restaurant_id, COUNT(DISTINCT eligible.author_id) AS author_count
        FROM eligible
        GROUP BY eligible.restaurant_id
    ),
    ranked AS (
        SELECT eligible.*,
            ROW_NUMBER() OVER (PARTITION BY eligible.restaurant_id
                               ORDER BY eligible.sort_date DESC, eligible.entry_id DESC) AS rn
        FROM eligible
    )
    SELECT
        rk.restaurant_id,
        rk.name,
        rk.city,
        rk.cuisine,
        rk.lat,
        rk.lng,
        rk.author_id,
        rk.entry_id,
        rk.rating,
        NULLIF(left(trim(COALESCE(rk.content, '')), 140), '') AS note_snippet,
        (ra.author_count - 1)::int                            AS others_count,
        rk.sort_date
    FROM ranked rk
    JOIN restaurant_authors ra ON ra.restaurant_id = rk.restaurant_id
    WHERE rk.rn = 1                              -- primary author = most-recent log
    ORDER BY rk.sort_date DESC, rk.entry_id DESC
    LIMIT 500;
$$;

COMMENT ON FUNCTION public.fn_network_map_pins(uuid) IS
    'TICKET-124: network map pins — one row per restaurant logged by the '
    'viewer''s follow set (asymmetric), diary/spots (looser) predicate, blocks '
    'and private accounts excluded, primary author = most-recent log + '
    'others_count of other distinct followees. Cap 500. Service-role only — '
    'user-profile validates the JWT and passes p_viewer = auth.uid().';

REVOKE ALL ON FUNCTION public.fn_network_map_pins(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_network_map_pins(uuid) TO service_role;
