-- Migration B: drop permissive entry SELECT policies (privacy lockdown flip)
--
-- PURPOSE
-- -------
-- Single-transaction drop of the four old permissive SELECT policies on entry-adjacent
-- tables. After this migration, the only SELECT policies in force are the _v2 ones
-- created in Migration A (20260502000000). This is the moment the privacy lockdown
-- takes effect for direct client queries.
--
-- PREREQUISITE
-- ------------
-- Migration A (20260502000000) MUST be deployed and verified in staging before this
-- migration is applied. Specifically:
--   1. Run the adversarial devtools test with Migration A only — should still return
--      all rows (because old permissive policies are ORd with _v2).
--   2. Apply Migration B. Re-run adversarial test — MUST return only authorized rows.
--   3. Run manual regression: journal, tables, entry-detail, round-detail, member
--      profile, restaurant page, calibration, wishlist.
--
-- ROLLBACK (if a regression surfaces after B ships)
-- -------------------------------------------------
-- One-off hotfix migration restoring open reads while the real fix is worked out:
--   CREATE POLICY "entries_readable" ON public.entries FOR SELECT USING (true);
-- Not desirable but preserves availability. The _v2 policies remain — just drop them
-- too if needed and re-deploy Migration A from scratch.

BEGIN;

-- ── entries ───────────────────────────────────────────────────────────────────
-- Was: USING (true) — any authenticated user could read any row.
-- Now: only entries_select_v2 (author / tablemate / companion / public-eligible).
DROP POLICY IF EXISTS "entries_readable" ON public.entries;

-- ── entry_participants ────────────────────────────────────────────────────────
-- Was: USING (true) — same open-read failure mode as entries.
-- Now: only entry_participants_select_v2 (self OR can_view_entry on parent).
DROP POLICY IF EXISTS "entry_participants_select" ON public.entry_participants;

-- ── entry_photos ──────────────────────────────────────────────────────────────
-- Was: USING (EXISTS ... WHERE table_members.user_id = auth.uid()) — buggy column
--      reference (should be member_id); silently returned empty for tablemates.
-- Now: only entry_photos_select_v2 (can_view_entry on parent entry) — correct.
DROP POLICY IF EXISTS "entry_photos_select" ON public.entry_photos;

-- ── entry_companions ──────────────────────────────────────────────────────────
-- Was: multi-branch (owner / self / tablemate) — doesn't use can_view_entry,
--      slightly inconsistent with the unified predicate.
-- Now: only entry_companions_select_v2 (self OR can_view_entry on parent).
DROP POLICY IF EXISTS "entry_companions_read" ON public.entry_companions;

COMMIT;
