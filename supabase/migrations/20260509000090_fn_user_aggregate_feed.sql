-- TICKET-043 review-fix: aggregate feed RPC with DISTINCT ON + SQL keyset cursor.
-- Codex Review 1 finding #4 / Claude BLOCKER 3: feed/index.ts JS-dedups AFTER a 93-row
-- LIMIT, so duplicates can consume the limit and cursor filtering misses older entries.
-- Move both DISTINCT ON and keyset cursor into SQL; service-role only.
--
-- Returns one row per entry, regardless of how many of the caller's Tables it appears in.
-- Cursor (visited_at, id) is applied BEFORE LIMIT so deep pagination is correct.
-- table_id is intentionally NOT returned — aggregate feed payload omits it per privacy.

CREATE OR REPLACE FUNCTION public.fn_user_aggregate_feed(
    p_user_id        uuid,
    p_table_ids      uuid[],
    p_since          timestamptz,
    p_cursor_date    timestamptz,
    p_cursor_id      uuid,
    p_limit          int
)
RETURNS TABLE (
    id              uuid,
    user_id         uuid,
    restaurant_id   uuid,
    rating          numeric,
    content         text,
    dish_description text,
    visited_at      timestamptz,
    created_at      timestamptz,
    table_night_id  uuid,
    photo_url       text,
    reaction_count  int,
    comment_count   int,
    top_emojis      jsonb,
    sort_date       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH joined AS (
        SELECT DISTINCT ON (e.id)
            e.id,
            e.user_id,
            e.restaurant_id,
            e.rating,
            e.content,
            e.dish_description,
            e.visited_at,
            e.created_at,
            e.table_night_id,
            e.photo_url,
            e.reaction_count,
            e.comment_count,
            e.top_emojis,
            COALESCE(e.visited_at, e.created_at) AS sort_date
        FROM public.entry_tables et
        JOIN public.entries e ON e.id = et.entry_id
        WHERE et.table_id = ANY(p_table_ids)
          AND e.table_night_id IS NULL
          AND COALESCE(e.visited_at, e.created_at) >= p_since
        ORDER BY e.id, et.posted_at DESC
    )
    SELECT id, user_id, restaurant_id, rating, content, dish_description,
           visited_at, created_at, table_night_id, photo_url,
           reaction_count, comment_count, top_emojis, sort_date
    FROM joined
    WHERE p_cursor_date IS NULL
       OR (sort_date, id) < (p_cursor_date, p_cursor_id)
    ORDER BY sort_date DESC, id DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_user_aggregate_feed(uuid, uuid[], timestamptz, timestamptz, uuid, int) IS
    'TICKET-043: aggregate feed for a user across their Tables. DISTINCT ON entry id collapses '
    'multi-Table entries to one row. Keyset cursor on (sort_date, id). Service-role only — '
    'edge fn must membership-gate p_user_id before invoking.';

REVOKE EXECUTE ON FUNCTION public.fn_user_aggregate_feed(uuid, uuid[], timestamptz, timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_aggregate_feed(uuid, uuid[], timestamptz, timestamptz, uuid, int)
    TO service_role;
