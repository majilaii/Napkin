-- TICKET-043: entry_tables join — multi-table per entry.
-- Privacy invariant (load-bearing): SELECT RLS is per-row by table_id; a member
-- of Table A must NEVER receive the row (entry, B) for any entry in Table B only.
-- See ticket leak test for the explicit three-viewer-case proof.
--
-- NOTE: RLS policies call SECURITY DEFINER helpers (fn_user_authored_entry and
-- is_table_member) to prevent the recursion chain:
--   can_view_entry → entry_tables (RLS) → entries (RLS) → can_view_entry
-- The helpers are defined in 20260509000015_secdef_helpers.sql, which MUST be
-- deployed after this migration so they exist when can_view_entry_v2 calls them.
-- The entry_tables policies themselves only need to run AFTER helpers exist, so
-- we use CREATE POLICY here and rely on the helpers migration running first.

CREATE TABLE public.entry_tables (
    entry_id   uuid        NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    table_id   uuid        NOT NULL REFERENCES public.tables(id)  ON DELETE CASCADE,
    posted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, table_id)
);

-- Feed pagination: filter by table_id, order by posted_at desc, entry_id desc.
CREATE INDEX idx_entry_tables_table_posted_at
    ON public.entry_tables (table_id, posted_at DESC, entry_id DESC);

-- Entry → Tables lookup: "which Tables is this entry in?"
CREATE INDEX idx_entry_tables_entry
    ON public.entry_tables (entry_id);

ALTER TABLE public.entry_tables ENABLE ROW LEVEL SECURITY;

-- SELECT: author OR member of THIS row's table_id (NOT "any linked table").
-- Per-row scoping is what prevents the cross-Table leak.
-- Uses SECURITY DEFINER helpers to break the recursion chain:
--   entry_tables_select → fn_user_authored_entry/is_table_member (SECURITY DEFINER, no RLS recursion)
-- fn_user_authored_entry and is_table_member are defined in 20260509000015.
CREATE POLICY entry_tables_select ON public.entry_tables
    FOR SELECT TO authenticated
    USING (
        public.fn_user_authored_entry(entry_tables.entry_id, auth.uid())
        OR public.is_table_member(entry_tables.table_id, auth.uid())
    );

-- INSERT: caller must be the author AND a current member of the inserted table.
-- Author cannot attach an entry to a Table they're not in.
CREATE POLICY entry_tables_insert ON public.entry_tables
    FOR INSERT TO authenticated
    WITH CHECK (
        public.fn_user_authored_entry(entry_tables.entry_id, auth.uid())
        AND public.is_table_member(entry_tables.table_id, auth.uid())
    );

-- DELETE: author only. No "remove from this Table after the fact" UI in v1, but
-- the policy is here so the author can clean up via tooling without service-role.
CREATE POLICY entry_tables_delete ON public.entry_tables
    FOR DELETE TO authenticated
    USING (public.fn_user_authored_entry(entry_tables.entry_id, auth.uid()));

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- One row per existing entry where table_id IS NOT NULL.
-- posted_at = entries.created_at preserves cursor stability for legacy rows.
INSERT INTO public.entry_tables (entry_id, table_id, posted_at)
SELECT e.id, e.table_id, e.created_at
FROM public.entries e
WHERE e.table_id IS NOT NULL
ON CONFLICT (entry_id, table_id) DO NOTHING;

-- Assertion: every entry with a table_id should have a corresponding row.
DO $$
DECLARE
    missing_count int;
BEGIN
    SELECT COUNT(*) INTO missing_count
    FROM public.entries e
    WHERE e.table_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.entry_tables et
          WHERE et.entry_id = e.id AND et.table_id = e.table_id
      );
    IF missing_count > 0 THEN
        RAISE EXCEPTION 'entry_tables backfill incomplete: % rows missing', missing_count;
    END IF;
END $$;

-- ── Dual-write trigger for transition window (TICKET-043 finding 5) ──────────
-- Mirrors any write that sets entries.table_id into entry_tables. Survives
-- until follow-up ticket drops entries.table_id; then drop this trigger.
CREATE OR REPLACE FUNCTION public.fn_entries_mirror_table_id_to_join()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.table_id IS NOT NULL THEN
        INSERT INTO public.entry_tables (entry_id, table_id, posted_at)
        VALUES (NEW.id, NEW.table_id, COALESCE(NEW.created_at, now()))
        ON CONFLICT (entry_id, table_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entries_mirror_table_id_to_join
    AFTER INSERT OR UPDATE OF table_id ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_entries_mirror_table_id_to_join();

COMMENT ON TRIGGER trg_entries_mirror_table_id_to_join ON public.entries IS
    'TICKET-043: dual-write transition. Mirrors entries.table_id into entry_tables. '
    'DROP this trigger in the follow-up that drops entries.table_id.';

COMMENT ON TABLE public.entry_tables IS
    'TICKET-043: join table — "which Tables is this entry posted to?" '
    'Source of truth replacing entries.table_id for multi-table entries. '
    'entries.table_id retained as table_ids[0] mirror during transition.';
