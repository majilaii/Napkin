-- TICKET-155 — saves are public signals.
--
-- fn_restaurant_saves_visible: the single, authoritative read predicate for
-- "who saved this restaurant, that this viewer may see". It is the doctrine
-- surface TICKET-156's On Socials rail reads; the (unchanged) wishlist_items
-- SELECT policy is legacy defence-in-depth, NOT the canonical who-can-see-a-save
-- read.
--
-- Visibility rules (per saver S, for viewer V, at restaurant R):
--   • self          — V = S → always visible, regardless of S's account_privacy.
--   • public saver  — S.account_privacy = 'public' → visible to ANY viewer
--                     (stranger, follower, tablemate), no follow/Table needed.
--   • private saver — visible ONLY when V and S share ≥1 Table (unchanged from
--                     today's wishlist_items RLS). Never to public followers or
--                     strangers.
--   • block         — a blocked_users row in EITHER direction between V and S
--                     hides the save completely, overriding public/Table/self…
--                     except self (you cannot block yourself; the CHECK forbids
--                     blocker_id = blocked_id, so the self branch never collides).
--
-- ── Why a SECURITY DEFINER RPC and NOT a widened wishlist_items RLS policy ────
-- The both-directions block requirement is UNENFORCEABLE inside an RLS USING
-- clause. blocked_users' own RLS only exposes rows where blocker_id = auth.uid()
-- (blocked_users_select_own). So a "saver blocked the viewer" row
-- (blocker_id = S, blocked_id = V) is INVISIBLE in the viewer's RLS context — an
-- inline `NOT EXISTS(SELECT 1 FROM blocked_users …)` subquery inside a USING
-- clause silently fails open in the saver→viewer direction, surfacing a save the
-- blocker meant to hide. A definer function OWNS the full blocked_users table
-- (RLS does not apply to the owner) and evaluates both directions honestly. If a
-- future refactor tries to fold this back into an RLS policy or an inline
-- subquery, the block fails open again — do not. The .spec.sql
-- block-in-either-direction row is the tripwire.
--
-- ── Calling convention ───────────────────────────────────────────────────────
-- p_viewer uuid parameter + service_role-ONLY EXECUTE (REVOKE from PUBLIC/anon/
-- authenticated below), called ONLY through a JWT-validating edge function that
-- passes p_viewer = auth.uid() after validating the caller — exactly how the
-- network_map_pins edge action wraps fn_network_map_pins. Direct client .rpc()
-- is intentionally impossible: authenticated cannot EXECUTE at all, so the
-- p_viewer parameter is unspoofable (an authenticated user cannot pass an
-- arbitrary p_viewer to read through someone else's block/Table state).
--
-- ── Source (origin clipping) projection ──────────────────────────────────────
-- Founder doctrine: the clipping is visible IFF the save is visible. Sanitization
-- is the SINGLE enforcement point, computed per-row here so no caller can ever
-- receive the raw source of another user:
--   • self  (w.user_id = p_viewer) → the RAW source (you own it; 156 renders your
--     own clipping first).
--   • other visible saver → a SANITIZED allowlist of exactly
--     {type, url, author_handle, author_name, thumbnail_url}, built with
--     jsonb_build_object + jsonb_strip_nulls. This collapses screenshot / vision /
--     video / handoff sources down to {type} alone — no caption, title,
--     source_url, upload_path, embed_product_id, place_id, or sharer_name ever
--     leaves. The allowlist is a FAIL-CLOSED fact duplicated between this SQL and
--     the WishlistSource TS union: a new user-content source key added later stays
--     hidden here until consciously added (the safe direction).
--   • source IS NULL → NULL (NOT '{}') — the null row skips jsonb_build_object
--     entirely (ARCH-REVIEW N2).
-- NOTE (ARCH-REVIEW N1): thumbnail_url is a signed provider-CDN path and is
-- EPHEMERAL — consumers must never persist or durably render it. TICKET-156 uses
-- its own cached copy; the field rides here only so a viewer can render a
-- transient thumbnail inline.
--
-- ── Relationship tier ────────────────────────────────────────────────────────
-- One enum per row with fixed precedence self > tablemate > following > stranger,
-- so TICKET-156 buckets you → circle → strangers with no second round trip. A
-- saver who is BOTH a Table-mate and followed resolves to 'tablemate' (Ring 1
-- wins). table_members joins key on member_id — NOT user_id (the TICKET-034 trap;
-- member_id is the intentional legacy exception documented in CLAUDE.md).
--
-- ── Replay-from-zero safety ──────────────────────────────────────────────────
-- All referenced objects — wishlist_items, profiles, table_members, follows,
-- blocked_users, fn_public_account — predate this migration's 20260710140000
-- timestamp, so this LANGUAGE sql body replays from zero with no
-- check_function_bodies toggle. Unresolved-import rows (restaurant_id IS NULL)
-- cannot match a non-null p_restaurant_id, so they are excluded without an extra
-- clause; soft-deleted rows are excluded by deleted_at IS NULL, matching the
-- strictest existing read path.

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
              -- block in EITHER direction hides the save (definer sees both rows)
              NOT EXISTS (
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
    'TICKET-155: who-saved-this-restaurant predicate the viewer may see — public '
    'savers to anyone, private savers to Table-mates only, self always, blocks '
    '(either direction) always hidden. Per-row relationship tier '
    '(self>tablemate>following>stranger) + sanitized source allowlist '
    '(self gets raw). SECURITY DEFINER, service_role-only EXECUTE — the '
    'user-profile-style edge fn validates the JWT and passes p_viewer = '
    'auth.uid(). NOT an RLS policy (blocked_users RLS would defeat the '
    'both-directions block).';

REVOKE ALL ON FUNCTION public.fn_restaurant_saves_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_restaurant_saves_visible(uuid, uuid) TO service_role;
