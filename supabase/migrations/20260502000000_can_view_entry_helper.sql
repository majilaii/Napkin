-- Migration A: can_view_entry helper + _v2 SELECT policies (parallel preview)
--
-- PURPOSE
-- -------
-- Introduces the authoritative read predicate `can_view_entry(entries)` that
-- encodes the four-branch rule (author / tablemate / companion /
-- public-eligible-with-public-profile) for entries and all entry-adjacent tables.
--
-- STRATEGY: two-migration flip
-- This migration creates _v2 policies ALONGSIDE the existing permissive policies.
-- Postgres ORs multiple SELECT policies together, so the effective read surface is
-- unchanged (still permissive) while we verify shape and EXPLAIN plans in staging.
-- Migration B (20260502000100) drops the old permissive policies in a single
-- atomic transaction — that is the moment the privacy lockdown takes effect.
--
-- ROLLBACK (if B has NOT shipped)
--   DROP POLICY entries_select_v2 ON public.entries;
--   DROP POLICY entry_participants_select_v2 ON public.entry_participants;
--   DROP POLICY entry_photos_select_v2 ON public.entry_photos;
--   DROP POLICY entry_companions_select_v2 ON public.entry_companions;
--   DROP FUNCTION IF EXISTS public.can_view_entry(public.entries);
--   DROP FUNCTION IF EXISTS public.is_entry_companion(uuid, uuid);
--
-- ROLLBACK (if B HAS shipped)
--   One-off hotfix migration:
--   CREATE POLICY entries_readable ON public.entries FOR SELECT USING (true);
--   (Restores open reads while the real fix is worked out.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEFINER helper — breaks RLS recursion on entry_companions
--
-- When entry_companions_select_v2 calls can_view_entry(e), and can_view_entry
-- needs to check whether the caller is a companion on e.id, reading
-- entry_companions directly would re-enter the policy being evaluated → infinite
-- recursion. The SECURITY DEFINER wrapper bypasses entry_companions' own RLS
-- (exactly like is_table_member bypasses table_members' RLS).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_entry_companion(p_entry_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.entry_companions
        WHERE entry_id = p_entry_id
          AND user_id   = p_user_id
    );
$$;

COMMENT ON FUNCTION public.is_entry_companion(uuid, uuid) IS
  'SECURITY DEFINER helper used by can_view_entry to check companion membership
   without recursing into the entry_companions SELECT policy. Mirrors the pattern
   of is_table_member() from 20251222040000. Do not call directly from application
   code — use can_view_entry instead.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Row-type predicate — single source of truth for entry read visibility
--
-- SECURITY INVOKER: the caller's RLS on profiles and table_members is respected.
-- STABLE: safe for the planner to evaluate once per row; cannot be IMMUTABLE
--         because auth.uid() is session-scoped.
-- DO NOT add SECURITY DEFINER here — see Technical Design §Architecture Decisions.
-- DO NOT read entry_companions directly inside this function — use is_entry_companion().
--
-- Public-eligibility predicate is inlined (rather than calling is_entry_publicly_eligible)
-- to save one extra function call per row. Keep in sync with is_entry_publicly_eligible()
-- from 20260430000000; if that function changes, update here too.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            -- Branch 1: Author always sees their own entry regardless of visibility.
            e.user_id = auth.uid()

            -- Branch 2: Tablemate — entry was shared to a Table the viewer is also in.
            -- Guard on IS NOT NULL is required: feed-only entries (table_id=NULL)
            -- must not fall through to is_table_member(NULL, ...).
            OR (
                e.table_id IS NOT NULL
                AND public.is_table_member(e.table_id, auth.uid())
            )

            -- Branch 3: Companion — tagged presence intentionally overrides visibility='private'.
            -- Doctrine reference: 20260427000000_entry_companions.sql header comment.
            -- Uses DEFINER helper to avoid recursion with entry_companions_select_v2.
            OR public.is_entry_companion(e.id, auth.uid())

            -- Branch 4: Public-eligible — visibility='public' + non-trivial review content +
            -- author's profile is opted-in to public. Mirrors is_entry_publicly_eligible()
            -- from 20260430000000 but inlined to avoid an extra function call per row.
            -- sync-point: if is_entry_publicly_eligible changes, update this branch too.
            OR (
                e.visibility = 'public'
                AND e.rating IS NOT NULL
                AND char_length(trim(COALESCE(e.content, ''))) >= 20
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.user_id       = e.user_id
                      AND p.account_privacy = 'public'
                )
            )
        );
$$;

COMMENT ON FUNCTION public.can_view_entry(public.entries) IS
  'Single source of truth for entry read visibility. Four branches:
   1. Author (always).
   2. Tablemate (entry shared to a shared Table).
   3. Companion (tagged presence — overrides visibility=private by design).
   4. Public-eligible (visibility=public + rating + ≥20-char content + author profile=public).
   SECURITY INVOKER so caller RLS on profiles/table_members is respected.
   Reads entry_companions via is_entry_companion() (DEFINER) to avoid recursion.
   Inlines the public-eligibility predicate from is_entry_publicly_eligible() — keep in sync.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Index — restaurant+visibility partial index for the napkin-aggregate path.
--
-- The four existing indexes that cover the new EXISTS predicates are confirmed:
--   • table_members PK (table_id, member_id)   → covers is_table_member lookup
--   • entry_companions PK (entry_id, user_id)  → covers is_entry_companion lookup
--   • entry_companions_user_idx (user_id, created_at desc) → reverse lookup
--   • profiles_user_account_privacy_idx (user_id, account_privacy, allow_public_replies)
--     → covers the public-branch EXISTS on profiles
--
-- The only new index is the partial one for restaurant-history napkin aggregate:
-- WHERE restaurant_id = $1 AND visibility <> 'private'. At current table sizes
-- this is fine without it, but the partial index prevents a future seq-scan regression.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS entries_restaurant_visibility_idx
    ON public.entries (restaurant_id, visibility)
    WHERE visibility <> 'private';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. _v2 SELECT policies — run alongside old ones (OR'd by Postgres).
--    No old policy is dropped here; this migration is purely additive.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── entries ──────────────────────────────────────────────────────────────────
-- Old policy: "entries_readable" USING (true) — kept until Migration B.
-- New policy: the full four-branch predicate via can_view_entry.
-- TO authenticated ensures anon users get no direct read (public surfaces use
-- service-role edge functions).
CREATE POLICY "entries_select_v2" ON public.entries
    FOR SELECT TO authenticated
    USING (public.can_view_entry(entries));

-- ── entry_participants ────────────────────────────────────────────────────────
-- Old policy: "entry_participants_select" USING (true) — kept until Migration B.
-- New policy: self OR (can view the parent entry). If you can see the entry,
-- you can see who participated in it.
CREATE POLICY "entry_participants_select_v2" ON public.entry_participants
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_participants.entry_id
              AND public.can_view_entry(e)
        )
    );

-- ── entry_photos ──────────────────────────────────────────────────────────────
-- Old policy: "entry_photos_select" — buggy (references table_members.user_id
-- which does not exist; should be member_id). For Tablemates this policy silently
-- returns empty today. The v2 policy is strictly additive and fixes the bug.
-- Note on behavior change: Tablemates will now correctly receive photos they were
-- entitled to but weren't getting due to the bug. This is additive, not breaking.
CREATE POLICY "entry_photos_select_v2" ON public.entry_photos
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_photos.entry_id
              AND public.can_view_entry(e)
        )
    );

-- entry_photos INSERT/DELETE policies already correctly gate on
-- "entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())".
-- No change to write policies needed.

-- ── entry_companions ──────────────────────────────────────────────────────────
-- Old policy: "entry_companions_read" — multi-branch (owner / self / tablemate)
-- but does not account for companion-only visibility on private entries, and
-- the tablemate branch may expose companion lists on entries the viewer shouldn't
-- see. Replace with: self (you are tagged) OR (can_view_entry on parent entry).
-- Rationale: if you can see the entry, you can see who was tagged on it.
CREATE POLICY "entry_companions_select_v2" ON public.entry_companions
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_companions.entry_id
              AND public.can_view_entry(e)
        )
    );

-- entry_companions INSERT/DELETE policies unchanged (entry-owner only).
