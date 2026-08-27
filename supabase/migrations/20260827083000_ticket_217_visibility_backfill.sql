-- TICKET-217 backfill (founder order 2026-08-27: "yes backfill the old rows").
--
-- Context: between the 2026-07-22 visibility reversal (solo logs default
-- 'friends', table-shared 'table', never silent 'private') and the 2026-08-26
-- fixes (PR #331), three write paths still applied a silent 'private' default:
--   - lib/composer.ts (create-entry + log-meal solo logs)
--   - entry fn merge_with fallback
--   - entry fn attach-take fallback (supper takes)
--
-- No shipped client UI has ever offered an explicit per-log "private" choice
-- (per-log privacy toggles are rejected doctrine), so every 'private' row
-- created on/after 2026-07-22 is a bug artifact, not a user decision. Rows
-- created BEFORE the reversal were written under the old logs-default-private
-- doctrine and are deliberately left untouched (same consent posture as
-- 20260722091500_founder_visibility_default_reversal.sql).
--
-- Account-level privacy still gates all public surfacing; this only restores
-- the doctrine default the rows should have carried.
--
-- Cutoff = the reversal's own migration timestamp (20260722091500 -> 09:15 UTC),
-- NOT midnight: logs created earlier that morning were still written under the
-- old logs-default-private doctrine and keep their consent posture.
--
-- Replay-from-zero: a fresh DB has no such rows; this is a 0-row no-op there.

DO $t217_backfill$
DECLARE
  n_table integer;
  n_solo integer;
BEGIN
  -- Table-shared context (attached to a Table, or part of a Supper) → 'table'.
  UPDATE public.entries e
  SET visibility = 'table'
  WHERE e.visibility = 'private'
    AND e.created_at >= timestamptz '2026-07-22 09:15:00+00'
    AND (
      e.supper_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.entry_tables et WHERE et.entry_id = e.id
      )
    );
  GET DIAGNOSTICS n_table = ROW_COUNT;

  -- Remaining silent-'private' rows in the window are solo logs → 'friends'.
  UPDATE public.entries e
  SET visibility = 'friends'
  WHERE e.visibility = 'private'
    AND e.created_at >= timestamptz '2026-07-22 09:15:00+00';
  GET DIAGNOSTICS n_solo = ROW_COUNT;

  RAISE NOTICE 'TICKET-217 backfill: % table/supper rows -> table, % solo rows -> friends',
    n_table, n_solo;
END;
$t217_backfill$;
