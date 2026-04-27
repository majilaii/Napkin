-- TICKET-057 — Google Places photo attribution + source enum.
--
-- Adds two nullable columns to public.restaurants:
--   places_photo_attribution_html — raw html_attributions string captured
--     when a Places photo is mirrored to Storage by _storeHeroPhoto.
--   photo_source — typed enum so RestaurantHero branches without URL inspection.
--
-- photo_source values:
--   'user'   — user-uploaded entry photo promoted to hero
--   'table'  — Table photo promoted to hero
--   'places' — Google Places mirror with attribution
--   'none'   — Sentinel: we tried to source a Places photo but none was usable
--              (empty html_attributions or quota miss). The hero falls through
--              to the TICKET-041 invitation state. The lazy-backfill trigger in
--              app/restaurant/[id].tsx skips rows with photo_source = 'none' so
--              we don't re-fire Place Details on every page visit. NULL means
--              "never attempted" (legacy rows pre-this-migration).
--
-- Integrity invariant: if a row has Places attribution, the source MUST be
-- 'places'. A non-Places source (including 'none') MUST NOT carry attribution.
-- A CHECK constraint enforces this in all directions, so any future writer
-- (centralized or not) is unable to land an invalid combination. The constraint
-- is written so a NULL photo_source with a non-NULL attribution is rejected
-- unambiguously (Postgres treats UNKNOWN as PASS in CHECKs, so we make the
-- coupling explicit).

alter table public.restaurants
    add column if not exists places_photo_attribution_html text,
    add column if not exists photo_source text;

alter table public.restaurants
    add constraint restaurants_photo_source_check
    check (photo_source is null or photo_source in ('user', 'table', 'places', 'none'));

-- Source ↔ attribution coupling. NULL attribution is always fine. Non-NULL
-- attribution requires photo_source = 'places' explicitly — not NULL,
-- not 'none', not 'user', not 'table'.
alter table public.restaurants
    add constraint restaurants_attribution_requires_places
    check (
        places_photo_attribution_html is null
        or (photo_source is not null and photo_source = 'places')
    );

comment on column public.restaurants.places_photo_attribution_html is
    'Raw html_attributions[0] from Google Place Details, captured when the row''s photo_url is a Places-mirrored Storage URL. NULL whenever photo_source != ''places''.';
comment on column public.restaurants.photo_source is
    'Provenance of restaurants.photo_url: user-uploaded (''user''), Table-promoted (''table''), Places mirror (''places''), or sentinel ''none'' = tried Places, nothing usable (do not retry). NULL = never attempted.';
