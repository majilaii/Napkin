-- TICKET-044: Round collapse trigger + cross-kind integrity triggers.
--
-- Architecture decisions (from ticket):
--   - Single AFTER DELETE ON round_entries trigger. The entries→round_entries
--     FK is ON DELETE CASCADE so deleting an entry fires this trigger transitively.
--     No sibling trigger on entries — that was explicitly rejected (ARCH-REVIEW).
--   - Trigger is gated by round kind='merged'. Live rounds with one rater never collapse.
--   - Triggers read only OLD/NEW — no auth.uid() calls.
--   - trg_entries_one_round_only: BEFORE INSERT/UPDATE on entries rejects setting
--     table_night_id when the entry is already in round_entries.
--   - Symmetric BEFORE INSERT on round_entries rejects binding when entry has
--     a non-null table_night_id.

-- ── Helper: collapse the round when fewer than 2 entries remain ─────────────────
CREATE OR REPLACE FUNCTION public.fn_collapse_merged_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_remaining_count int;
    v_round_kind      text;
BEGIN
    -- Only collapse merged rounds. Live rounds are managed by their own state machine.
    SELECT kind INTO v_round_kind
    FROM public.table_nights
    WHERE id = OLD.round_id;

    IF v_round_kind IS DISTINCT FROM 'merged' THEN
        RETURN OLD;
    END IF;

    -- Count remaining bindings AFTER this deletion (OLD row is already gone from the
    -- perspective of the AFTER trigger).
    SELECT count(*) INTO v_remaining_count
    FROM public.round_entries
    WHERE round_id = OLD.round_id;

    IF v_remaining_count < 2 THEN
        -- Delete the table_nights row; FK CASCADE removes any surviving round_entries.
        DELETE FROM public.table_nights WHERE id = OLD.round_id;
    END IF;

    RETURN OLD;
END;
$$;

-- Drop and recreate the trigger (idempotent)
DROP TRIGGER IF EXISTS trg_round_collapse_on_unbind ON public.round_entries;
CREATE TRIGGER trg_round_collapse_on_unbind
    AFTER DELETE ON public.round_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_collapse_merged_round();

-- ── Cross-kind integrity: entries side ────────────────────────────────────────
-- Rejects setting entries.table_night_id when the entry is already in round_entries.
-- (The merge RPC's predicate entry_a.table_night_id IS NULL is the preflight;
--  this trigger is the integrity floor.)

CREATE OR REPLACE FUNCTION public.fn_entries_one_round_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only check when table_night_id is being set to non-null
    IF NEW.table_night_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.round_entries
            WHERE entry_id = NEW.id
        ) THEN
            RAISE EXCEPTION 'entry already bound to a merged round'
                USING ERRCODE = 'P0001',
                      HINT    = 'an entry cannot belong to both a merged round and a live round';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entries_one_round_only ON public.entries;
CREATE TRIGGER trg_entries_one_round_only
    BEFORE INSERT OR UPDATE OF table_night_id ON public.entries
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_entries_one_round_only();

-- ── Cross-kind integrity: round_entries side ──────────────────────────────────
-- Rejects binding an entry to round_entries when that entry already has a live
-- table_night_id (meaning it's part of a live Round-Mode round).

CREATE OR REPLACE FUNCTION public.fn_round_entries_no_live_bind()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table_night_id uuid;
BEGIN
    SELECT table_night_id INTO v_table_night_id
    FROM public.entries
    WHERE id = NEW.entry_id;

    IF v_table_night_id IS NOT NULL THEN
        RAISE EXCEPTION 'entry is already part of a live round'
            USING ERRCODE = 'P0001',
                  HINT    = 'cannot merge an entry that belongs to a live Round-Mode round';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_entries_no_live_bind ON public.round_entries;
CREATE TRIGGER trg_round_entries_no_live_bind
    BEFORE INSERT ON public.round_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_round_entries_no_live_bind();

-- ── Test assertions (regression) ─────────────────────────────────────────────
-- Manual verification sequence (no pg_tap; see build log):
--
-- 1. Collapse trigger: insert a merged round + 2 round_entries, delete one →
--    expect table_nights row deleted and remaining round_entries gone.
--
-- 2. No-collapse on live: insert a live round + table_night_participants, no
--    round_entries → trigger never fires on live participant rows. ✓
--
-- 3. Cross-kind entry→round_entries: insert entry with table_night_id set,
--    try INSERT INTO round_entries → expect P0001.
--
-- 4. Cross-kind round_entries→entry: bind entry in round_entries,
--    try UPDATE entries SET table_night_id=<id> → expect P0001.
