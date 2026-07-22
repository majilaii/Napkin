-- Founder verdict (2026-07-22): any written note is a review.
-- The public-review eligibility floor moves from 20 trimmed characters to 1;
-- rating-only entries remain non-reviews. All other predicate terms stay fixed.
--
-- Six audited function bodies / source-copy slots:
--   1. is_entry_publicly_eligible
--   2. fn_public_eligible_entries (friends-feed helper)
--   3. fn_network_map_pins
--   4. can_view_entry (latest public Branch 4 definition)
--   5. fn_recently_active_public_authors (people candidates)
--   6. can_view_entry (supper-schema clone; superseded by the same latest body)
--
-- Bodies byte-identical except the floor (`>= 20` -> `>= 1`) and in-comment
-- references to that floor. Security posture, grants/revokes, and comments are
-- preserved from each latest source definition.

-- 1. is_entry_publicly_eligible
CREATE OR REPLACE FUNCTION is_entry_publicly_eligible(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM entries e
        JOIN profiles p ON p.user_id = e.user_id
        WHERE e.id = p_entry_id
          AND p.account_privacy = 'public'
          AND e.visibility <> 'private'
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 1
    );
$$;

-- 2. fn_public_eligible_entries (friends-feed helper)
CREATE OR REPLACE FUNCTION public.fn_public_eligible_entries(
    p_viewer      uuid,
    p_author_ids  uuid[],
    p_cursor_date timestamptz,
    p_cursor_id   uuid,
    p_limit       int
)
RETURNS TABLE (
    id                    uuid,
    user_id               uuid,
    restaurant_id         uuid,
    rating                double precision,
    content               text,
    visited_at            timestamptz,
    created_at            timestamptz,
    photo_url             text,
    public_reaction_count int,
    public_reply_count    int,
    public_top_emojis     jsonb,
    sort_date             timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH eligible AS (
        SELECT
            e.id,
            e.user_id,
            e.restaurant_id,
            e.rating,
            e.content,
            e.visited_at,
            e.created_at,
            e.photo_url,
            e.public_reaction_count,
            e.public_reply_count,
            e.public_top_emojis,
            COALESCE(e.visited_at, e.created_at) AS sort_date
        FROM public.entries e
        WHERE e.user_id = ANY(p_author_ids)
          -- diary base predicate (TICKET-092)
          AND e.restaurant_id IS NOT NULL
          AND e.visibility <> 'private'
          -- public-engagement gate, inlined — sync with is_entry_publicly_eligible
          -- (20260430000000). Keeps every feed card tappable + reactable.
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 1
          -- author account public (gates.ts public_only)
          AND public.fn_public_account(e.user_id)
          -- either-direction block denies (gates.ts fetchBlockState)
          AND NOT EXISTS (
              SELECT 1 FROM public.blocked_users b
              WHERE (b.blocker_id = p_viewer AND b.blocked_id = e.user_id)
                 OR (b.blocker_id = e.user_id AND b.blocked_id = p_viewer)
          )
    )
    SELECT id, user_id, restaurant_id, rating, content, visited_at, created_at,
           photo_url, public_reaction_count, public_reply_count, public_top_emojis,
           sort_date
    FROM eligible
    WHERE p_cursor_date IS NULL
       OR (sort_date, id) < (p_cursor_date, p_cursor_id)
    ORDER BY sort_date DESC, id DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_public_eligible_entries(uuid, uuid[], timestamptz, uuid, int) IS
    'TICKET-098: shared public-eligibility entry predicate + keyset page. Single '
    'source of truth for the friends feed; profile diary migrates onto it in a '
    'follow-up. Service-role only — the edge fn authenticates and passes p_viewer.';

REVOKE ALL ON FUNCTION public.fn_public_eligible_entries(uuid, uuid[], timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_eligible_entries(uuid, uuid[], timestamptz, uuid, int)
    TO service_role;

-- 3. fn_network_map_pins
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
    has_review    boolean,
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
        -- has_review: does the PRIMARY entry clear the public-engagement gate
        -- (is_entry_publicly_eligible: rating + >=1-char content)? Drives the
        -- peek tap route — true → the followee's review (entry-detail, viewAs
        -- public, which RLS + the is_entry_publicly_eligible pre-check both admit);
        -- false → the restaurant page (the thin/rating-only logs the looser
        -- diary/spots predicate deliberately includes but entry-detail can't show).
        (rk.rating IS NOT NULL
             AND char_length(trim(COALESCE(rk.content, ''))) >= 1) AS has_review,
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

-- 4. can_view_entry (latest public Branch 4 definition)
CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            -- Branch 1: Author.
            public.fn_user_authored_entry(e.id, auth.uid())

            -- Branch 2: Tablemate via entry_tables.
            OR EXISTS (
                SELECT 1
                FROM public.entry_tables et
                WHERE et.entry_id = e.id
                  AND public.is_table_member(et.table_id, auth.uid())
            )

            -- Branch 3: Companion (tagged presence overrides visibility='private').
            OR public.is_entry_companion(e.id, auth.uid())

            -- Branch 4: Public-eligible. Aligned with fn_public_eligible_entries
            -- (20260704120000). Was `e.visibility = 'public'` — DEAD, since the
            -- entries.visibility CHECK never permits 'public'. Now the real gate:
            -- non-private + restaurant + review content + public author account +
            -- no block either direction (block via SECDEF helper — blocked_users
            -- RLS only exposes the viewer's OWN blocks under INVOKER).
            OR (
                e.visibility <> 'private'
                AND e.restaurant_id IS NOT NULL
                AND e.rating IS NOT NULL
                AND char_length(trim(COALESCE(e.content, ''))) >= 1
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.user_id = e.user_id
                      AND p.account_privacy = 'public'
                )
                AND NOT public.fn_block_between_viewer(e.user_id)
            )

            -- Branch 5 (TICKET-082): supper. Viewer must be a member (gates read)
            -- AND the author must be a member (anti-injection). Membership comes
            -- only from is_supper_member (service-role-controlled), never from the
            -- client-writable supper_id alone.
            OR (
                e.supper_id IS NOT NULL
                AND public.is_supper_member(e.supper_id, auth.uid())
                AND public.is_supper_member(e.supper_id, e.user_id)
            )
        );
$$;

COMMENT ON FUNCTION public.can_view_entry(public.entries) IS
    'TICKET-124 (review fix): Branch 4 public gate repaired — dead '
    '`visibility = ''public''` (impossible per the entries.visibility CHECK) '
    'replaced with the real public predicate aligned with fn_public_eligible_entries '
    '(non-private + restaurant + rating + >=1-char content + public account + no '
    'block either direction via fn_block_between_viewer). Branches 1-3 and 5 '
    'unchanged from 20260615000200. Still SECURITY INVOKER.';

-- 5. fn_recently_active_public_authors (people candidates)
create or replace function public.fn_recently_active_public_authors(
    p_viewer      uuid,
    p_exclude_ids uuid[],
    p_limit       int default 8
)
returns table (
    author_id uuid,
    logs_30d  int
)
language sql
stable
security definer
set search_path = public
as $fn$
    select
        e.user_id as author_id,
        count(distinct e.restaurant_id)::int as logs_30d
    from public.entries e
    where e.created_at >= now() - interval '30 days'
      -- the friends-feed public-eligibility predicate, clause-for-clause
      and e.restaurant_id is not null
      and e.visibility <> 'private'
      and e.rating is not null
      and char_length(trim(coalesce(e.content, ''))) >= 1
      and public.fn_public_account(e.user_id)
      -- exclusions — ALL before the LIMIT
      and e.user_id <> p_viewer
      and e.user_id <> all (coalesce(p_exclude_ids, '{}'::uuid[]))
      and not exists (
          select 1 from public.follows f
          where f.follower_id = p_viewer and f.following_id = e.user_id
      )
      and not exists (
          select 1 from public.blocked_users b
          where (b.blocker_id = p_viewer and b.blocked_id = e.user_id)
             or (b.blocker_id = e.user_id and b.blocked_id = p_viewer)
      )
    group by e.user_id
    order by logs_30d desc, author_id asc
    limit p_limit;
$fn$;

comment on function public.fn_recently_active_public_authors(uuid, uuid[], int) is
    'TICKET-189: people-to-follow v2 second source — public authors with >=1 '
    'publicly-eligible log (restaurant_id NOT NULL + visibility<>private + '
    'rating + >=1-char note + public account) in 30d, minus self / follows / '
    'either-direction blocks / p_exclude_ids (co-diners), all BEFORE LIMIT. '
    'Returns (author_id, logs_30d), where logs_30d counts distinct restaurants. '
    'Service-role only; the user-profile '
    'edge fn authenticates and passes p_viewer.';

revoke all on function public.fn_recently_active_public_authors(uuid, uuid[], int)
    from PUBLIC, anon, authenticated;
grant execute on function public.fn_recently_active_public_authors(uuid, uuid[], int)
    to service_role;

-- 6. Supper-schema clone
-- The can_view_entry clone in 20260615000200 was superseded by
-- 20260707172000 and is covered by section 4; no duplicate emit is needed.
