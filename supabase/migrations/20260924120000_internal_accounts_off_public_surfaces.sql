-- TICKET-251: keep test, seed and persona content off the surfaces App Review sees.
--
-- A read-only production audit (2026-09-24) found the CI smoke account's two
-- "Smoke fixture" reviews and a "New User" card on Padella (the smoke test
-- restaurant), a second smoke account's invented TikTok clip in the For You
-- socials cache, and seeded demo / persona accounts repeating one review word
-- for word, all within a reviewer's first minute of guest browse.
--
-- scripts/smoke/ensure-fixtures.ts recreates the smoke reviews and forces the
-- smoke profile public on every deploy and every scheduled smoke, so deleting
-- or privatising that content does not hold. The fix lives in the read
-- predicates instead:
--
--   1. profiles.is_internal (default false). The two smoke accounts are flagged
--      by exact id. Internal accounts keep their content for themselves (self
--      paths such as the diary and reviews keyset walks read through
--      fn_user_diary_page with p_include_private, untouched here) and, for
--      saves, for other internal viewers. Guests and real users never see it.
--   2. Entries: is_entry_publicly_eligible (the single source of truth that the
--      restaurant review page and counts, the guest reads, can_recipient_view_
--      entry and the public reaction / comment policies already call) gains
--      AND NOT p.is_internal. Every public read that inlines its own copy of
--      the predicate gets the same clause: fn_public_eligible_entries,
--      fn_network_map_pins, can_view_entry (Branch 4), fn_recently_active_
--      public_authors, fn_visible_entry_ids (Branch 4), fn_friends_activity.
--   3. Saves: fn_restaurant_saves_visible (the doctrine surface every saves
--      read goes through, including the On Socials rail and the For You
--      socials viewer pass) hides an internal saver unless the viewer is
--      internal. fn_socials_viewer_pass LATERALs that predicate and needs no
--      change; the stage-1 candidate cache (fn_compute_socials_candidates,
--      deny-all grants, never client-visible un-re-gated) deliberately keeps
--      internal savers so the smoke user, itself internal, still sees the
--      second smoke account's clip.
--   4. Lists: fn_search_public_lists, fn_browse_public_lists (+ _with_cover_
--      credit), fn_saved_list_cards (its cover-credit wrapper delegates to it),
--      fn_restaurant_featured_lists and fn_guest_public_list exclude lists
--      owned by internal accounts.
--   5. Data: the four superseded demo accounts and the eight feed-fixture
--      persona accounts become account_privacy = 'private' (reversible, nothing
--      deleted). The current App Review demo pair (edf516b4, f2f4e458) is
--      guarded against by id and untouched.
--
-- Every redefinition starts from the function's latest body (the newest
-- migration wins) and changes only the predicate. Security posture (SECURITY
-- DEFINER / INVOKER, set search_path, revokes and grants) and block checks are
-- reproduced from those definitions. Two functions, is_entry_publicly_eligible
-- and can_view_entry, had search_path pinned afterwards by 20260907190000;
-- CREATE OR REPLACE resets function configuration, so the pin is restated in
-- their definitions here.
--
-- Replay-from-zero: the column add is idempotent; every function referenced
-- already exists earlier in the chain; the hardcoded ids do not exist on an
-- empty database, so the data step updates nothing there.
-- Contract spec: supabase/tests/internal_accounts.spec.sql (migration-replay).

-- ── 1. profiles.is_internal ──────────────────────────────────────────────────
alter table public.profiles
    add column if not exists is_internal boolean not null default false;

comment on column public.profiles.is_internal is
    'TICKET-251: true for CI smoke / test accounts. Their reviews are never '
    'publicly eligible and their saves, lists and people-search rows are hidden '
    'from non-internal viewers. Set only by migration, never by the app.';

-- ── 2. is_entry_publicly_eligible (latest body: 20260722215106) ─────────────
CREATE OR REPLACE FUNCTION is_entry_publicly_eligible(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE
-- search_path pin from 20260907190000, restated because CREATE OR REPLACE
-- resets function configuration.
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM entries e
        JOIN profiles p ON p.user_id = e.user_id
        WHERE e.id = p_entry_id
          AND p.account_privacy = 'public'
          AND NOT p.is_internal            -- TICKET-251: internal authors never public
          AND e.visibility <> 'private'
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 1
    );
$$;

-- ── 3. fn_public_eligible_entries (latest body: 20260722215106) ─────────────
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
          -- public-engagement gate, inlined: sync with is_entry_publicly_eligible
          -- (20260430000000). Keeps every feed card tappable + reactable.
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 1
          -- author account public (gates.ts public_only)
          AND public.fn_public_account(e.user_id)
          -- TICKET-251: internal (smoke / test) authors never surface publicly
          AND NOT EXISTS (
              SELECT 1 FROM public.profiles pi
              WHERE pi.user_id = e.user_id AND pi.is_internal
          )
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
    'follow-up. Service-role only: the edge fn authenticates and passes p_viewer.';

REVOKE ALL ON FUNCTION public.fn_public_eligible_entries(uuid, uuid[], timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_eligible_entries(uuid, uuid[], timestamptz, uuid, int)
    TO service_role;

-- ── 4. fn_network_map_pins (latest body: 20260722215106) ─────────────────────
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
          -- diary/spots (looser) predicate: DECISION 1. No rating/content gate.
          AND e.restaurant_id IS NOT NULL
          AND e.visibility <> 'private'          -- <> excludes NULL, matches .neq
          AND r.lat IS NOT NULL AND r.lng IS NOT NULL
          AND public.fn_public_account(e.user_id) -- author account public
          AND NOT EXISTS (                        -- TICKET-251: never an internal author
              SELECT 1 FROM public.profiles pi
              WHERE pi.user_id = e.user_id AND pi.is_internal
          )
          AND NOT EXISTS (                        -- block, either direction
              SELECT 1 FROM public.blocked_users b
              WHERE (b.blocker_id = p_viewer AND b.blocked_id = e.user_id)
                 OR (b.blocker_id = e.user_id AND b.blocked_id = p_viewer)
          )
    ),
    -- Distinct authors per restaurant. A dedicated GROUP BY CTE, NOT a
    -- COUNT(DISTINCT ...) OVER () window: Postgres does not implement DISTINCT
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
        -- peek tap route: true → the followee's review (entry-detail, viewAs
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
    'TICKET-124: network map pins: one row per restaurant logged by the '
    'viewer''s follow set (asymmetric), diary/spots (looser) predicate, blocks '
    'and private accounts excluded, primary author = most-recent log + '
    'others_count of other distinct followees. Cap 500. Service-role only: '
    'user-profile validates the JWT and passes p_viewer = auth.uid().';

REVOKE ALL ON FUNCTION public.fn_network_map_pins(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_network_map_pins(uuid) TO service_role;

-- ── 5. can_view_entry (latest body: 20260722215106) ──────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
-- search_path pin from 20260907190000, restated because CREATE OR REPLACE
-- resets function configuration.
SET search_path = public, pg_temp
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
            -- (20260704120000). Was `e.visibility = 'public'`: DEAD, since the
            -- entries.visibility CHECK never permits 'public'. Now the real gate:
            -- non-private + restaurant + review content + public author account +
            -- no block either direction (block via SECDEF helper: blocked_users
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
                      AND NOT p.is_internal      -- TICKET-251
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
    'TICKET-124 (review fix): Branch 4 public gate repaired: dead '
    '`visibility = ''public''` (impossible per the entries.visibility CHECK) '
    'replaced with the real public predicate aligned with fn_public_eligible_entries '
    '(non-private + restaurant + rating + >=1-char content + public account + no '
    'block either direction via fn_block_between_viewer). Branches 1-3 and 5 '
    'unchanged from 20260615000200. Still SECURITY INVOKER. TICKET-251: Branch 4 '
    'also requires NOT profiles.is_internal; search_path pin restated.';

-- ── 6. fn_recently_active_public_authors (latest body: 20260722215106) ───────
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
      -- TICKET-251: internal (smoke / test) authors are never people candidates
      and not exists (
          select 1 from public.profiles pi
          where pi.user_id = e.user_id and pi.is_internal
      )
      -- exclusions: ALL before the LIMIT
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
    'TICKET-189: people-to-follow v2 second source: public authors with >=1 '
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

-- ── 7. fn_visible_entry_ids (latest body: 20260826155643) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_visible_entry_ids(
    p_viewer uuid,
    p_entry_ids uuid[],
    p_require_content boolean DEFAULT true
)
RETURNS TABLE (entry_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $visible_entry_ids$
    SELECT e.id AS entry_id
    FROM public.entries e
    WHERE p_viewer IS NOT NULL
      AND e.id = ANY (COALESCE(p_entry_ids, ARRAY[]::uuid[]))
      AND (
          -- Branch 1: the author always sees their own entry.
          public.fn_user_authored_entry(e.id, p_viewer)

          OR (
              -- Unlike the older row predicate, blocks protect Table,
              -- companion, public-account, and Supper branches alike.
              NOT EXISTS (
                  SELECT 1
                  FROM public.blocked_users b
                  WHERE (b.blocker_id = p_viewer AND b.blocked_id = e.user_id)
                     OR (b.blocker_id = e.user_id AND b.blocked_id = p_viewer)
              )
              AND (
                  -- Branch 2: Tablemate via entry_tables.
                  EXISTS (
                      SELECT 1
                      FROM public.entry_tables et
                      WHERE et.entry_id = e.id
                        AND public.is_table_member(et.table_id, p_viewer)
                  )

                  -- Branch 3: tagged companion.
                  OR public.is_entry_companion(e.id, p_viewer)

                  -- Branch 4: public-account entry. Photo rails keep exact
                  -- can_view_entry content parity; rating aggregates opt out
                  -- because silent ratings are still valid palate signals.
                  OR (
                      e.visibility <> 'private'
                      AND e.restaurant_id IS NOT NULL
                      AND e.rating IS NOT NULL
                      AND (
                          NOT COALESCE(p_require_content, true)
                          OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(e.content, ''))) >= 1
                      )
                      AND EXISTS (
                          SELECT 1
                          FROM public.profiles p
                          WHERE p.user_id = e.user_id
                            AND p.account_privacy = 'public'
                            AND NOT p.is_internal      -- TICKET-251
                      )
                  )

                  -- Branch 5: both viewer and author belong to the Supper.
                  OR (
                      e.supper_id IS NOT NULL
                      AND public.is_supper_member(e.supper_id, p_viewer)
                      AND public.is_supper_member(e.supper_id, e.user_id)
                  )
              )
          )
      );
$visible_entry_ids$;

COMMENT ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean) IS
    'TICKET-217 service-role batch counterpart to can_view_entry: returns only '
    'requested entries visible to p_viewer, with bidirectional blocks enforced '
    'across every non-author branch. p_require_content defaults true for exact '
    'can_view_entry photo parity; rating aggregates pass false so silent ratings '
    'remain valid. Keep the remaining five-branch predicate synchronized.';

REVOKE ALL ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean) TO service_role;

-- ── 8. fn_friends_activity (latest body: 20260905184134) ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_friends_activity(
    p_viewer uuid, p_cursor_date timestamptz, p_cursor_key text, p_limit int
)
RETURNS TABLE (activity_key text, kind text, sort_date timestamptz, payload jsonb)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    WITH actors AS MATERIALIZED (
        SELECT p.user_id, p.account_privacy
        FROM public.profiles p
        WHERE p_viewer IS NOT NULL AND (
            p.user_id = p_viewer OR (
                EXISTS (SELECT 1 FROM public.follows f
                    WHERE f.follower_id = p_viewer AND f.following_id = p.user_id)
                AND p.account_privacy = 'public'
                AND NOT p.is_internal      -- TICKET-251: followed internal accounts stay hidden
                AND NOT EXISTS (SELECT 1 FROM public.blocked_users b
                    WHERE (b.blocker_id = p_viewer AND b.blocked_id = p.user_id)
                       OR (b.blocker_id = p.user_id AND b.blocked_id = p_viewer))
            )
        )
    ), candidates AS (
        SELECT 'entry:' || e.id AS activity_key, 'entry'::text AS kind,
               e.created_at AS sort_date, e.id AS source_id, e.user_id
        FROM public.entries e JOIN actors a ON a.user_id = e.user_id
        WHERE e.restaurant_id IS NOT NULL
          AND (e.user_id = p_viewer OR (
              e.visibility <> 'private' AND e.rating IS NOT NULL
              -- Match the current public-review floor (20260722215106): any written note.
              AND char_length(trim(COALESCE(e.content, ''))) >= 1
          ))
        UNION ALL
        SELECT 'pin:' || w.id, 'pin', w.created_at, w.id, w.user_id
        FROM public.wishlist_items w JOIN actors a ON a.user_id = w.user_id
        WHERE w.deleted_at IS NULL AND w.restaurant_id IS NOT NULL
        UNION ALL
        SELECT 'list:' || l.id, 'list', l.updated_at, l.id, l.owner_id
        FROM public.lists l JOIN actors a ON a.user_id = l.owner_id
        WHERE l.table_id IS NULL AND (l.owner_id = p_viewer OR l.privacy = 'public')
    ), page AS MATERIALIZED (
        SELECT c.* FROM candidates c
        WHERE p_cursor_date IS NULL
           OR (c.sort_date, c.activity_key COLLATE "C") < (p_cursor_date, p_cursor_key COLLATE "C")
        ORDER BY c.sort_date DESC, c.activity_key COLLATE "C" DESC
        LIMIT greatest(1, least(COALESCE(p_limit, 31), 51))
    )
    SELECT c.activity_key, c.kind, c.sort_date,
        jsonb_build_object(
            'id', CASE WHEN c.kind = 'entry' THEN c.source_id::text ELSE c.activity_key END,
            'user_id', c.user_id,
            'author', jsonb_build_object('user_id', p.user_id, 'username', p.username,
                'display_name', p.display_name, 'avatar_url', p.avatar_url)
        ) || CASE c.kind
        WHEN 'entry' THEN (
            SELECT jsonb_build_object(
                'restaurant_id', e.restaurant_id, 'rating', e.rating, 'content', e.content,
                'visited_at', e.visited_at, 'created_at', e.created_at,
                'photos', ph.photos, 'photo_count', jsonb_array_length(ph.photos),
                'reaction_count', COALESCE(e.public_reaction_count, 0),
                'comment_count', COALESCE(e.public_reply_count, 0),
                'top_emojis', COALESCE(e.public_top_emojis, '[]'::jsonb),
                'my_reactions', (SELECT COALESCE(jsonb_agg(pr.emoji ORDER BY pr.emoji), '[]'::jsonb)
                    FROM public.post_reactions pr WHERE pr.target_type = 'entry'
                    AND pr.target_id = e.id AND pr.user_id = p_viewer AND pr.scope = 'public'),
                'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'photo_url', r.photo_url)
            ) FROM public.entries e JOIN public.restaurants r ON r.id = e.restaurant_id
            CROSS JOIN LATERAL (
                SELECT (CASE WHEN e.photo_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(e.photo_url) END)
                    || (SELECT COALESCE(jsonb_agg(ep.photo_url ORDER BY ep.sort_order, ep.id), '[]'::jsonb)
                        FROM public.entry_photos ep WHERE ep.entry_id = e.id) AS photos
            ) ph WHERE e.id = c.source_id
        )
        WHEN 'pin' THEN (
            SELECT jsonb_build_object('restaurant_id', w.restaurant_id, 'created_at', w.created_at,
                'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'photo_url', r.photo_url))
            FROM public.wishlist_items w JOIN public.restaurants r ON r.id = w.restaurant_id
            WHERE w.id = c.source_id
        )
        WHEN 'list' THEN (
            SELECT jsonb_build_object('list_id', l.id, 'title', l.title, 'emoji', l.emoji,
                'created_at', l.created_at, 'updated_at', l.updated_at,
                'action', CASE WHEN l.created_at = l.updated_at THEN 'created' ELSE 'updated' END)
            FROM public.lists l WHERE l.id = c.source_id
        ) END
    FROM page c JOIN public.profiles p ON p.user_id = c.user_id
    ORDER BY c.sort_date DESC, c.activity_key COLLATE "C" DESC;
$$;
REVOKE ALL ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) TO service_role;
COMMENT ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) IS
    'Viewer and followed public accounts: entries, resolved active pins, latest personal list updates. '
    'All privacy and block gates precede pagination. No Table context. Verified viewer from edge only.';

-- ── 9. fn_restaurant_saves_visible (latest body: 20260710160000) ─────────────
CREATE OR REPLACE FUNCTION public.fn_restaurant_saves_visible(
    p_viewer        uuid,
    p_restaurant_id uuid
) RETURNS TABLE (
    saver_id      uuid,
    username      text,
    display_name  text,
    avatar_url    text,
    relationship  text,        -- 'self' | 'tablemate' | 'following' | 'stranger'
    source        jsonb,       -- raw if saver = viewer, else sanitized allowlist
    created_at    timestamptz,
    restaurant_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        w.user_id       AS saver_id,
        pr.username,
        pr.display_name,
        pr.avatar_url,
        CASE
            WHEN w.user_id = p_viewer THEN 'self'
            WHEN EXISTS (
                SELECT 1
                FROM public.table_members tm_self
                JOIN public.table_members tm_saver
                  ON tm_self.table_id = tm_saver.table_id
                WHERE tm_self.member_id  = p_viewer      -- member_id, NOT user_id
                  AND tm_saver.member_id = w.user_id
            ) THEN 'tablemate'
            WHEN EXISTS (
                SELECT 1 FROM public.follows f
                WHERE f.follower_id  = p_viewer
                  AND f.following_id = w.user_id
            ) THEN 'following'
            ELSE 'stranger'
        END AS relationship,
        CASE
            WHEN w.source IS NULL       THEN NULL           -- N2: null → null, not {}
            WHEN w.user_id = p_viewer   THEN w.source       -- self → raw
            ELSE jsonb_strip_nulls(jsonb_build_object(      -- other → sanitized allowlist
                'type',          w.source->>'type',
                'url',           w.source->>'url',
                'author_handle', w.source->>'author_handle',
                'author_name',   w.source->>'author_name',
                'thumbnail_url', w.source->>'thumbnail_url' -- N1: ephemeral (see header)
            ))
        END AS source,
        w.created_at,
        w.restaurant_id
    FROM public.wishlist_items w
    JOIN public.profiles pr ON pr.user_id = w.user_id
    WHERE w.restaurant_id = p_restaurant_id
      AND w.deleted_at IS NULL
      AND (
          w.user_id = p_viewer                             -- self: always visible
          OR (
              -- TICKET-251: an internal (smoke / test) saver is visible only to
              -- internal viewers. Self is handled above and stays unconditional.
              (
                  NOT pr.is_internal
                  OR EXISTS (
                      SELECT 1 FROM public.profiles pv
                      WHERE pv.user_id = p_viewer AND pv.is_internal
                  )
              )
              -- block in EITHER direction hides the save (definer sees both rows)
              AND NOT EXISTS (
                  SELECT 1 FROM public.blocked_users b
                  WHERE (b.blocker_id = p_viewer  AND b.blocked_id = w.user_id)
                     OR (b.blocker_id = w.user_id AND b.blocked_id = p_viewer)
              )
              AND (
                  public.fn_public_account(w.user_id)      -- public saver → anyone
                  OR EXISTS (                              -- private saver → shared Table only
                      SELECT 1
                      FROM public.table_members tm_self
                      JOIN public.table_members tm_saver
                        ON tm_self.table_id = tm_saver.table_id
                      WHERE tm_self.member_id  = p_viewer
                        AND tm_saver.member_id = w.user_id
                  )
              )
          )
      )
    ORDER BY w.created_at DESC, w.user_id DESC;
$$;

COMMENT ON FUNCTION public.fn_restaurant_saves_visible(uuid, uuid) IS
    'TICKET-155: who-saved-this-restaurant predicate the viewer may see: public '
    'savers to anyone, private savers to Table-mates only, self always, blocks '
    '(either direction) always hidden. Per-row relationship tier '
    '(self>tablemate>following>stranger) + sanitized source allowlist '
    '(self gets raw). SECURITY DEFINER, service_role-only EXECUTE: the '
    'user-profile-style edge fn validates the JWT and passes p_viewer = '
    'auth.uid(). NOT an RLS policy (blocked_users RLS would defeat the '
    'both-directions block). TICKET-251: internal savers are visible only '
    'to internal viewers (and to themselves).';

REVOKE ALL ON FUNCTION public.fn_restaurant_saves_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_restaurant_saves_visible(uuid, uuid) TO service_role;

-- ── 10. fn_search_public_lists (latest body: 20260706170000) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_search_public_lists(
    q             text,
    p_cursor_date timestamptz,
    p_cursor_id   uuid,
    p_limit       int
) RETURNS TABLE (
    id                 uuid,
    owner_id           uuid,
    title              text,
    description        text,
    ranked             boolean,
    emoji              text,
    entry_count        bigint,
    updated_at         timestamptz,
    owner_display_name text,
    owner_avatar_url   text,
    owner_username     text
) LANGUAGE sql STABLE AS $$
    SELECT
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.emoji,
        (SELECT count(*) FROM public.list_entries le WHERE le.list_id = l.id) AS entry_count,
        l.updated_at,
        p.display_name AS owner_display_name,
        p.avatar_url   AS owner_avatar_url,
        p.username     AS owner_username
    FROM public.lists l
    JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE l.privacy = 'public'
      AND l.table_id IS NULL              -- Tables-never-public (TICKET-115 cross-gate)
      AND p.account_privacy = 'public'    -- owner account gate (profiles)
      AND NOT p.is_internal               -- TICKET-251: never an internal owner
      -- COUPLING (TICKET-125): lists/browse_public calls this fn with q='' so ILIKE '%%'
      -- matches ALL rows (recency browse). Any edit to this WHERE must keep q='' = match-all,
      -- or give browse_public its own fn.
      AND (l.title ILIKE '%' || q || '%' OR COALESCE(l.description, '') ILIKE '%' || q || '%')
      AND (p_cursor_date IS NULL OR (l.updated_at, l.id) < (p_cursor_date, p_cursor_id))
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT p_limit;
$$;

-- Lock down: service-role only (the `lists` edge fn calls it). No client/anon.
REVOKE EXECUTE ON FUNCTION public.fn_search_public_lists(text, timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_public_lists(text, timestamptz, uuid, int)
    TO service_role;

-- ── 11. fn_browse_public_lists (latest body: 20260715183000) ─────────────────
create or replace function public.fn_browse_public_lists(
    p_viewer uuid,
    p_limit  int default 6
)
returns table (
    id                     uuid,
    owner_id               uuid,
    title                  text,
    description            text,
    ranked                 boolean,
    emoji                  text,
    entry_count            bigint,
    updated_at             timestamptz,
    owner_display_name     text,
    owner_avatar_url       text,
    owner_username         text,
    cover_photo_url        text,
    cover_photo_source     text,
    cover_attribution_html text
)
language sql
stable
as $fn$
    select
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.emoji,
        (select count(*) from public.list_entries le where le.list_id = l.id) as entry_count,
        l.updated_at,
        p.display_name as owner_display_name,
        p.avatar_url   as owner_avatar_url,
        p.username     as owner_username,
        -- Public-safe attributed cover: Places hero ONLY, else NULL.
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.photo_url else null end as cover_photo_url,
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.photo_source else null end as cover_photo_source,
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.places_photo_attribution_html else null end as cover_attribution_html
    from public.lists l
    join public.profiles p on p.user_id = l.owner_id
    left join lateral (
        -- The list's FIRST restaurant, exactly as the author ordered it:
        -- ranked → position ASC; unranked → newest add first (mirrors the old
        -- browse_public cover fan-out). Reads restaurants.photo_url /
        -- photo_source / attribution ONLY: never entry_photos.
        select r.photo_url, r.photo_source, r.places_photo_attribution_html
        from public.list_entries le
        join public.restaurants r on r.id = le.restaurant_id
        where le.list_id = l.id
        order by
            case when l.ranked then le.position end asc nulls last,
            case when not l.ranked then le.created_at end desc nulls last
        limit 1
    ) cover on true
    where l.privacy = 'public'
      and l.table_id is null                 -- Tables-never-public cross-gate
      and p.account_privacy = 'public'       -- owner account gate
      and not p.is_internal                  -- TICKET-251: never an internal owner
      and l.owner_id <> p_viewer             -- self-exclusion BEFORE the limit
    order by l.updated_at desc, l.id desc
    limit p_limit;
$fn$;

comment on function public.fn_browse_public_lists(uuid, int) is
    'TICKET-189: viewer-keyed For You lists browse: triple gate (public list + '
    'non-Table + public owner) + owner_id <> p_viewer before LIMIT; laterals '
    'the first-restaurant cover, returned ONLY when photo_source=''places'' '
    'with attribution (never a user/table hero on the public feed). Explicit '
    'projection, no table_id. Service-role called; SECURITY INVOKER like '
    'fn_search_public_lists.';

revoke all on function public.fn_browse_public_lists(uuid, int) from PUBLIC, anon, authenticated;
grant execute on function public.fn_browse_public_lists(uuid, int) to service_role;

-- ── 12. fn_browse_public_lists_with_cover_credit (latest body: 20260715200000) ─
CREATE OR REPLACE FUNCTION public.fn_browse_public_lists_with_cover_credit(
    p_viewer uuid,
    p_limit  integer DEFAULT 6
)
RETURNS TABLE (
    id                     uuid,
    owner_id               uuid,
    title                  text,
    description            text,
    ranked                 boolean,
    emoji                  text,
    entry_count            bigint,
    updated_at             timestamptz,
    owner_display_name     text,
    owner_avatar_url       text,
    owner_username         text,
    cover_photo_url        text,
    cover_photo_source     text,
    cover_attribution_html text,
    cover_restaurant_name  text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.emoji,
        (SELECT count(*) FROM public.list_entries counted WHERE counted.list_id = l.id),
        l.updated_at,
        p.display_name,
        p.avatar_url,
        p.username,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.photo_url ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.photo_source ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.places_photo_attribution_html ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.name ELSE NULL END
    FROM public.lists l
    JOIN public.profiles p ON p.user_id = l.owner_id
    LEFT JOIN LATERAL (
        SELECT
            r.name,
            r.photo_url,
            r.photo_source,
            r.places_photo_attribution_html
        FROM public.list_entries le
        JOIN public.restaurants r ON r.id = le.restaurant_id
        WHERE le.list_id = l.id
        ORDER BY
            CASE WHEN l.ranked THEN le.position END ASC NULLS LAST,
            CASE WHEN NOT l.ranked THEN le.created_at END DESC NULLS LAST,
            le.id ASC
        LIMIT 1
    ) AS cover ON TRUE
    WHERE l.privacy = 'public'
      AND l.table_id IS NULL
      AND p.account_privacy = 'public'
      AND NOT p.is_internal      -- TICKET-251: never an internal owner
      AND l.owner_id <> p_viewer
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer) IS
    'Service-only public-list browse with an atomically paired attributed Places cover and restaurant name.';

REVOKE ALL ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer)
    TO service_role;

-- ── 13. fn_saved_list_cards (latest body: 20260712210253) ────────────────────
-- fn_saved_list_cards_with_cover_credit (20260715200000) delegates to this
-- function and needs no change.
CREATE OR REPLACE FUNCTION public.fn_saved_list_cards(
    p_viewer_id       uuid,
    p_limit           integer DEFAULT 40,
    p_before_saved_at timestamptz DEFAULT NULL,
    p_before_list_id  uuid DEFAULT NULL
)
RETURNS TABLE (
    id                   uuid,
    owner_id             uuid,
    title                text,
    description          text,
    ranked               boolean,
    privacy              text,
    emoji                text,
    created_at           timestamptz,
    updated_at           timestamptz,
    saved_at             timestamptz,
    entry_count          bigint,
    cover_photo_url      text,
    save_count           bigint,
    owner_display_name   text,
    owner_avatar_url     text,
    owner_username       text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.privacy,
        l.emoji,
        l.created_at,
        l.updated_at,
        s.created_at AS saved_at,
        (
            SELECT count(*)::bigint
            FROM public.list_entries le
            WHERE le.list_id = l.id
        ) AS entry_count,
        (
            SELECT r.photo_url
            FROM public.list_entries le
            JOIN public.restaurants r ON r.id = le.restaurant_id
            WHERE le.list_id = l.id
            ORDER BY
                CASE WHEN l.ranked THEN le.position END ASC NULLS LAST,
                CASE WHEN NOT l.ranked THEN le.created_at END DESC NULLS LAST,
                le.id ASC
            LIMIT 1
        ) AS cover_photo_url,
        (
            SELECT count(*)::bigint
            FROM public.list_saves aggregate_save
            WHERE aggregate_save.list_id = l.id
        ) AS save_count,
        p.display_name AS owner_display_name,
        p.avatar_url AS owner_avatar_url,
        p.username AS owner_username
    FROM public.list_saves s
    JOIN public.lists l ON l.id = s.list_id
    JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE s.user_id = p_viewer_id
      AND l.owner_id <> p_viewer_id
      AND l.privacy = 'public'
      AND l.table_id IS NULL
      AND p.account_privacy = 'public'
      AND NOT p.is_internal      -- TICKET-251: never an internal owner
      AND NOT EXISTS (
          SELECT 1
          FROM public.blocked_users b
          WHERE (b.blocker_id = p_viewer_id AND b.blocked_id = l.owner_id)
             OR (b.blocker_id = l.owner_id AND b.blocked_id = p_viewer_id)
      )
      AND (
          p_before_saved_at IS NULL
          OR s.created_at < p_before_saved_at
          OR (
              s.created_at = p_before_saved_at
              AND p_before_list_id IS NOT NULL
              AND s.list_id < p_before_list_id
          )
      )
    ORDER BY s.created_at DESC, s.list_id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 50);
$$;

COMMENT ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid) IS
    'Service-only, privacy-gated saved-list cards with stable keyset pagination.';

REVOKE ALL ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid)
    TO service_role;

-- ── 14. fn_restaurant_featured_lists (latest body: 20260722102349) ───────────
create or replace function public.fn_restaurant_featured_lists(
    p_viewer        uuid,
    p_restaurant_id uuid,
    p_limit         int default 3
)
returns table (
    id                 uuid,
    owner_id           uuid,
    title              text,
    ranked             boolean,
    emoji              text,
    entry_count        bigint,
    updated_at         timestamptz,
    owner_display_name text,
    owner_username     text,
    total_count        bigint
)
language sql
stable
security invoker
as $fn$
    select
        l.id,
        l.owner_id,
        l.title,
        l.ranked,
        l.emoji,
        (select count(*) from public.list_entries le where le.list_id = l.id) as entry_count,
        l.updated_at,
        p.display_name as owner_display_name,
        p.username as owner_username,
        count(*) over () as total_count
    from public.lists l
    join public.profiles p on p.user_id = l.owner_id
    where l.table_id is null
      and (
          l.owner_id = p_viewer
          -- TICKET-251: a list owned by an internal account is never featured
          or (l.privacy = 'public' and p.account_privacy = 'public' and not p.is_internal)
      )
      and exists (
          select 1
          from public.list_entries le2
          where le2.list_id = l.id
            and le2.restaurant_id = p_restaurant_id
      )
    order by (l.owner_id = p_viewer) desc, l.updated_at desc, l.id desc
    limit p_limit;
$fn$;

comment on function public.fn_restaurant_featured_lists(uuid, uuid, int) is
    'Restaurant featured lists: viewer-owned non-Table lists (including private) '
    'first, plus public lists owned by public accounts, ordered before LIMIT. '
    'Explicit projection omits table_id; service-role-only SECURITY INVOKER.';

revoke all on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    from PUBLIC, anon, authenticated;
grant execute on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    to service_role;

-- ── 15. fn_guest_public_list (latest body: 20260922150000) ───────────────────
create or replace function public.fn_guest_public_list(p_list_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select jsonb_build_object(
        'list', jsonb_build_object(
            'id', l.id,
            'owner_id', l.owner_id,
            'title', l.title,
            'description', l.description,
            'ranked', l.ranked,
            'privacy', l.privacy,
            'emoji', l.emoji,
            'table_id', null,
            'created_at', l.created_at,
            'updated_at', l.updated_at
        ),
        'owner_profile', jsonb_build_object(
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'username', p.username,
            'account_privacy', p.account_privacy
        ),
        'save_count', (select count(*) from list_saves s where s.list_id = l.id),
        'entries', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', le.id,
                    'list_id', le.list_id,
                    'restaurant_id', le.restaurant_id,
                    'note', le.note,
                    'position', le.position,
                    'created_at', le.created_at,
                    'restaurant', jsonb_build_object(
                        'id', r.id,
                        'name', r.name,
                        'address', r.address,
                        'city', r.city,
                        'country', r.country,
                        'cuisine', r.cuisine,
                        'price_level', r.price_level,
                        'photo_url', case when r.photo_source = 'places' then r.photo_url end,
                        'photo_source', r.photo_source,
                        'places_photo_attribution_html',
                            case when r.photo_source = 'places' then r.places_photo_attribution_html end,
                        'google_rating', r.google_rating,
                        'external_id', r.external_id,
                        'verification', r.verification,
                        'lat', r.lat,
                        'lng', r.lng
                    )
                )
                -- Same order as lists?action=get: ranked by position, else newest first.
                order by
                    case when l.ranked then le.position end asc nulls last,
                    case when l.ranked then null else le.created_at end desc nulls last,
                    le.id asc
            )
            from list_entries le
            join restaurants r on r.id = le.restaurant_id
            where le.list_id = l.id
              and r.verification = 'verified'
              and r.merged_into is null
        ), '[]'::jsonb)
    )
    from lists l
    join profiles p on p.user_id = l.owner_id
    where l.id = p_list_id
      and l.privacy = 'public'
      and l.table_id is null
      and p.account_privacy = 'public'
      and not p.is_internal;      -- TICKET-251: never an internal owner
$fn$;

revoke all on function public.fn_guest_public_list(uuid) from public;
revoke all on function public.fn_guest_public_list(uuid) from anon;
revoke all on function public.fn_guest_public_list(uuid) from authenticated;
grant execute on function public.fn_guest_public_list(uuid) to service_role;

comment on function public.fn_guest_public_list(uuid) is
    'TICKET-247 guest reads: one public, non-Table list of a public account with its '
    'verified, non-tombstoned entries (Places photos only), as jsonb; NULL otherwise. '
    'service_role only (public-browse).';

-- ── 16. Data: flag the smoke accounts, privatise the superseded seed accounts ─
-- Ids resolved read-only against production on 2026-09-24. On a fresh replay
-- none of them exist and both updates touch zero rows.
do $internal_accounts$
declare
    -- CI smoke accounts: @napkin_smoke (SMOKE_TEST_EMAIL) and the +socials saver
    -- that ensure-fixtures.ts seeds a TikTok clip from.
    v_internal constant uuid[] := array[
        '2868b2a4-9477-4dd8-b4d5-7212cc865dfa'::uuid,
        '04a9b467-5a47-4c64-bf13-d49ee776717d'::uuid
    ];
    -- Superseded demo accounts (@alexreviews, @alexnapkin, @billieeats,
    -- @billienapkin) and the eight feed-fixture personas (usernames ending _ldn).
    v_privatise constant uuid[] := array[
        'aadbefb1-fdc5-455a-9c47-56e5d530bdaf'::uuid,  -- alexreviews
        '865970fe-6ac7-41db-a788-d4222c0f68e2'::uuid,  -- alexnapkin
        '3c337ace-b68e-4ae0-bf4c-3c7780d28c6d'::uuid,  -- billieeats
        '53c89303-e0d2-46d7-8e39-fd6d5d1ca4e2'::uuid,  -- billienapkin
        '9af43a9d-8ed7-5502-9473-2a1eecea6a02'::uuid,  -- mayachen_ldn
        '7db4b455-6347-5e6c-a4ba-34d5935c9496'::uuid,  -- theobennett_ldn
        '5295a69d-701e-5f30-9d92-4cbb83f8cd18'::uuid,  -- amaraokafor_ldn
        'cd543744-9842-5eea-b119-e2eecd591905'::uuid,  -- lucamoretti_ldn
        '9a342d4a-6fab-523b-9b9c-92ffd136d3ee'::uuid,  -- ninapatel_ldn
        '37c598ed-e97b-5124-bd76-24cd6e22987d'::uuid,  -- eliaswong_ldn
        '9159f19d-2b94-505e-9fb0-cb9c6d5746f1'::uuid,  -- sofiamarin_ldn
        '39c7472a-90e7-5316-ae01-69dbc8b0abf1'::uuid   -- rowanblake_ldn
    ];
    -- The CURRENT App Review demo pair (@alexreviewer, @billietable): must stay
    -- public and untouched. Guarded explicitly so a future edit of the arrays
    -- above cannot silently include them.
    v_protected constant uuid[] := array[
        'edf516b4-f8ea-4d2e-816f-cf4ca3f402f2'::uuid,
        'f2f4e458-b8f2-48b7-b60e-4d4d3ddd45e9'::uuid
    ];
    v_flagged integer;
    v_privatised integer;
begin
    if v_protected && v_internal or v_protected && v_privatise then
        raise exception using
            errcode = '55000',
            message = 'internal accounts: the App Review demo pair must not be flagged or privatised';
    end if;

    update public.profiles
       set is_internal = true
     where user_id = any(v_internal)
       and not is_internal;
    get diagnostics v_flagged = row_count;

    update public.profiles
       set account_privacy = 'private'
     where user_id = any(v_privatise)
       and account_privacy <> 'private';
    get diagnostics v_privatised = row_count;

    raise notice 'internal accounts: flagged % smoke account(s), privatised % seed account(s)',
        v_flagged, v_privatised;
end;
$internal_accounts$;
