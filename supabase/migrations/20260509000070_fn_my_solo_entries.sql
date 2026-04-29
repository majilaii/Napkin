-- TICKET-043: SECURITY DEFINER read helper for useMySoloEntries.
--
-- After the column-level revoke (20260509000005), authenticated clients can no
-- longer do `.is('table_id', null)` filtering because PostgREST cannot filter
-- on a column the role cannot read. This function bypasses that constraint.
--
-- Strengthened with auth.uid() check: p_user_id MUST equal auth.uid() inside
-- the predicate so callers cannot read another user's solo entries.
--
-- Returns only feed-only entries: table_id IS NULL AND table_night_id IS NULL
-- AND no entry_tables rows exist.
--
-- EXECUTE granted to authenticated (caller must be the owner — enforced by
-- the AND p_user_id = auth.uid() predicate).
--
-- Addresses [ARCH-REVIEW] finding 1 callsite remediation.

CREATE OR REPLACE FUNCTION public.fn_my_solo_entries(p_user_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    restaurant_id uuid,
    rating numeric,
    content text,
    dish_description text,
    visited_at timestamptz,
    created_at timestamptz,
    photo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.id,
        e.user_id,
        e.restaurant_id,
        e.rating,
        e.content,
        e.dish_description,
        e.visited_at,
        e.created_at,
        e.photo_url
    FROM public.entries e
    WHERE e.user_id = p_user_id
      AND p_user_id = auth.uid()   -- security: caller can only read own entries
      AND e.table_id IS NULL
      AND e.table_night_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.entry_tables et WHERE et.entry_id = e.id)
    ORDER BY COALESCE(e.visited_at, e.created_at) DESC
    LIMIT p_limit;
$$;

-- Revoke from PUBLIC/anon; allow authenticated so the hook can call via supabase.rpc().
REVOKE EXECUTE ON FUNCTION public.fn_my_solo_entries(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_solo_entries(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.fn_my_solo_entries(uuid, int) IS
    'TICKET-043: SECURITY DEFINER helper for useMySoloEntries.ts. '
    'Needed because authenticated cannot filter on entries.table_id after the '
    'column-level revoke in 20260509000005. '
    'Includes auth.uid() check to prevent reading other users solo entries.';
