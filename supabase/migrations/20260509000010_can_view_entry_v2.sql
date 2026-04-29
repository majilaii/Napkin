-- TICKET-043: rewrite can_view_entry to OR over entry_tables membership.
-- Branch 2 (tablemate) replaces single e.table_id check with EXISTS over entry_tables.
-- Uses SECURITY DEFINER helpers to prevent the recursion chain:
--   can_view_entry → entry_tables (RLS: uses helpers) → terminates safely
--
-- Backward compatibility: legacy entries with table_id set will have a backfilled
-- entry_tables row, so this is strictly a generalization.
--
-- MUST be deployed AFTER 20260509000015_secdef_helpers.sql (fn_user_authored_entry)
-- and AFTER 20260509000000_entry_tables.sql (the entry_tables table).
--
-- Addresses [ARCH-REVIEW] finding 4.

CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            -- Branch 1: Author. SECURITY DEFINER helper avoids re-entry into entries RLS.
            public.fn_user_authored_entry(e.id, auth.uid())

            -- Branch 2: Tablemate via entry_tables. SECURITY DEFINER is_table_member
            -- avoids re-entry into table_members RLS.
            -- Note: we query entry_tables here under invoker's RLS; the
            -- entry_tables_select policy itself uses helpers, so the chain terminates:
            --   can_view_entry → entry_tables_select → fn_user_authored_entry/is_table_member
            --   (both SECURITY DEFINER, no further RLS recursion)
            OR EXISTS (
                SELECT 1
                FROM public.entry_tables et
                WHERE et.entry_id = e.id
                  AND public.is_table_member(et.table_id, auth.uid())
            )

            -- Branch 3: Companion — tagged presence intentionally overrides visibility='private'.
            -- Uses SECURITY DEFINER helper to avoid recursion with entry_companions_select_v2.
            OR public.is_entry_companion(e.id, auth.uid())

            -- Branch 4: Public-eligible — visibility='public' + non-trivial review content +
            -- author profile=public. Inlined; sync with is_entry_publicly_eligible.
            OR (
                e.visibility = 'public'
                AND e.rating IS NOT NULL
                AND char_length(trim(COALESCE(e.content, ''))) >= 20
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.user_id = e.user_id
                      AND p.account_privacy = 'public'
                )
            )
        );
$$;

COMMENT ON FUNCTION public.can_view_entry(public.entries) IS
    'TICKET-043: branch 2 now ORs over entry_tables membership instead of single '
    'e.table_id check. Uses SECURITY DEFINER helpers to prevent RLS recursion. '
    'All other branches unchanged from 20260502000000.';
