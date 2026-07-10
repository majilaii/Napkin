-- TICKET-106 — Lists in Search: keyset RPC for public-list retrieval.
-- No schema change (columns + RLS pre-exist; 115 added table_id). This is a
-- function migration only. Forward-dated after 115's 20260706160000.
--
-- TRIPLE GATE — all three conditions live in the SQL WHERE because the `lists`
-- edge fn runs with the service-role key (RLS is INERT there). RLS is NOT the
-- gate for this action; the predicate is the only enforcement:
--   1. l.privacy = 'public'          — the list is public
--   2. l.table_id IS NULL            — Tables-never-public (TICKET-115 cross-gate)
--   3. p.account_privacy = 'public'  — the owner's account is public
-- Belt-and-braces: (1)+(2) both guard against a mis-coerced public table list.
--
-- Owner display is JOINed in flat SQL on profiles.user_id = lists.owner_id (NOT a
-- PostgREST embed — lists has NO FK to profiles; embedding profiles:owner_id would
-- 400 → 500, the generalized entries-has-no-FK-to-profiles trap). Returns an
-- EXPLICIT column list — table_id is NEVER returned (no leak vector).

CREATE OR REPLACE FUNCTION public.fn_search_public_lists(
    q             text,
    p_cursor_date timestamptz,
    p_cursor_id   uuid,
    p_limit       int
) RETURNS TABLE (
    id                 uuid,
    owner_id           uuid,
    title              text,
    description        text,
    ranked             boolean,
    emoji              text,
    entry_count        bigint,
    updated_at         timestamptz,
    owner_display_name text,
    owner_avatar_url   text,
    owner_username     text
) LANGUAGE sql STABLE AS $$
    SELECT
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.emoji,
        (SELECT count(*) FROM public.list_entries le WHERE le.list_id = l.id) AS entry_count,
        l.updated_at,
        p.display_name AS owner_display_name,
        p.avatar_url   AS owner_avatar_url,
        p.username     AS owner_username
    FROM public.lists l
    JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE l.privacy = 'public'
      AND l.table_id IS NULL              -- Tables-never-public (TICKET-115 cross-gate)
      AND p.account_privacy = 'public'    -- owner account gate (profiles)
      -- COUPLING (TICKET-125): lists/browse_public calls this fn with q='' so ILIKE '%%'
      -- matches ALL rows (recency browse). Any edit to this WHERE must keep q='' = match-all,
      -- or give browse_public its own fn.
      AND (l.title ILIKE '%' || q || '%' OR COALESCE(l.description, '') ILIKE '%' || q || '%')
      AND (p_cursor_date IS NULL OR (l.updated_at, l.id) < (p_cursor_date, p_cursor_id))
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT p_limit;
$$;

-- Lock down: service-role only (the `lists` edge fn calls it). No client/anon.
REVOKE EXECUTE ON FUNCTION public.fn_search_public_lists(text, timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_public_lists(text, timestamptz, uuid, int)
    TO service_role;
