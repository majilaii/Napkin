-- TICKET-081: Restaurant metadata — phone · website · directions · hours from Google Places.
--
-- Founder reversed the "no menu/hours/phone UI" doctrine on 2026-06-12. These four
-- columns back the quiet metadata action row + hours line on the restaurant page.
--
-- NO grant statement: public.restaurants already has a FULL table grant
-- (`GRANT ALL ON TABLE public.restaurants TO authenticated`, from 20251201113055),
-- so new columns are automatically readable by authenticated reads. (This is the
-- opposite of the `entries` column-whitelist grant trap from TICKET-075 — restaurants
-- is granted whole-table, not column-by-column.)
--
-- `website` is referenced in code as a mapped Places field (websiteUri → website) but
-- was never persisted as a column until now.
--
-- `hours` jsonb shape: { weekdayDescriptions: string[] }
--   - weekdayDescriptions: Places v1 `regularOpeningHours.weekdayDescriptions`.
--     We pin the Places request to languageCode=en so day-name prefixes are English
--     and deterministic; the page derives "today" by MATCHING the weekday name in each
--     description (never by array position — that order is locale-dependent).
--   - NO openNow: Places' `regularOpeningHours.openNow` is a point-in-time flag (true
--     only at fetch time). We persist `hours` and re-read it for weeks, so a stored
--     open/closed claim would be stale. We never store it and show no live open/closed
--     badge. (TICKET-081 fix-pass, Codex HIGH.)

ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS website text,
    ADD COLUMN IF NOT EXISTS google_maps_uri text,
    ADD COLUMN IF NOT EXISTS hours jsonb;

COMMENT ON COLUMN public.restaurants.hours IS
    'Places regularOpeningHours snapshot: { weekdayDescriptions: string[] } (English day-name prefixes via languageCode=en; matched by name, not index). No openNow — point-in-time, stale when cached. TICKET-081.';
