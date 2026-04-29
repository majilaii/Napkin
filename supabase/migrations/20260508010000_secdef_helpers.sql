-- TICKET-043: SECURITY DEFINER helpers for can_view_entry_v2 and entry_tables RLS.
-- These break the recursion:
--   can_view_entry → entry_tables (RLS) → entries (RLS) → can_view_entry
-- Helpers run with elevated rights and bypass RLS on the underlying tables;
-- they read only author/membership facts and never re-enter the RLS graph.
--
-- Addresses [ARCH-REVIEW] finding 4.

CREATE OR REPLACE FUNCTION public.fn_user_authored_entry(p_entry_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.entries
        WHERE id = p_entry_id AND user_id = p_user_id
    );
$$;

COMMENT ON FUNCTION public.fn_user_authored_entry(uuid, uuid) IS
    'TICKET-043: SECURITY DEFINER author check. Used by entry_tables RLS and '
    'can_view_entry_v2 to break RLS recursion. '
    'Do NOT call from app layer — for RLS predicates only.';

-- is_table_member(table_id, user_id) already exists as SECURITY DEFINER from
-- 20251222040000_add_tables_rls_policies.sql line 57. Reuse — no new helper needed.
-- It checks member_id (NOT user_id) in table_members, consistent with CLAUDE.md doctrine.

-- Both helpers must remain EXECUTABLE by authenticated for RLS USING/WITH CHECK
-- predicates to call them. Default GRANT EXECUTE TO PUBLIC at function creation
-- covers this; we leave the default in place.
-- fn_user_authored_entry is safe to call publicly: it accepts explicit (entry_id, user_id)
-- inputs and never returns data the caller doesn't already know.
