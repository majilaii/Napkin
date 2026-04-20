-- TICKET-025: composite index for regulars + top-four derivation
-- entries(user_id, restaurant_id) is used by fetchTopFour and fetchRegulars
-- which group all entries for a user by restaurant_id.
-- Without this, both queries do a full user_id scan and then filter by restaurant_id.

CREATE INDEX IF NOT EXISTS idx_entries_user_restaurant
    ON public.entries (user_id, restaurant_id);
