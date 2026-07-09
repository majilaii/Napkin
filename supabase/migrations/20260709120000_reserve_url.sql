-- TICKET-149: Reserve pill — direct booking-page URL resolved from the venue's
-- own website (Google Places exposes no reservation link; Reserve with Google
-- is partner-only). Written by restaurant-history?action=reserve_link.
--
--   reserve_url            — canonical booking page (OpenTable /r/, Resy,
--                            SevenRooms, Tock, TheFork, TableCheck, Chope,
--                            inline, Quandoo). NULL when none found.
--   reserve_url_checked_at — when the resolver last ran. A NULL reserve_url
--                            is re-checked after 30 days; a found URL is sticky.
--
-- Additive columns only: no FK, no RLS change, no embed ambiguity.

alter table public.restaurants
    add column if not exists reserve_url text,
    add column if not exists reserve_url_checked_at timestamptz;
