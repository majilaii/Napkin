-- TICKET-154 follow-up (Copilot review on #193): get_public_reviews_page
-- filters by restaurant_id and walks (created_at, id) DESC; the pre-existing
-- single-column entries_restaurant_id_idx forces a re-sort of every matching
-- row on each page fetch as review counts grow. Separate migration because
-- 20260710130000 was already applied to prod before the review fix landed.
CREATE INDEX IF NOT EXISTS entries_restaurant_created_id_idx
    ON entries (restaurant_id, created_at DESC, id DESC);
