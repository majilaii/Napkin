-- TICKET-044: Round merge schema
-- Adds kind discriminator to table_nights; makes status nullable for merged rows;
-- creates round_entries join table with PK on entry_id (enforces one-round-per-entry).
--
-- Architecture decisions (from ticket):
--   1. kind='merged' + status=NULL keeps merged rows out of the live state machine.
--   2. round_entries.entry_id PRIMARY KEY is the DB-enforced at-most-one invariant.
--   3. round_entries.table_id carries the table scope so multi-table entries stay
--      solo in unrelated Tables.
--
-- [ARCH-REVIEW] verified: no entries.round_id column introduced.

-- ── 1. Extend table_nights ─────────────────────────────────────────────────────

-- Add kind column with default 'live' so existing rows backfill automatically.
ALTER TABLE public.table_nights
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'live';

-- Backfill all existing rows (no-op if column was just added with DEFAULT)
UPDATE public.table_nights SET kind = 'live' WHERE kind IS DISTINCT FROM 'live';

-- Kind constraint
ALTER TABLE public.table_nights
    DROP CONSTRAINT IF EXISTS table_nights_kind_check;
ALTER TABLE public.table_nights
    ADD CONSTRAINT table_nights_kind_check
        CHECK (kind IN ('live', 'merged'));

-- Make status nullable — merged rows have status=NULL to stay out of live state machine.
ALTER TABLE public.table_nights
    ALTER COLUMN status DROP NOT NULL;

-- Enforce the invariant: live rows always have a status; merged rows never do.
ALTER TABLE public.table_nights
    DROP CONSTRAINT IF EXISTS table_nights_kind_status_check;
ALTER TABLE public.table_nights
    ADD CONSTRAINT table_nights_kind_status_check
        CHECK (
            (kind = 'live'   AND status IS NOT NULL) OR
            (kind = 'merged' AND status IS NULL)
        );

-- ── 2. round_entries join table ────────────────────────────────────────────────
-- entry_id PRIMARY KEY enforces at-most-one-round-per-entry globally.
-- ON DELETE CASCADE on both FKs means:
--   - Deleting table_nights → cascades to round_entries (removes bindings).
--   - Deleting entries → cascades to round_entries (triggers collapse).

CREATE TABLE IF NOT EXISTS public.round_entries (
    round_id   uuid        NOT NULL REFERENCES public.table_nights(id) ON DELETE CASCADE,
    entry_id   uuid        PRIMARY KEY REFERENCES public.entries(id) ON DELETE CASCADE,
    table_id   uuid        NOT NULL REFERENCES public.tables(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for round lookups
CREATE INDEX IF NOT EXISTS round_entries_round_id_idx
    ON public.round_entries (round_id);

-- Index for table-scoped feed exclusion (used heavily in fn_table_activity_page)
CREATE INDEX IF NOT EXISTS round_entries_table_entry_idx
    ON public.round_entries (table_id, entry_id);

-- ── 3. RLS on round_entries ────────────────────────────────────────────────────
-- SELECT: any member of round_entries.table_id.
-- INSERT/DELETE: service_role only (all mutations go through RPCs/edge functions).

ALTER TABLE public.round_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS round_entries_select_policy ON public.round_entries;
CREATE POLICY round_entries_select_policy
    ON public.round_entries FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.table_members tm
            WHERE tm.table_id = round_entries.table_id
              AND tm.member_id = auth.uid()
        )
    );

-- Service-role bypasses RLS; no INSERT/UPDATE/DELETE policy needed for service_role.
-- Explicit deny for authenticated to surface misuse attempts.
DROP POLICY IF EXISTS round_entries_write_deny_policy ON public.round_entries;
CREATE POLICY round_entries_write_deny_policy
    ON public.round_entries FOR ALL
    TO authenticated
    USING (false);

-- ── Test assertions (regression) ─────────────────────────────────────────────
-- Manual verification sequence (no pg_tap; see build log):
--
-- 1. Verify existing table_nights rows have kind='live':
--    SELECT count(*) FROM table_nights WHERE kind <> 'live';  -- expect 0
--
-- 2. Verify kind CHECK:
--    INSERT INTO table_nights (..., kind) VALUES (..., 'bogus');  -- expect violation
--
-- 3. Verify kind/status invariant:
--    UPDATE table_nights SET status=NULL WHERE kind='live' LIMIT 1;  -- expect violation
--    UPDATE table_nights SET status='rating' WHERE kind='merged' LIMIT 1;  -- expect violation
--
-- 4. Verify entry_id PK (one-round-per-entry):
--    INSERT INTO round_entries (round_id, entry_id, table_id) VALUES (<r1>, <e>, <t>);
--    INSERT INTO round_entries (round_id, entry_id, table_id) VALUES (<r2>, <e>, <t>);  -- expect PK violation
