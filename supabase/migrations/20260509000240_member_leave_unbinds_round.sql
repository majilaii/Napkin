-- TICKET-044: Member leave / remove-member unbinds round entries.
--
-- When a member leaves a Table (or is removed), their round_entries rows for
-- that table are deleted BEFORE the table_members row is deleted.
-- The AFTER DELETE ON round_entries trigger (trg_round_collapse_on_unbind) then
-- fires and collapses any merged round that falls below 2 entries.
--
-- This SQL function is called from the table-management edge function inside
-- the same transaction as the table_members delete.
--
-- Architecture decisions:
--   - No auth.uid() — service-role context. Actor IDs passed explicitly.
--   - Scoped to (p_table_id, p_leaver_user_id) so the same user's entries in
--     OTHER Tables are untouched.
--   - The collapse trigger fires for each deleted round_entries row;
--     PL/pgSQL handles the cascade atomically.

CREATE OR REPLACE FUNCTION public.fn_leave_table_unbind_rounds(
    p_table_id        uuid,
    p_leaver_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Delete all round_entries rows for entries authored by the leaver
    -- that are scoped to this table. The collapse trigger handles the rest.
    DELETE FROM public.round_entries re
    WHERE re.table_id = p_table_id
      AND re.entry_id IN (
          SELECT e.id FROM public.entries e
          WHERE e.user_id = p_leaver_user_id
      );
END;
$$;

-- Service-role only.
REVOKE EXECUTE ON FUNCTION public.fn_leave_table_unbind_rounds(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_leave_table_unbind_rounds(uuid, uuid)
    TO service_role;

-- ── Test assertions (regression) ─────────────────────────────────────────────
-- Manual verification sequence (see build log):
--
-- 1. User A and B have a merged round in Table X.
--    Call fn_leave_table_unbind_rounds(table_x_id, a_user_id).
--    Expect: round_entries for A's entry deleted, trigger collapses round,
--            B's entry returns to solo feed in Table X.
--
-- 2. Same user A has entries in Table X and Table Y.
--    They have merged rounds in both tables.
--    Call fn_leave_table_unbind_rounds(table_x_id, a_user_id).
--    Expect: only Table X round_entries deleted; Table Y round intact.
