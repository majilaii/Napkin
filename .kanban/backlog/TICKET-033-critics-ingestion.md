---
id: TICKET-033
title: "Professional critics ingestion (scraper + operator suppression)"
priority: medium
status: backlog
created: 2026-04-23
updated: 2026-04-23
tags: [restaurants, critics, ingestion, ops]
---

# Professional critics ingestion

## Problem

TICKET-026 ships the read path for professional critic reviews: schema, RLS,
read-path edge function, `ProfessionalTakesBand` on the Visits tab, and a
hand-curated seed file so the UI can be verified end-to-end. What's explicitly
out of scope for 026 is the thing that actually fills the table — the scraper.

Today `professional_critic_reviews` is populated only by `supabase/seeds/critics_seed.sql`.
Outside of the ~5 seeded restaurants the band is invisible, because there are no
rows. To ship critics as a real signal we need a repeatable ingestion pipeline:

- Pull Pete Wells star ratings + excerpts from NYT review pages (the spine).
- Pull The Infatuation's 10-point scores from review pages (second priority).
- Pull Eater's Essentials list memberships as `kind=essential` badges.
- Upsert into `professional_critic_reviews` keyed on `(restaurant_id, publication)`.
- Operate incrementally: backfill once, then drip-fill as new `restaurants` rows appear.

Plus the operator side that 026 left behind — today the only takedown path is
"run SQL to flip `suppressed=true`." Fine at seed-level scale; unacceptable once
ingestion is live.

## Notes

### Blocking precondition

**TICKET-026 must be DONE.** 026 owns:
- The `professional_critic_reviews` migration + RLS.
- The wire shape surfaced by `restaurant-history?action=page`.
- The `ProfessionalTakesBand` client component + visible acceptance criteria.

033 consumes the table and the shape; it does not mutate either. If a schema
change proves necessary during ingestion (e.g. a nullable `revised_from_date`
for Infatuation re-reviews), push back to a follow-up migration ticket rather
than expanding scope here.

### MVP plan

- **NYT first.** Pete Wells stars are the highest-signal row on any NYC
  restaurant. Start with a Deno scheduled function that takes a `restaurants.id`
  or a batch of them, resolves `external_id` → Google Place name + address,
  queries NYT's site search, and parses the review page's structured fragments
  (stars element, dateline, byline, first graf for excerpt).
- **Infatuation next.** 10-point score + short summary. Same skeleton.
- **Eater Essentials last.** Not a review page — a list-membership check against
  Eater's 38 Essentials map. Produces `kind=essential` rows with `published_date`
  set to the list publication year.
- **Resy / OpenTable: skip.** Booking-availability is not editorial.
- Keyed off `restaurants.external_id` → name + address. Rate-limit politely.
  Cache aggressively: critic reviews do not change daily. Treat `scraped_at`
  as the refresh anchor; re-scrape no more than once per month per row.

### Operator suppression UX

SQL-only is acceptable at MVP-ingestion scale but should not remain the only
path. Minimum viable admin: a small `/admin/critics` surface gated by an
`is_admin` flag on `profiles`, listing recently-ingested rows with a "suppress"
toggle. Scope the UI ruthlessly — no editing, just flag-and-comment. Anything
richer (re-author, re-score) is a correction pipeline, not v1.

### Excerpt licensing

Locked at ≤30 words + attribution + source link, per the editorial-citation
posture in TICKET-026. Architect should re-confirm before scaling beyond NYT.
Do not reproduce full reviews. Do not ingest reviews without publication name
attached to the excerpt.

### Explicitly deferred

- Non-US publications (Time Out London, Guardian Food) — US-first.
- Blog / Substack / independent writers — low signal-to-noise without a curated
  allowlist. Defer to a "Notable voices" tier when/if that ships.
- A full admin console with audit history / rollback — SQL remains the escape
  hatch.
- Push notifications on critic updates — deferred product-wide.

### Dependencies

- **TICKET-026** (this ticket's precondition) — schema, read path, seed, UI.
- **TICKET-014** (restaurant entity foundation) — `restaurants.external_id` is
  the scrape join key.
