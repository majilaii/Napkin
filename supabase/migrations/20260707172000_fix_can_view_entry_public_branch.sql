-- TICKET-124 (review fix) — repair can_view_entry's DEAD public branch.
--
-- THE BUG (latent since the public layer shipped; TICKET-124's network map
-- exposed it):
--   can_view_entry Branch 4 gated the public read on `e.visibility = 'public'`.
--   But the entries.visibility CHECK constraint only permits
--   ('private','friends','table','both') (20251222023333_remote_schema.sql:183) —
--   'public' is UNREACHABLE and never written anywhere (create-entry types it
--   'private'|'friends'|'table'|'both'; update_privacy only flips
--   profiles.account_privacy, never the entry). So Branch 4 could NEVER match.
--   Consequence: every NON-owner / non-tablemate / non-companion / non-supper
--   client read of an entry (entry-detail viewAs='public' — used by the friends
--   feed, profile reviews, restaurant-page taps, and now the network map)
--   RLS-failed (0 rows → PGRST116 → "Couldn't load this entry."). Public reviews
--   were structurally unreadable by anyone but their author.
--
-- THE FIX:
--   Replace Branch 4's dead `visibility = 'public'` with the REAL public
--   predicate, aligned byte-for-semantics with fn_public_eligible_entries
--   (20260704120000) — the single source of truth the friends feed / diary use:
--     visibility <> 'private'                (the {friends,table,both} public set;
--                                             '<>' also excludes NULL)
--     AND restaurant_id IS NOT NULL
--     AND rating IS NOT NULL
--     AND char_length(trim(coalesce(content,''))) >= 20   (real review content)
--     AND author account_privacy = 'public'
--     AND no blocked_users row EITHER direction between the viewer and the author
--   RLS (this) is now exactly as narrow as fn_public_eligible_entries — never
--   wider. A public-eligible entry the feed surfaces is now also RLS-readable on
--   its detail screen; a thin/private/blocked one stays hidden.
--
-- PERM POSTURE — identical to the prior definition:
--   can_view_entry stays SECURITY INVOKER (unchanged grants). Branches 1-3 and 5
--   are preserved byte-for-byte from 20260615000200. Only Branch 4's inner
--   predicate changes.
--
-- WHY THE BLOCK CHECK NEEDS A HELPER (not an inline subquery):
--   blocked_users RLS is `blocker_id = auth.uid()` only (20260704000000:158-160) —
--   under can_view_entry's INVOKER context a viewer can see the blocks THEY made
--   but NOT blocks made against them. An inline both-directions NOT EXISTS would
--   therefore silently miss the "author blocked viewer" direction (RLS hides that
--   row) — i.e. it would ship a NEW latent gap while fixing this one. So the block
--   test goes through a SECURITY DEFINER helper (fn_block_between_viewer) that
--   reads blocked_users with owner privileges — exactly the pattern Branches 1-3
--   and 5 already use (fn_user_authored_entry / is_table_member /
--   is_entry_companion / is_supper_member are all SECDEF helpers granted to
--   authenticated). The helper is caller-scoped: it derives the viewer from
--   auth.uid() internally and only answers about pairs involving the caller, so it
--   is not a who-blocked-whom oracle. The profiles account-privacy check stays
--   inline — the "profiles read public" policy (20260423000000) already exposes
--   account_privacy='public' rows to any authenticated reader, so the inline
--   EXISTS is correct under INVOKER (returns true only for public accounts).
--
-- BLAST RADIUS (additive semantics — one branch widened, no schema change):
--   * entries_select_v2 (USING can_view_entry(entries.*)) — genuinely
--     public-eligible entries become readable by any authenticated viewer. This is
--     the INTENDED public-profile doctrine (public reviews are world-browsable);
--     private / thin / blocked entries are unaffected.
--   * entry_photos / entry_companions / entry_participants SELECT policies
--     (via can_view_entry_id, the SECDEF wrapper) inherit the same widening —
--     a public review's photos/companions become visible to non-owners, which is
--     correct (they are part of the public review).
--   * No table, column, FK, RLS policy, edge contract, query key, or optimistic
--     patch changes. This is purely a fix to WHICH rows an existing policy admits.
--
-- REPLAY: this timestamp (20260707143000) sits after every referenced object —
--   blocked_users (20260704000000), profiles + entries + entry_tables (base),
--   fn_user_authored_entry / is_table_member / is_entry_companion (pre-existing),
--   is_supper_member (20260615000200), auth.uid(). LANGUAGE sql bodies validate
--   against live objects at CREATE time; fn_block_between_viewer is created FIRST
--   so can_view_entry's body resolves it. Replays from zero.

-- ── SECDEF block helper — caller-scoped, both-directions ─────────────────────
-- Returns true iff a blocked_users row exists in EITHER direction between the
-- calling viewer (auth.uid()) and p_other. SECURITY DEFINER so it reads
-- blocked_users past its blocker-only RLS; caller-scoped (viewer = auth.uid())
-- so it can only reveal blocks involving the caller, never an arbitrary pair.
CREATE OR REPLACE FUNCTION public.fn_block_between_viewer(p_other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.blocked_users b
        WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_other)
           OR (b.blocker_id = p_other     AND b.blocked_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.fn_block_between_viewer(uuid) IS
    'TICKET-124 (review fix): true iff a block exists either direction between the '
    'caller (auth.uid()) and p_other. SECURITY DEFINER — reads past blocked_users '
    'blocker-only RLS; caller-scoped so it is not a who-blocked-whom oracle. Used by '
    'can_view_entry Branch 4 (INVOKER) to enforce the reverse block direction.';

-- Mirror is_supper_member's grant posture: strip the Supabase default EXECUTE on
-- new public functions, then re-grant only to the two intended roles. Branch 4
-- runs under INVOKER (authenticated) on the entries_select_v2 path, so
-- authenticated needs EXECUTE.
REVOKE ALL ON FUNCTION public.fn_block_between_viewer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_block_between_viewer(uuid) TO authenticated, service_role;

-- ── can_view_entry — Branches 1-3 & 5 byte-for-byte from 20260615000200; only
--    Branch 4's inner predicate changes (dead visibility='public' → real gate) ──
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
                AND char_length(trim(COALESCE(e.content, ''))) >= 20
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
    '(non-private + restaurant + rating + >=20-char content + public account + no '
    'block either direction via fn_block_between_viewer). Branches 1-3 and 5 '
    'unchanged from 20260615000200. Still SECURITY INVOKER.';
