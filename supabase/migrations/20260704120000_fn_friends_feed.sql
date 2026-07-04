-- TICKET-098 Phase A — friends feed SQL helpers.
--
-- fn_public_eligible_entries: THE shared public-eligibility predicate for entry
-- surfaces, extracted so the friends feed and (in a follow-up) the profile diary
-- can never drift. Encodes, per [ARCH-REVIEW-1] as amended in review cycle 2:
--   • the TICKET-092 diary BASE predicate:
--       restaurant_id IS NOT NULL AND visibility <> 'private'
--     (PostgREST .neq('visibility','private') excludes NULL visibility, and so
--      does the SQL `<>` here — semantics match exactly)
--   • PLUS the public-engagement gate, inlined (sync with
--     is_entry_publicly_eligible, 20260430000000 — same precedent as
--     can_view_entry_v2): rating IS NOT NULL AND trim(content) >= 20 chars.
--     Display predicate = engagement predicate, so every feed card is
--     tappable + reactable — no dead cards (review cycle 2, W1). The feed is
--     strictly NARROWER than is_entry_publicly_eligible (which checks neither
--     visibility nor blocks), never wider.
--   • author account public (profiles.account_privacy = 'public', via
--     fn_public_account — the gates.ts public_only relationship, SQL-encoded)
--   • no either-direction blocked_users row vs the viewer (gates.ts
--     fetchBlockState semantics — any row, either direction, denies)
--
-- fn_friends_feed: the RPC feed-friends calls [ARCH-REVIEW-4] — resolves the
-- viewer's follow set (follows.follower_id = viewer; asymmetric, no mutuality)
-- and delegates to the shared helper. Keyset pagination is IN SQL on a projected
-- sort_date = COALESCE(visited_at, created_at) + id tiebreak, mirroring
-- fn_user_aggregate_feed — never applyKeysetFilter against raw entries (which
-- has no sort_date column).
--
-- Both are SECURITY DEFINER + service_role-only EXECUTE: the feed-friends edge
-- fn validates the caller's JWT and passes auth.uid() as p_viewer. Only
-- public-eligible rows ever leave; Table context (entry_tables, table_id,
-- threads) is never read or returned — a table-shared entry surfaces as a
-- plain entry (TICKET-093 decision a).

-- ── fn_public_account — gates.ts "account is public" predicate ───────────────
CREATE OR REPLACE FUNCTION public.fn_public_account(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = p_user_id
          AND p.account_privacy = 'public'
    );
$$;

COMMENT ON FUNCTION public.fn_public_account(uuid) IS
    'TICKET-098: author-account-public gate for public entry surfaces. '
    'Mirrors user-profile gates.ts relationship=public_only.';

REVOKE ALL ON FUNCTION public.fn_public_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_account(uuid) TO service_role;

-- ── fn_public_eligible_entries — the shared eligibility keyset query ─────────
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
          AND char_length(trim(COALESCE(e.content, ''))) >= 20
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

-- ── fn_friends_feed — follow-set resolution + delegate ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_friends_feed(
    p_viewer      uuid,
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
    SELECT *
    FROM public.fn_public_eligible_entries(
        p_viewer,
        ARRAY(
            SELECT f.following_id
            FROM public.follows f
            WHERE f.follower_id = p_viewer
              -- self-exclusion is already guaranteed by the follows CHECK
              -- (follower_id <> following_id); kept as defence in depth.
              AND f.following_id <> p_viewer
        ),
        p_cursor_date,
        p_cursor_id,
        p_limit
    );
$$;

COMMENT ON FUNCTION public.fn_friends_feed(uuid, timestamptz, uuid, int) IS
    'TICKET-098: friends feed page — public-eligible entries authored by the '
    'viewer''s follow set (asymmetric), self excluded, blocks excluded. Keyset '
    'on (COALESCE(visited_at, created_at), id). Service-role only.';

REVOKE ALL ON FUNCTION public.fn_friends_feed(uuid, timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_friends_feed(uuid, timestamptz, uuid, int)
    TO service_role;

-- Index support: the friends-feed hot path filters entries by author. The
-- existing entries(user_id) access path plus friends-scale row counts make a
-- dedicated (user_id, visited_at) index unnecessary today; revisit at scale.
