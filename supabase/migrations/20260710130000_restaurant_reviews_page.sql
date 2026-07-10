-- TICKET-154: paginated public reviews for a restaurant (the all-reviews page).
-- Keyset variant of get_public_reviews — same eligibility SSOT
-- (is_entry_publicly_eligible) and row shape, minus the total_count window
-- (the page header takes its total from action=page's public_reviews_total).
--
-- Keyset: ORDER BY created_at DESC, id DESC; filter (created_at, id) < cursor.
-- Called by restaurant-history?action=reviews with p_limit = pageSize + 1
-- (the edge function builds the canonical Page<T> envelope from the +1 row).

CREATE OR REPLACE FUNCTION get_public_reviews_page(
    p_restaurant_id UUID,
    p_limit         INT,
    p_cursor_date   TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id     UUID DEFAULT NULL
)
RETURNS TABLE (
    entry_id              UUID,
    user_id               UUID,
    display_name          TEXT,
    username              TEXT,
    avatar_url            TEXT,
    rating                NUMERIC,
    content               TEXT,
    created_at            TIMESTAMPTZ,
    public_reaction_count INT,
    public_reply_count    INT,
    photo_url             TEXT
) LANGUAGE sql STABLE AS $$
    SELECT
        e.id AS entry_id,
        e.user_id,
        p.display_name,
        p.username,
        p.avatar_url,
        e.rating,
        e.content,
        e.created_at,
        e.public_reaction_count,
        e.public_reply_count,
        (
            SELECT ep.photo_url
            FROM entry_photos ep
            WHERE ep.entry_id = e.id
            ORDER BY ep.sort_order ASC
            LIMIT 1
        ) AS photo_url
    FROM entries e
    JOIN profiles p ON p.user_id = e.user_id
    WHERE e.restaurant_id = p_restaurant_id
      AND is_entry_publicly_eligible(e.id)
      AND (
          p_cursor_date IS NULL
          OR (e.created_at, e.id) < (p_cursor_date, p_cursor_id)
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT p_limit;
$$;
