---
id: TICKET-014
title: "Restaurant entity foundation (Places seed + personal Table + solo log flow)"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [foundation, restaurants, schema, places-api]
---

# Restaurant entity foundation

## Problem

Right now, a restaurant only exists in Napkin if someone has logged it through a Round or solo entry tied to an existing Table. There is no concept of a restaurant as a first-class object — it's a byproduct of logging activity. That blocks three upcoming features:

1. **Wishlist** (personal + emergent Table) — you need to be able to save a restaurant *before* anyone has logged it.
2. **Restaurant search** — users want Letterboxd-style search over a real restaurant catalog, not just places their Tables have been.
3. **Restaurant page v2** — needs a stable entity with external context (Google rating via Places API), independent of whether anyone has reviewed it yet.

There's also a second structural gap: **solo logging**. The doctrine (CLAUDE.md, locked 2026-04-16) now explicitly allows solo logging via a per-user "personal Table" — an auto-created Table with `is_personal = true` that acts as the user's private food diary. Every entry still belongs to a Table; a solo diary is just a Table of one. The schema and signup flow don't yet support this.

This ticket is the foundation that unblocks TICKET-015 (wishlist), TICKET-016 (restaurant page v2), TICKET-017 (search).

## Notes

### Scope of this ticket
Three foundational pieces, all backend-heavy:

1. **Restaurants as first-class entities**
   - Restaurants can exist in our DB *without* an associated entry or round
   - Seed data from Google Places API: `place_id`, name, address, city, country, photo reference, cuisine, price level, Google rating, coordinates
   - On first reference (user wishlists, logs, or views a Places search result), we either defer creation (ghost until interacted with) or persist immediately
   - **Decision (from brainstorm):** **defer creation** — a Places API result is a "ghost" restaurant in the UI; we only write to our DB when someone wishlists, logs, or nominates it. Keeps the DB clean of orphans.
   - When persisted, store the `google_place_id` so we can refresh external data (Google rating, photo) on a schedule or on-demand

2. **Personal Table concept**
   - On user signup, auto-create a Table with `is_personal = true`, `name = "Personal"` (or similar), owner = user, members = [user]
   - The personal Table is invisible in the Tables list UI as a regular Table — it's surfaced differently (e.g., as "Your diary" or via solo entry views)
   - All solo entries attach to this Table; existing schema doesn't change at the entry level — we just need the Table to exist
   - Backfill: every existing user needs a personal Table created via migration

3. **Solo entry flow**
   - User can log an entry to a restaurant without going through a Round / Table Night
   - Triggered from: search result → restaurant page → "Log a visit" button (the UI lives in TICKET-016, but the backend path must exist here)
   - Entry gets attached to the user's personal Table
   - A user can also solo-log a restaurant they've been to with another Table — the solo entry is separate from any Round
   - Existing entry creation edge function may already cover this; audit and adjust if needed

### Product decisions (locked, see memory/)
- **Path A** — Tables-first. No public feed, no Napkin-wide review layer. Google rating shown on restaurant pages as **external context only**. (memory/project_napkin_doctrine.md)
- **Wishlist model** — personal wishlist is primary; Table wishlist is an emergent algorithmic merge of members' personal lists. **No direct add-to-Table action.** (memory/project_wishlist_model.md) *This ticket doesn't build wishlist — but it must leave space for the schema to hook in.*

### Technical sketch (non-binding, architect to finalize)
- New columns on `restaurants`: `google_place_id` (unique, nullable), `google_rating`, `google_rating_count`, `price_level`, `cuisine`, `lat`, `lng`, `places_synced_at`
- New column on `tables`: `is_personal BOOLEAN DEFAULT false`
- New edge function: `places-search` — proxies Google Places API (protects API key server-side), returns a normalized shape the app can render as ghost restaurants
- New edge function or action: `restaurants/upsert-from-place` — called when a Places result gets interacted with (wishlist, log); creates the restaurant record if it doesn't exist
- Supabase trigger or auth hook on user signup: create personal Table
- Backfill migration: create personal Table for every existing user

### Dependencies
- Google Places API key (needs to be set up in Supabase secrets; if not yet done, this ticket creates that requirement)
- Existing `restaurants`, `entries`, `tables` schema

### Things NOT in this ticket
- Wishlist UI or schema beyond reserving space (TICKET-015)
- Restaurant page v2 UI (TICKET-016)
- Search UI (TICKET-017)
- Surfacing the personal Table in the Tables tab UI (TICKET-015 or TICKET-016 will touch this)
- Any public/universal review feed (Path A forbids)
- Refreshing Google rating on a schedule (future; on-demand only for v1)

---

## Product Spec

### User Stories

- As a **new user**, I want a private diary space created automatically on signup, so that I can log a meal solo without first creating a Table.
- As an **existing user** (pre-migration), I want my personal Table backfilled silently, so that I can use solo logging without any setup step.
- As a **solo logger**, I want to log a visit to a restaurant without going through a Round, so that I can track my own eating history.
- As a **user who's been to a restaurant with a Table**, I want to also solo-log the same restaurant, so that my diary reflects my personal history independent of the group Round.
- As a **user browsing restaurants**, I want to find a restaurant that nobody in my Tables has logged yet, so that I can (later) wishlist or log it. (Setup for TICKET-015/017.)
- As a **developer of TICKET-015 (wishlist)**, I need a stable `restaurants` row I can reference by id, and a way to persist a restaurant from a Places result on demand, so that saving a wishlist item doesn't require a prior entry.
- As a **developer of TICKET-016 (restaurant page v2)**, I need Google rating + external metadata on the `restaurants` row, so that I can render external context without a second live API call on every view.
- As a **developer of TICKET-017 (search)**, I need a server-side Places proxy that returns a normalized shape, so that the client never holds the API key and ghost results render uniformly with persisted ones.

### Acceptance Criteria

- [ ] `restaurants` table has new columns: `google_place_id` (text, unique where not null), `google_rating` (numeric), `google_rating_count` (int), `price_level` (int), `cuisine` (text), `lat` (numeric), `lng` (numeric), `places_synced_at` (timestamptz).
- [ ] All new columns are nullable — existing restaurants (created via Round logging without Places data) continue to work.
- [ ] `tables` table has new column `is_personal BOOLEAN NOT NULL DEFAULT false`.
- [ ] On new user signup, a Table is created with `is_personal = true`, owner = user, and the user added as the only member. Creation is atomic with signup (no window where user exists without personal Table).
- [ ] Backfill migration runs once and creates a personal Table for every existing user who does not already have one; migration is idempotent.
- [ ] A new edge function `places-search` exists, accepts a query string (and optional location bias), calls Google Places API using a server-held key, and returns a normalized result shape including `place_id`, name, address, city, country, photo reference, cuisine, price level, Google rating, rating count, lat/lng. The Places API key is read from Supabase secrets and is never returned to the client.
- [ ] A `places-search` call with no auth token is rejected (must be an authenticated Napkin user).
- [ ] An edge function action (new function or new route on existing `restaurant` function) exists to **upsert a restaurant from a Places result**: takes a `place_id` (and the normalized payload), creates the `restaurants` row if none exists with that `place_id`, returns the restaurant id. Safe to call concurrently (unique constraint on `google_place_id`).
- [ ] Solo entry path: authenticated user can create an entry against a restaurant id with no `round_id`/`table_night_id`; the edge function attaches the entry to that user's personal Table automatically (caller does not pass a `table_id`). If the restaurant is a Places ghost, the caller first hits the upsert action, then the entry creation action — no implicit creation.
- [ ] Solo entries appear in the entry-fetching hooks/queries the same way Table-scoped entries do (no special-cased read path required for downstream tickets).
- [ ] Personal Tables do NOT appear in the response of the existing "list my tables" endpoint/hook used by the Tables tab. They are fetchable via an explicit filter or separate endpoint so TICKET-015/016 can surface them.
- [ ] Google rating and related Places fields are persisted at restaurant-creation time and stamped with `places_synced_at`. No background refresh job is required in this ticket.
- [ ] When a restaurant is persisted from a Places result, the Places photo (via `photo_reference`) is downloaded server-side and stored in Supabase Storage; the resulting storage URL is saved as the restaurant's `photo_url`. No runtime dependency on Google's expiring photo URLs.
- [ ] Personal Tables cannot be deleted through the existing Table-delete path (delete is rejected when `is_personal = true`). Membership is frozen to the owner — the Table-invite path rejects invites to a personal Table.
- [ ] curl-level smoke test documented for: `places-search`, restaurant upsert, solo entry creation.

### UX Decisions

- **Ghost restaurants are a UI concept, not a DB state**: a Places result that has no corresponding `restaurants` row is simply a search result the client hasn't persisted yet. Downstream tickets render the ghost/persisted distinction; this ticket only guarantees the server-side mechanics.
- **Personal Table is hidden from the Tables tab**: it is not a social Table and must not appear alongside them. Surface belongs to TICKET-015/016; this ticket just makes it queryable via an explicit filter.
- **Solo entry uses the personal Table implicitly**: the client calling the solo log path does not pass a `table_id`; the server resolves it to the caller's personal Table. This prevents clients from ever targeting another user's personal Table.
- **Default personal Table name**: `"Personal"` at creation. Rename is allowed (reuses the existing Table-rename path) — the `is_personal` flag, not the name, determines behavior.
- **One personal Table per user, ever**: enforced by a partial unique index on `(owner_user_id) WHERE is_personal = true`. Users cannot create additional personal Tables, and other users cannot be added as members (members of a personal Table are locked to the owner).
- **Google rating is external context only**: stored on the row so TICKET-016 can render it, but it is never mixed into any Napkin-computed score (Path A doctrine).

### Out of Scope

- Wishlist schema, UI, or any wishlist-related endpoints (TICKET-015).
- Restaurant page v2 UI — including how Google rating is rendered, ghost state visuals, or "Log a visit" button (TICKET-016).
- Restaurant search UI (TICKET-017).
- Surfacing the personal Table anywhere in the app (diary view, profile, etc.) — schema only here.
- Any public-facing or universal review / aggregate layer (Path A forbids).
- Scheduled refresh of Google Places data. v1 is write-once at persist time; on-demand refresh comes later.
- Photo handling beyond storing the Places `photo_reference` or equivalent identifier — no CDN proxy, no caching pipeline.
- Editing a personal Table's membership (adding a friend, converting to a social Table).

### Open Questions — Resolved (2026-04-16)

All previously-open questions have been answered; listed here for traceability.

- **Personal Table naming + rename**: Default name `"Personal"`. **Rename is allowed** (reuses existing Table-rename path). `is_personal` flag determines behavior, not the name.
- **Membership lock / conversion**: A personal Table is **strictly single-member forever**. It **cannot be deleted** and **cannot be converted to a social Table**. If a user wants a shared Table, they create a new one.
- **Solo entry edge function**: Architect to audit the existing entry-creation edge function during tech design. If it already accepts a nullable `round_id` + resolves the Table server-side, extend it. Otherwise add a new `action: "solo_log"`. Either shape is acceptable — implementation detail, not a product decision.
- **Places fields: required vs nice-to-have**: Required on the normalized `places-search` response: `place_id, name, address, lat, lng, google_rating, google_rating_count, price_level, photo_reference`. Everything else (phone, website, opening hours, cuisine) is nullable.
- **Places API rate limits**: **No per-user rate limit enforced in v1.** Places API quota is a cost concern we'll monitor; if search gets wired to keystrokes in TICKET-017, that ticket owns any debouncing/caching.
- **Photo storage strategy**: **Download once at persist time, store in Supabase Storage, save the storage URL on the `restaurants` row.** Rationale: Google Places photo-reference URLs expire and cost a quota call each resolve; a Napkin app is read-heavy (many restaurant-page views per persist), so paying the one-time download + storage cost is the better value. Supabase Storage at scale is cheap (~$0.021/GB/month); 10k restaurants × ~600KB ≈ 6GB ≈ pennies.
- **Duplicate restaurants pre-Places**: **Defer.** Legacy restaurants (no `google_place_id`) are a finite one-time population. New rows from Places always carry `google_place_id` and the unique constraint prevents future duplicates. A one-off backfill script may later attempt fuzzy matching on (name, city) to set `google_place_id` on legacy rows where a high-confidence match exists; unmatched rows stay as-is. Out of scope for this ticket.

---

## Technical Design

### Approach

Most of this ticket's scaffolding already exists in the codebase — we are finishing, not starting. Personal Tables are already auto-created by the `handle_new_user()` trigger, `tables.is_personal` already ships with a prevent-delete trigger, and the `entry` edge function already upserts restaurants from a Places payload and accepts a `table_id`. What's missing is: (1) the Places metadata columns on `restaurants` (`google_rating`, `price_level`, `cuisine`, `places_synced_at`), (2) real server-side photo download to Supabase Storage (current helper only captures Google's expiring redirect URL), (3) an explicit `upsert-from-place` action so wishlist/search can persist a ghost without creating an entry, (4) auth gate on `places-search`, (5) the remaining personal-Table guardrails (single-member partial unique index, invite rejection, list-tables exclusion, and server-side solo default when the client omits `table_id`). One new migration, two edge-function surface additions, one helper rewrite, and a small hooks addition. No schema churn on `entries`.

### Architecture Decisions

- **Reuse `restaurants.external_id`, do not re-introduce `google_place_id`.** The ticket-draft column name was `google_place_id`, but migration `20251215134700` already collapsed that into a generic `external_id` (UNIQUE). Renaming back would be pure churn and would break the existing `_shared/restaurant.ts` + `entry` function. Trade-off: the column name is less self-documenting than `google_place_id`; mitigated by keeping the existing `COMMENT ON COLUMN` that says "Google Places, etc."

- **Single new migration, additive only.** Add `google_rating`, `google_rating_count`, `price_level`, `cuisine`, `places_synced_at` to `restaurants`; add a partial unique index on `tables(owner_id) WHERE is_personal = true`; create the `restaurant-photos` storage bucket. All nullable / `IF NOT EXISTS`. No data rewrite. Trade-off: we don't backfill Places metadata on legacy restaurants — acceptable, they'll refresh lazily when re-touched.

- **Personal Table creation stays on the DB trigger (`handle_new_user`).** Already works, already atomic with signup, already backfilled for existing users. An edge-function hook would be strictly worse: async, non-transactional, and requires an Auth webhook secret. Trade-off: trigger logic is Postgres-side and less visible to frontend devs; mitigated by a comment pointing at the relevant migration.

- **Photo download happens synchronously inside the upsert path, into a new `restaurant-photos` bucket.** Rewrite `_shared/restaurant.ts` to: resolve the Places photo-media URL (follow redirect), `fetch()` the bytes, upload to `restaurant-photos/{restaurant_id}/hero.jpg` via the service-role storage client, and store the resulting public URL in `restaurants.photo_url`. Do it inline (~300–800ms) rather than queuing a background job — we have no job runner, and upsert-from-place is already a user-initiated interaction that can tolerate one second. On failure, swallow and leave `photo_url` NULL (non-fatal). Trade-off: upsert latency increases; acceptable because upsert happens at most once per restaurant per user's lifetime.

- **Extend the existing `entry` function for solo log; do not create `solo-log`.** The function already routes restaurant resolution and accepts `table_id`. Add server-side fallback: when `table_id` is absent **and** a `restaurant`/`place`/`user_place_id` is present, look up `tables` where `owner_id = user.id AND is_personal = true` and use that id. This keeps one code path for all entries and matches CLAUDE.md's "the personal Table is just a Table of one" framing. Trade-off: caller can still pass `table_id` explicitly and bypass the default — fine and desired (collaborative entries).

- **Add `upsert-from-place` as a new action on the existing `entry` function (not a new function).** The restaurant-upsert code already lives there via `_shared/restaurant.ts`. A new action `{ action: "upsert_restaurant", restaurant: {...} }` exposes upsert without creating an entry — needed by TICKET-015 (wishlist). Alternative (new function) rejected: would duplicate auth/cors/validation boilerplate and still share the helper. Trade-off: slightly overloads the `entry` function; acceptable because it's still "things that resolve to a `restaurants` row."

- **List-my-tables stays a simple additive filter, not a new endpoint.** Add `.eq('tables.is_personal', false)` to the default GET in `table-management`, and add `?include_personal=true` to opt in. Downstream tickets (TICKET-015/016) can pass the flag or query `tables` directly via PostgREST. A separate `/personal-table` endpoint is unnecessary YAGNI — one query, two callers.

- **Enforce "personal Table is strictly single-member forever" via the invite path + partial unique index, not via a row-level RLS rule.** Add an `is_personal = false` guard at the top of the `invite` action in `table-members`, plus a partial unique index on `(owner_id) WHERE is_personal` to make the "one per user ever" invariant a DB fact. Trade-off: a service-role caller can still insert into `table_members` directly; acceptable since all clients go through the edge function.

### File Changes

**Migrations (new)**
- `supabase/migrations/20260419000000_restaurants_places_metadata.sql` — NEW — add `google_rating NUMERIC(2,1)`, `google_rating_count INT`, `price_level SMALLINT`, `cuisine TEXT`, `places_synced_at TIMESTAMPTZ` to `restaurants`. Add partial unique index `tables_one_personal_per_owner_idx ON tables (owner_id) WHERE is_personal`. Create public storage bucket `restaurant-photos` + select/insert policies mirroring `entry-photos`.

**Edge functions**
- `supabase/functions/places-search/index.ts` — MODIFY — add Authorization header check (reject unauthenticated callers via `supabase.auth.getUser(token)`). Extend the Google `X-Goog-FieldMask` to include `places.rating`, `places.userRatingCount`, `places.priceLevel`, `places.primaryType`, `places.addressComponents`. Extend the normalized response shape with `googleRating`, `googleRatingCount`, `priceLevel`, `cuisine`, `city`, `country`.
- `supabase/functions/_shared/restaurant.ts` — MODIFY — rewrite `upsertRestaurant()` to persist the new Places metadata fields, stamp `places_synced_at`, and when `photoReference` is present: resolve the media URL, `fetch()` the bytes, upload to `restaurant-photos/{restaurant_id}/hero.jpg` via the service-role storage client, then set `photo_url` to the returned public URL. Guard the whole photo path in try/catch (non-fatal).
- `supabase/functions/entry/index.ts` — MODIFY — (a) add action `upsert_restaurant` that takes `{ restaurant: { external_id, name, location, types, latitude, longitude, photoReference, rating, userRatingCount, priceLevel, cuisine } }` and returns `{ data: { id } }`; (b) in the default create-entry action, when `table_id` is missing and a location is present, resolve the caller's personal Table id (`tables` where `owner_id = user.id AND is_personal = true`) and assign it. Pass the extra Places fields through `_shared/restaurant.ts` when present.
- `supabase/functions/table-management/index.ts` — MODIFY — default GET excludes personal tables (`.eq('tables.is_personal', false)`); honor `?include_personal=true` query param to include them.
- `supabase/functions/table-members/index.ts` — MODIFY — in the `invite` action, fetch the target table and reject with 400 `"Cannot invite to a personal table"` when `is_personal = true`.

**App (minimal — downstream tickets own UI)**
- `napkin-app/hooks/tables/usePersonalTable.ts` — NEW — `useQuery` that fetches the caller's personal Table via the `?include_personal=true` list and filters client-side; used later by TICKET-015/016. Thin wrapper so the query key is stable.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `personalTable: (userId) => ['personalTable', userId]`.

**No changes needed** to `tables` schema beyond the partial unique index (the `is_personal` column, prevent-delete trigger, trigger-based personal Table creation, and backfill all already shipped in `20260415000000_collaborative_entries.sql`).

### Edge Function Signatures

```
POST /places-search                             (existing — add auth gate)
  auth: required
  body: { query: string, latitude?: number, longitude?: number, radius?: number, limit?: number }
  response: { data: Array<{ id, name, formattedAddress, city, country, latitude, longitude,
                            categories, cuisine, googleRating, googleRatingCount, priceLevel,
                            photoReference, website, link }> }

POST /entry                                     (existing — new action)
  body: { action: "upsert_restaurant", restaurant: {...full Places payload...} }
  response: { data: { id: string } }  // restaurants.id

POST /entry                                     (existing — default action, new fallback)
  body: { ... (no table_id), restaurant | place | user_place_id, rating, content, ... }
  behavior: when table_id omitted AND a location is supplied, server assigns caller's personal table id

GET  /table-management?include_personal=true    (existing — new query flag)
  default: excludes is_personal tables
```

### Implementation Order

1. **Migration** (`20260419000000_restaurants_places_metadata.sql`) — everything else depends on the new columns + storage bucket + unique index existing.
2. **`_shared/restaurant.ts` rewrite** — photo download + new metadata fields; tested in isolation against a known `place_id` via curl before touching callers.
3. **`places-search` updates** — auth gate + expanded field mask/normalized response; this is what feeds the upsert payloads.
4. **`entry` function** — add `upsert_restaurant` action, then the personal-Table fallback in the default create path. Depends on step 2.
5. **`table-management` filter + `table-members` invite guard** — independent, can land alongside 4.
6. **App hook (`usePersonalTable.ts`)** — trivial, unblocks TICKET-015.
7. **curl smoke tests** — documented in the ticket: `places-search` → `entry upsert_restaurant` → `entry` (solo create, no `table_id`).

### Risks

- **Google Places photo-media `redirect: 'manual'` behavior differs across Deno versions.** Current code reads `location` header; the rewritten path must actually fetch the bytes. Mitigation: run a local Deno test that asserts bytes-length > 0 before upload, and keep the "photo failure is non-fatal" semantic so a broken photo path never blocks restaurant creation.
- **Upsert-from-place latency (network + photo download) blocks the client's "wishlist this" interaction.** Mitigation: the upsert itself is cheap (<100ms); the photo fetch is what adds 300–800ms. If this becomes a problem, lift photo download into a `EdgeRuntime.waitUntil()` background task (Supabase supports it) — but do not pre-optimize; current scale doesn't justify it.
- **Concurrent upserts on the same `external_id` from two clients race.** Mitigation: the UNIQUE constraint on `external_id` already makes the upsert idempotent; the second caller reads the winning row. The photo-update path guards with `.is('photo_url', null)` so whichever finishes first wins and the loser is a no-op.
- **Partial unique index `(owner_id) WHERE is_personal` will fail to create if any legacy user somehow has two personal Tables.** Mitigation: the backfill in `20260415000000` only inserts when none exists, so this should be clean; still, the migration should run a pre-check (`SELECT owner_id, COUNT(*) FROM tables WHERE is_personal GROUP BY owner_id HAVING COUNT(*) > 1`) and `RAISE EXCEPTION` if it finds duplicates, so the migration fails loudly rather than silently dropping the constraint.
- **Existing `CREATE POLICY "restaurants insert/update by owners"` allows any authenticated user to update any restaurant row via PostgREST**, which means a malicious client could overwrite another restaurant's Places metadata directly without going through `entry`. Out of scope to fix in this ticket but worth noting — TICKET-016 should tighten this to service-role-only for writes, since the only legitimate writer is now the edge function.

---

## Build Log

### Files Changed

**New files:**
- `supabase/migrations/20260419000000_restaurants_places_metadata.sql` — adds `google_rating`, `google_rating_count`, `price_level`, `cuisine`, `places_synced_at` columns to `restaurants`; partial unique index `tables_one_personal_per_owner_idx`; creates `restaurant-photos` storage bucket with select/insert policies.
- `napkin-app/hooks/tables/usePersonalTable.ts` — `useQuery` hook that fetches the caller's personal Table via `?include_personal=true`, for use by TICKET-015/016.

**Modified files:**
- `supabase/functions/_shared/restaurant.ts` — rewrote `upsertRestaurant()` to persist new Places metadata fields + `places_synced_at`, and to download photo bytes from Google, upload to `restaurant-photos/{id}/hero.jpg` in Supabase Storage, then store the public URL in `photo_url`. Photo failure is non-fatal (wrapped in try/catch).
- `supabase/functions/places-search/index.ts` — added auth gate (rejects unauthenticated callers); extended `X-Goog-FieldMask` to include `rating`, `userRatingCount`, `priceLevel`, `primaryType`, `addressComponents`; normalized response now includes `googleRating`, `googleRatingCount`, `priceLevel`, `cuisine`, `city`, `country`.
- `supabase/functions/entry/index.ts` — (a) added `upsert_restaurant` action that takes a Places payload and returns `{ data: { id } }` without creating an entry; (b) personal-Table fallback in the default create-entry path: when `table_id` is absent and a location is present, resolves caller's personal Table and sets it as `table_id`; (c) passes new Places metadata fields through to `upsertRestaurant`.
- `supabase/functions/table-management/index.ts` — default GET now filters out `is_personal = true` tables; honors `?include_personal=true` to opt in.
- `supabase/functions/table-members/index.ts` — invite action rejects with 400 `"Cannot invite to a personal table"` when target table has `is_personal = true`.
- `napkin-app/lib/queryKeys.ts` — added `personalTable.byUser(userId)` key group.

### Tests

- TypeScript check (`npx tsc --noEmit`) passes clean on the app — no errors.
- Edge functions are Deno; no local test runner is set up. Smoke tests should be run against a deployed or local Supabase instance.

### Curl Smoke Tests (run after deploying functions + migration)

```bash
# Set these before running:
SUPABASE_URL="https://<project>.supabase.co"
TOKEN="<bearer token from supabase.auth.getSession()>"

# 1. places-search — auth gate (should return 401)
curl -X POST "$SUPABASE_URL/functions/v1/places-search" \
  -H "Content-Type: application/json" \
  -d '{"query":"Nobu London"}' | jq .

# 2. places-search — authenticated
curl -X POST "$SUPABASE_URL/functions/v1/places-search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Nobu London","limit":2}' | jq .
# Expected: { data: [ { id, name, googleRating, priceLevel, cuisine, city, country, ... } ] }

# 3. upsert_restaurant — persist a ghost (use place ID from step 2 output)
PLACE_ID="<place.id from step 2>"
curl -X POST "$SUPABASE_URL/functions/v1/entry" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"upsert_restaurant\",
    \"restaurant\": {
      \"external_id\": \"$PLACE_ID\",
      \"name\": \"Nobu London\",
      \"googleRating\": 4.5,
      \"googleRatingCount\": 2000,
      \"priceLevel\": 4
    }
  }" | jq .
# Expected: { data: { id: "<uuid>" } }

# 4. solo entry — no table_id; server should assign personal Table
RESTAURANT_ID="<uuid from step 3>"
curl -X POST "$SUPABASE_URL/functions/v1/entry" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurant_id\": \"$RESTAURANT_ID\",
    \"rating\": 4.5,
    \"content\": \"Incredible black cod\"
  }" | jq .
# Expected: { data: { id, table_id: "<personal table uuid>", ... } }
# Verify: table_id in response matches the user's personal Table id

# 5. list tables — personal Table excluded by default
curl "$SUPABASE_URL/functions/v1/table-management" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].tables.is_personal'
# Expected: all false (or null)

# 6. list tables — personal Table included with flag
curl "$SUPABASE_URL/functions/v1/table-management?include_personal=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].tables.is_personal'
# Expected: at least one true

# 7. invite to personal Table — should be rejected
PERSONAL_TABLE_ID="<personal table id from step 6>"
OTHER_USER_ID="<another user's uuid>"
curl -X POST "$SUPABASE_URL/functions/v1/table-members/invite" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"table_id\":\"$PERSONAL_TABLE_ID\",\"invite_user_id\":\"$OTHER_USER_ID\"}" | jq .
# Expected: { error: "Cannot invite to a personal table" }
```

### Builder Questions

1. **`upsert_restaurant` vs. solo entry with `restaurant_id` directly**: The design specifies callers who already have a `restaurants.id` can pass `restaurant_id` directly to the default create-entry path, bypassing `upsert_restaurant`. This works but is not guarded — the entry function accepts any UUID as `restaurant_id` without verifying the row exists. A foreign key constraint on the table handles that at the DB level. No concern in practice, but worth noting the two paths exist.

2. **Storage bucket policies created in SQL migration**: The `restaurant-photos` bucket select policy does not restrict to authenticated users because it's a public bucket. The insert policy requires `auth.role() = 'authenticated'`. However, since all writes go through the edge function (service role), the insert policy on storage objects is belt-and-suspenders. TICKET-016 should confirm whether the bucket should remain public or be restricted to service-role-only writes (see Risks section above re: RLS).

3. **`places-search` response shape change**: The field `locality` was renamed to `city` and `country` was added. Any existing consumer of the `places-search` response (e.g. `useCreateEntry`) that relied on `locality` will need to be updated. Grepping the app shows only `formattedAddress` and `id` are consumed from the search result in current code — but this is worth a heads-up for TICKET-017 (search UI).

---

## Review History

### Review 1
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 11/15 acceptance criteria met

- [x] New Places metadata columns on `restaurants` — PASS (migration 20260419000000 adds google_rating, google_rating_count, price_level, cuisine, places_synced_at; lat/lng already existed as double precision — `IF NOT EXISTS` is a no-op which is fine).
- [x] New columns are nullable / existing rows work — PASS.
- [ ] `tables.is_personal BOOLEAN NOT NULL DEFAULT false` — FAIL: existing column (from 20260415000000) is `BOOLEAN DEFAULT false` without `NOT NULL`. This migration did not add the `NOT NULL` constraint. Legacy rows could theoretically be NULL. Spec explicitly calls for `NOT NULL`.
- [x] Personal Table auto-created atomically on signup — PASS (pre-existing `handle_new_user()` trigger; reused by design).
- [x] Backfill migration idempotent — PASS (pre-existing, reused).
- [x] `places-search` calls Google with server-held key, returns normalized shape — PASS (shape expanded correctly; `priceLevel` enum→int mapping present; city/country extracted from addressComponents).
- [x] Unauthenticated `places-search` rejected — PASS (`supabase.auth.getUser` gate added).
- [x] Upsert-from-place action exists and is concurrency-safe — PASS (`upsert_restaurant` action + UNIQUE(external_id) constraint).
- [ ] Solo entry path: user passes restaurant id, server attaches to personal Table — **FAIL**: the default create-entry action does NOT accept `restaurant_id` (UUID) from the body at all. It only resolves a restaurant via `restaurant.external_id`. Build log step 4 curl (`{"restaurant_id": "$RESTAURANT_ID", ...}`) will silently create an entry with `restaurant_id = null`, no `table_id`, and no personal-Table fallback (the fallback predicate requires `restaurant?.external_id || place?.external_id || user_place_id`). Either the body contract must accept `restaurant_id` OR the client must always re-pass the full Places payload after upserting — the spec ("caller does not pass a `table_id`") implies the former. See `supabase/functions/entry/index.ts:160-291`.
- [x] Solo entries appear in entry queries identically — PASS (they're just Table-scoped entries now).
- [x] Personal Tables excluded from list-my-tables by default — PASS (`.eq('tables.is_personal', false)` + include_personal flag).
- [x] Places metadata persisted + `places_synced_at` stamped — PASS (only stamped when at least one metadata field present — reasonable).
- [x] Places photo downloaded server-side and stored in Supabase Storage — PASS (see warnings below re: failure modes).
- [ ] Personal Tables cannot be deleted / invites rejected / membership frozen to owner — PARTIAL: delete is blocked (pre-existing trigger), invite is blocked (new `is_personal` guard). However, `DELETE /table-members/:userId` allows **self-removal from any table including personal** (`supabase/functions/table-members/index.ts:222`). A user can orphan their own personal Table (still exists, but they aren't a member) — membership is not actually frozen.
- [x] curl smoke test documented — PASS (but step 4 is broken, see above).

Correctness: FAIL — solo-log path does not accept `restaurant_id` parameter; smoke test step 4 demonstrates the wrong contract.
Edge Cases: WARN — self-remove on personal Table not blocked; two concurrent upserts on same external_id race the photo_url update OK but the `photo_reference` column updates only under the `photo_url IS NULL` guard, so a legitimate photo rotation never propagates (acceptable per "write-once" decision, but worth noting).
Error Handling: PASS — auth gates, validation, non-fatal photo failure, service-role key usage are all correct.
Security: WARN — (1) pre-existing `Authenticated users can insert/update restaurants` RLS is unchanged and lets any authenticated PostgREST client overwrite Places metadata directly; acknowledged in Risks but still open. (2) `upsert_restaurant` has no rate limit and each call can trigger ~800KB photo download + storage write — trivial cost-amplification vector if hit in a loop. Spec explicitly defers rate limiting, so acceptable.
Performance: WARN — photo download is synchronous inside upsert (300–800ms per new ghost), matching design. Acceptable.
Design Compliance: WARN — (1) `usePersonalTable` uses `supabase.functions.invoke('table-management?include_personal=true', ...)` — passing a query string through the slug arg. supabase-js v2 concatenates `${functionsUrl}/${name}` so this generally works but is non-idiomatic and may break under future SDK changes. Prefer constructing the URL via direct `fetch` or encoding the flag in the body. (2) `is_personal NOT NULL` absence (see criterion 3).

Key issues:
1. **Solo-log contract mismatch** (`supabase/functions/entry/index.ts:160-291`): the default action does not destructure or use `restaurant_id` from the body. Either accept `restaurant_id` (UUID) directly and include it in the personal-Table fallback predicate, or update the smoke test + builder Q1 answer to make clear the only supported solo-log path is to re-pass the full Places `restaurant` payload every time. As written, the documented curl in step 4 will silently create a locationless entry with no table. This is the most consequential failure.
2. **Personal Table membership not actually frozen** (`supabase/functions/table-members/index.ts:210-242`): `DELETE` on `table-members` allows self-removal with no `is_personal` guard. Add the same guard used in the invite action.
3. **`is_personal` lacks NOT NULL** (`supabase/migrations/20260419000000_restaurants_places_metadata.sql`): spec explicitly calls for `NOT NULL DEFAULT false`. Add `ALTER TABLE public.tables ALTER COLUMN is_personal SET NOT NULL;` (after a `UPDATE ... SET is_personal = false WHERE is_personal IS NULL` safety pass) to this migration.
4. **`usePersonalTable` query-string through function name** (`napkin-app/hooks/tables/usePersonalTable.ts:18`): fragile. Consider switching to a direct `fetch` against `${supabaseUrl}/functions/v1/table-management?include_personal=true` with the session token, or adding a dedicated body-driven filter to the endpoint. At minimum, smoke-test it against the deployed function before merging.
5. **Storage insert policy vs service-role**: the `restaurant-photos insert policy` requires `auth.role() = 'authenticated'`. Service-role writes bypass RLS so this works, but the policy is misleading — a service_role client is not "authenticated" in that policy's semantics. Consider either removing the policy (service-role is the only legitimate writer) or documenting the bypass.
6. **`restaurants_places_metadata` migration adds `lat NUMERIC` / `lng NUMERIC` via `IF NOT EXISTS`** (`20260419000000_restaurants_places_metadata.sql:14-16`): no-ops since existing columns are `double precision`. Harmless but dead code; remove or drop the comment about it.
7. **Self-audit gap**: no integration test of the end-to-end solo-log flow against a real Supabase instance. The ticket itself requires documented curl tests — step 4 is currently incorrect, meaning this path was almost certainly never exercised.

### Review 2
Date: 2026-04-16
Verdict: APPROVE

Spec compliance: 15/15 acceptance criteria met

- [x] Places metadata columns on `restaurants` — PASS.
- [x] New columns nullable — PASS.
- [x] `tables.is_personal BOOLEAN NOT NULL DEFAULT false` — PASS: migration `20260419000000` lines 19–22 backfill NULLs then SET DEFAULT + SET NOT NULL. Cycle-1 blocker resolved.
- [x] Personal Table auto-created atomically on signup — PASS.
- [x] Backfill migration idempotent — PASS.
- [x] `places-search` with server-held key + normalized shape — PASS.
- [x] Unauth `places-search` rejected — PASS.
- [x] Upsert-from-place action + concurrency safety — PASS.
- [x] Solo entry path accepts `restaurant_id` + personal-Table fallback — PASS: `entry/index.ts:166-167` now destructures `restaurant_id`/`place_id`; `:207-208` initializes resolver vars from them; `:282` fallback predicate includes `restaurantId || placeId` so a pre-resolved UUID triggers the personal-Table resolve. Cycle-1 blocker resolved.
- [x] Solo entries appear in entry queries identically — PASS.
- [x] Personal Tables excluded from list-my-tables by default — PASS.
- [x] Places metadata + `places_synced_at` — PASS.
- [x] Places photo downloaded + stored in Supabase Storage — PASS.
- [x] Personal Tables — delete/invite/membership frozen — PASS: `table-members/index.ts:221-233` rejects DELETE when `is_personal`. Combined with existing delete-trigger and invite guard, membership is now truly frozen to the owner. Cycle-1 blocker resolved.
- [x] curl smoke tests documented — PASS (step 4 now matches the implemented contract, since `restaurant_id` is a supported body param).

Correctness: PASS — all three Cycle-1 blockers addressed; no regressions introduced.
Edge Cases: PASS — DELETE-on-personal guard uses `targetTable?.is_personal` which safely handles a non-existent `table_id` (falls through and the subsequent member delete is a no-op; harmless). Migration duplicate pre-check (lines 26–46) is run BEFORE the unique-index creation so it fails loudly on legacy dupes rather than silently.
Error Handling: PASS.
Security: WARN — pre-existing RLS allowing any authenticated user to update any `restaurants` row remains open (documented in Risks; deferred to TICKET-016). Not a regression.
Performance: PASS — no change from Cycle 1.
Design Compliance: PASS — migration now matches spec wording (`NOT NULL DEFAULT false`); body contract matches documented smoke test step 4.

Key issues: none blocking. Residual non-blockers carried from Cycle 1:
1. `usePersonalTable` passes a query string through `supabase.functions.invoke()`'s slug arg — fragile but currently working; consider switching to a direct `fetch` before SDK upgrade.
2. Pre-existing `restaurants` RLS permits any authenticated write — deferred to TICKET-016 per Risks section.
3. `lat NUMERIC` / `lng NUMERIC` `IF NOT EXISTS` adds (migration lines 14–16) remain dead code since existing columns are `double precision`. Cosmetic.
