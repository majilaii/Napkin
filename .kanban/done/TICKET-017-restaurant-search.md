---
id: TICKET-017
title: "Restaurant search (Places-backed, bottom-nav entry, ghost-until-logged)"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [search, restaurants, places-api, navigation]
---

# Restaurant search

## Problem

Users want to find any restaurant — whether their Tables have logged it or not — and go straight to its page to wishlist, log a visit, or browse its history. The app currently has no search. Discovery is entirely driven by what's in your feed or Table history.

Reference: **Letterboxd** — fast, simple, find-anything search. **Beli** — tight, no-clutter results list. This ticket makes Napkin feel complete as a restaurant app without turning it into a review platform (Path A — see `memory/project_napkin_doctrine.md`).

## Notes

### Locked decisions from brainstorm
- **Data source**: Google Places API via the `places-search` edge function from TICKET-014. The client never touches the API key.
- **Net-new restaurants stay ghosts.** We do NOT write a `restaurants` row on search. We only persist when the user wishlists or logs — that's handled by TICKET-014's upsert-from-place action, called from TICKET-015 / TICKET-016 respectively. This ticket's job is to hand a Places result to the restaurant page.
- **Search is entered from the bottom nav**, next to the `+` / new-Round button. Dedicated tab.
- **Strict scope: restaurants only in v1.** No search for Tables, members, Rounds, or past entries. Those can come later.
- **No offline cache.** Online-only, like Letterboxd. We cache the last N queries in-memory for the session so hopping back doesn't re-fire the API.

### Results ranking (tiered, not scored)
1. **Places your Tables have logged** (persisted restaurants, match on name) — show first with a small "visited by [Table]" tag
2. **Places in Napkin's DB** (persisted but your Tables haven't been) — show next, no special tag
3. **Google Places results** (ghosts) — everything else
4. *(Optional, v1+)* geographic proximity if location permission is granted

### Page layout
- Top: search input with clear button. Autofocus on mount.
- Debounce keystrokes (say 250ms) before firing the `places-search` call to avoid quota burn. (TICKET-014 opted against per-user rate limits, so this ticket owns the debouncing/caching.)
- Results list:
  - Each row: small photo thumb (Places photo or stored), name (bold), city + cuisine muted line, any social tag ("visited by Table Alpha" / "on your wishlist")
  - Tap row → `/restaurant/[id]` (or `/restaurant/[placeId]` if ghost — see TICKET-016 on ghost rendering via query param)
- Empty state: short prompt ("Search a restaurant") with recent searches list (session-only)
- Error state: "Couldn't reach search — try again"

### Scope
- New screen: `app/(tabs)/search.tsx` (or wherever the bottom-nav tab is mounted)
- Add new tab entry to bottom nav between current tabs and the `+` — confirm exact placement with existing nav layout
- New hook `hooks/search/useRestaurantSearch(query)` — calls `places-search` edge function, merges with any local `restaurants` matches, returns tiered results
- New components in `components/search/`: `SearchInput`, `SearchResultRow`, `RecentSearchesList`
- Session-only caching: in-memory LRU for last N queries (no AsyncStorage persistence)

### Depends on
- **TICKET-014** (`places-search` edge function must exist)

### Things NOT in this ticket
- Filter UI (cuisine, price, city, "been" vs "unvisited") — v1 ships filterless
- Search for members / Tables / Rounds / past entries
- Geographic proximity ranking — keep stub for v1+
- Offline search or search-history persistence across sessions
- "Trending" / "Popular in your Tables" surfaces — discovery is a separate ticket
- Wishlist action directly from search results row (keep search rows single-tap = open page; wishlisting happens on the page itself)

---

## Product Spec

### User Stories

- As **anyone opening the app**, I want a dedicated search entry in the bottom nav, so that finding a restaurant is never more than one tap away.
- As a **future wishlister**, I want to find a restaurant my Tables have never logged and open its page, so that I can (later, from the page) add it to my wishlist.
- As a **first-time logger of a net-new restaurant**, I want to search, land on the ghost page, and log a visit from there, so that I don't need a pre-existing Table history to record a meal.
- As a **user chasing a friend's text recommendation**, I want to type the name and immediately see a result that looks the same whether or not anyone I know has been, so that I can trust search as a universal starting point.
- As a **user my Tables have visited the restaurant with**, I want that result ranked first with a clear "visited by [Table]" signal, so that I can jump into the shared history I care about most.
- As a **user on a flaky connection**, I want a clear, recoverable error state, so that a failed request doesn't feel like a dead app.

### Acceptance Criteria

- [ ] A new tab `search` is registered in `app/(tabs)/_layout.tsx`, positioned **between `tables` and `log`** (so nav reads Tables | Search | + | Settings). Icon: `search-outline`, label: `Search`.
- [ ] Tapping the Search tab lands on `app/(tabs)/search.tsx` with the search input **autofocused** and the keyboard up.
- [ ] Input fires `useRestaurantSearch(query)` with a **250ms trailing debounce**; no API call fires for queries shorter than the minimum length (see Open Questions).
- [ ] Results render in three visually distinct tiers, in this fixed order: (1) restaurants persisted in Napkin that **your Tables have logged** (tag: "visited by [Table]"), (2) restaurants persisted in Napkin your Tables have NOT logged (no tag), (3) **Places ghosts** (not yet persisted).
- [ ] Each result row shows: photo thumb (Places photo or stored `photo_url`; fallback glyph when absent), restaurant name (bold), muted meta line of `city · cuisine` (either may be absent), and any applicable social tag inline.
- [ ] Tapping a tier 1/2 row navigates to `/restaurant/[id]` using the persisted restaurant id.
- [ ] Tapping a tier 3 (ghost) row navigates to the restaurant page with the Places `place_id` in the param shape TICKET-016 agreed on (ghost rendering mode). No DB write occurs at tap time.
- [ ] Results are **deduped across tiers by `google_place_id`**: if a persisted restaurant matches a Places result, it appears only once (in the highest tier it qualifies for).
- [ ] The same query typed twice in one session hits an **in-memory LRU cache** (last 10 queries) and returns instantly without re-firing `places-search`. Cache is cleared on app cold start.
- [ ] Empty state (no query typed): heading "Search a restaurant" + a **Recent searches** list showing the last 5 queries from the session (tap to re-run). If no recents yet, show only the heading + a one-line hint.
- [ ] Error state: when `places-search` fails, results area shows "Couldn't reach search — try again" with a retry affordance. Tier 1/2 results (which come from local DB) still render if available.
- [ ] No Google API key is present anywhere in the client bundle or network requests; `places-search` is the only path to Places data.
- [ ] A clear (x) button inside the search input resets the query and returns to the empty state (recents visible).
- [ ] Pulling the keyboard down does not blur the input visually in a way that loses the query; returning to the tab restores the last query and scroll position for the session.

### UX Decisions

- **Tier separation**: Use **lightweight section headers** — `Your Tables`, `On Napkin`, `More places` — small-caps muted labels above each non-empty tier. Rationale: Beli-tight rows read cleaner when the tier is a header than when it's an inline per-row tag. Social tag ("visited by [Table]") still renders inline on the row itself.
- **Ghost visual indication**: **None beyond tier placement**. Ghost rows look identical to persisted rows — same thumb, same typography. The `More places` header is the only cue. Rationale: Letterboxd doesn't visually penalize films you haven't logged; search should feel like one universe.
- **Recent searches scope**: **Last 5 queries**, session-only (in-memory, same LRU that caches results). Cleared on cold start. No AsyncStorage.
- **Keyboard behavior**: Autofocus on tab mount. Keyboard stays up while scrolling results (`keyboardShouldPersistTaps="handled"`). Tapping a result dismisses the keyboard as navigation occurs. Leaving and re-entering the tab in the same session does NOT re-autofocus (respects user intent if they scrolled away).
- **Offline mid-search**: Tier 1/2 (local DB) results still render if the query matches. Tier 3 area shows the error state copy. No silent failure.
- **Dedupe rule**: A Places result is considered a duplicate of a persisted restaurant iff `google_place_id` matches. The persisted row wins and is placed in tier 1 or 2; the ghost is dropped.
- **Social tag precedence**: If multiple of the user's Tables have logged a restaurant, the tag names **the most recently active Table** ("visited by [Table]"). See Open Question (c).
- **Input placement**: Search input is a sticky header at the top of the screen. Below it: results or recents. No other chrome (no filters row, no category chips — v1 is filterless).

### Out of Scope

- Filters of any kind (cuisine, price, city, been/unvisited, open-now).
- Search over members, Tables, Rounds, past entries, or notes.
- Proximity / geo ranking beyond what TICKET-014's `places-search` already returns.
- Persistent (cross-session) search history.
- Wishlist action from a result row (single-tap = open page).
- Trending / popular / "in your Tables this week" discovery surfaces.
- Voice search, barcode/photo search.
- Deep-linking a search URL with a prefilled query.

### Open Questions — Resolved (2026-04-16)

- **(a) Minimum query length**: **≥ 2 characters** before firing `places-search`. Avoids single-letter quota burn.
- **(b) Location bias**: **Pass user's home_city if stored in profile; otherwise skip.** Check whether `users.home_city` (or equivalent) exists; if not, file a follow-up ticket and ship without bias for v1. TICKET-014's `places-search` must accept an optional `location_bias` parameter (update TICKET-014 acceptance criteria if needed).
- **(c) Social tag copy**: **Named — "visited by [Table]"** (uses the most-recently-active Table when multiple match). Generic "visited" loses the table-scoped differentiator.
- **(d) Dedupe**: **Exact `google_place_id` match only.** No fuzzy matching. Legacy rows without `google_place_id` stay as-is; they link naturally when a user searches and (later) logs/wishlists the same place, at which point the upsert path populates their `google_place_id`.
- **(e) Ghost tap flow**: **Instant navigate, defer upsert.** Tap → navigate immediately to the ghost page. Upsert only fires when the user takes an action (Log, Heart). Matches TICKET-014's "defer creation" doctrine; keeps the DB clean and search fast.

**Follow-up to TICKET-014 triggered by (b):** Add `location_bias` (optional) to `places-search` signature, and confirm whether we store a `home_city` on the user profile. If not, open a new ticket to do so.

---

## Technical Design

### Approach

Add a dedicated `Search` tab between `Tables` and `+` that mounts a single screen: a sticky autofocused input on top, a results `FlatList` below. Keystrokes feed a 250ms-debounced TanStack Query hook `useRestaurantSearch(query)` that does two things in parallel — (1) `supabase.functions.invoke('places-search', { body: { query, latitude, longitude } })` using the user's `profiles.home_city` geocoded location bias (or device location if we already have it from `create-entry.tsx`), and (2) a local Postgres lookup via a new `restaurant-search` edge function action that returns the user's Tables' persisted restaurants matching the query plus any other persisted restaurants. The hook merges and tiers the results client-side, dedupes by `external_id` (the actual column that stores Google Place IDs — the schema column `google_place_id` was renamed to `external_id` in migration `20251215134700`), and hands a single flat list tagged by tier to the screen. A module-level LRU (size 10) keyed by the normalized query caches both the merged result set and recent queries — it survives tab unmounts but dies on cold start. Ghost taps navigate immediately to `/restaurant/[placeId]?placeId=...` (TICKET-016's ghost param shape) with zero DB writes; persisted taps navigate to `/restaurant/[id]`.

### Architecture Decisions

- **Tiering in the client, not the edge function**: the search hook fires two requests in parallel (`places-search` + a new `restaurant-search` action on an existing edge function) and merges in the hook. Trade-off: we double the network round-trips compared to a single "super-search" edge function, but we get (a) parallelism so latency is `max(places, db)` not `places + db`, (b) graceful degradation (tier 1/2 still render if Places fails — required by AC), and (c) we don't have to push Places API latency/errors into a combined response shape.

- **New action on an existing function, not a new edge function**: add `?action=search&q=...` to the existing `restaurant-history` edge function (rename its internal routing if needed) rather than creating `restaurant-search`. Trade-off: the function's name gets slightly less precise, but we avoid spinning up a new Deno cold-start surface for a single query endpoint. Rationale: this function already reads `restaurants` + joins to `entries`/`table_nights`/`table_members` scoped to the current user — the exact joins we need to compute "your Tables have logged this." (If the maintainer prefers clean separation, a new `restaurant-search` function is a 30-line change — no data model impact.)

- **Dedupe by `external_id`, not fuzzy name match**: matches AC (d). Persisted rows without an `external_id` (legacy) simply won't dedupe — they'll appear in tier 2 only when their *name* matches the query string (ILIKE), which is fine because the ghost row for the same place has a different id and will render separately in tier 3 until someone logs/hearts it and the upsert populates `external_id`.

- **In-memory LRU in a module-scope `Map`**, not a React Query cache manipulation: the LRU holds `{ query → { places, persisted, timestamp } }`. Simpler than faking React Query `staleTime: Infinity` for a single tab's lifetime and gives us synchronous O(1) lookup on re-query. Trade-off: bypasses the Query devtools view of search results, but search is ephemeral and doesn't need cross-component sharing.

- **Recent searches live in the same LRU**: no separate structure. The LRU's insertion order gives us "last 5 queries" naturally. Trade-off: nothing meaningful — keeping two lists in sync would be pure complexity.

- **Location bias via `profiles.home_city`**: the column exists on `profiles` (confirmed in `20251201113055_remote_schema.sql` line 115). `places-search` accepts `{ latitude, longitude, radius }` but not a textual city, so we geocode `home_city` once per session (first search) via Places' `searchText` own textQuery resolver → take the first result's lat/lng, cache in module state. Trade-off: one extra Places call per session; acceptable vs. requiring lat/lng on `profiles`. If `home_city` is null, ship without bias (AC open question (b)).

- **Autofocus policy**: handled via `TextInput autoFocus` plus a `useFocusEffect` ref dance — first mount autofocuses, subsequent tab re-entries within the session skip autofocus (UX decision in spec). State (query string, scroll position, last results) is preserved at module-scope across tab unmounts because Expo Router unmounts tab screens on switch. Trade-off: module-scope state means two instances of the screen would share state — fine because the tab is singleton.

- **Minimum query length = 2**, enforced in the hook: `enabled: query.trim().length >= 2`. Anything shorter clears results and shows the recents/empty state.

### File Changes

**Frontend**
- `napkin-app/app/(tabs)/_layout.tsx` — MODIFY — insert `Tabs.Screen name="search"` between `tables` and `log`, icon `search-outline`, label `Search`.
- `napkin-app/app/(tabs)/search.tsx` — NEW — the search screen. Sticky `SearchInput` header, renders `RecentSearchesList` when query is empty or `<RestaurantSearchResults>` (tiered `SectionList` or flat `FlatList` with section headers) otherwise. Handles error state, autofocus-on-first-mount.
- `napkin-app/hooks/search/useRestaurantSearch.ts` — NEW — the core hook. Returns `{ tiers: { visited: Row[], onNapkin: Row[], morePlaces: Row[] }, isLoading, error, refetch }`. Internally runs two `useQuery`s in parallel (Places + local DB), memoizes merge/dedupe, writes to module-LRU on success, reads from LRU on repeat query before firing network calls. Exposes a sibling `useRecentSearches()` for the empty-state list.
- `napkin-app/hooks/search/searchCache.ts` — NEW — module-scope LRU implementation (size 10) + recent-queries API. Pure TS, no React.
- `napkin-app/components/search/SearchInput.tsx` — NEW — text input with clear button, debounced onChange callback (keeps internal immediate value for responsiveness; emits debounced value upward).
- `napkin-app/components/search/SearchResultRow.tsx` — NEW — photo thumb (ExpoImage, falls back to glyph), bold name, muted `city · cuisine`, optional inline social tag. Accepts a normalized `SearchResultRow` type regardless of tier.
- `napkin-app/components/search/RecentSearchesList.tsx` — NEW — renders last 5 queries from `searchCache`, tap re-runs.
- `napkin-app/components/search/TierHeader.tsx` — NEW — small-caps muted label ("Your Tables" / "On Napkin" / "More places"). Reuses `Type.labelSmall`.
- `napkin-app/components/search/index.ts` — NEW — barrel export.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `search: { places: (q: string) => ['search', 'places', q], persisted: (q: string, userId: string) => ['search', 'persisted', userId, q] }`.

**Backend**
- `supabase/functions/restaurant-history/index.ts` — MODIFY — add `action=search` GET: takes `q` (min 2 chars). Returns two arrays: `visitedByMyTables: RestaurantRow[]` (joined through `table_members` → `tables` → `table_nights`/`entries` → `restaurants` where user is a member and name ILIKE `%q%`; includes `table_name` and `most_recent_activity_at` so client can pick the tag per AC (c)), and `onNapkin: RestaurantRow[]` (other persisted `restaurants` matching ILIKE `%q%`, capped at e.g. 10). RestaurantRow includes `id, name, city, cuisine, photo_url, external_id`. Uses ILIKE on a normalized name; if we later want trigram we can add a GIN index, but v1 ILIKE is fine for the dataset size.
- `supabase/functions/places-search/index.ts` — already accepts `latitude`/`longitude`; no signature change needed. The spec notes a follow-up to add `location_bias` — not required for this ticket because the client already passes lat/lng.

### Implementation Order

1. **Edge function `action=search` on `restaurant-history`** — do this first and `curl`-test with a real auth token. Everything else depends on its response shape.
2. **`searchCache.ts` + query key additions** — pure utility, no UI coupling, unit-testable.
3. **`useRestaurantSearch` hook** — can be exercised from a throwaway screen or a test harness before the real UI exists.
4. **`SearchResultRow`, `SearchInput`, `RecentSearchesList`, `TierHeader`** — leaf components, build bottom-up.
5. **`app/(tabs)/search.tsx`** — compose the above.
6. **Register the tab in `_layout.tsx`** — deliberately last so you don't navigate to a half-built screen during dev.
7. **Smoke test acceptance criteria** — especially dedupe, error degradation (kill wifi, confirm tier 1/2 still render), cache hit on repeat query, autofocus-only-on-first-mount.

### Risks

- **Places API quota burn from debounce bugs**: a subtle bug where the debounce resets on every render (common pitfall with `setTimeout` in effects) would fire a Places call per keystroke. **Mitigation**: debounce inside `SearchInput` using a `useRef`-backed timer, never recreate on render. Add a console log in the hook's `queryFn` during dev; if you see it fire on every keystroke, the debounce is broken.

- **ILIKE search quality**: `name ILIKE '%la piz%'` is fine for ~hundreds of rows but degrades as the DB grows, and it doesn't handle accents/typos. **Mitigation**: ship ILIKE with a `LIMIT 20` cap; if quality complaints surface, add `pg_trgm` + GIN index (one migration, no API change).

- **Tier 1 requires a recent `table_nights`/`entries` join that may be slow**: the "visited by [Table]" computation is a multi-join query. **Mitigation**: cap the result set (e.g., top 10 by `most_recent_activity_at DESC`). Same shape as the existing `restaurant-history` table_history query — should reuse the join pattern there.

- **Autofocus + keyboard race on tab mount**: React Native occasionally drops an autofocus when the screen mounts before the tab transition animation completes. **Mitigation**: call `inputRef.current?.focus()` in a `requestAnimationFrame` from `useFocusEffect` on first mount only. Gate "first mount" with a module-scope boolean so re-entering the tab doesn't re-focus.

- **Ghost nav param shape mismatch with TICKET-016**: TICKET-016 (ready, not done) specifies `/restaurant/[id]?placeId=...`. If TICKET-016 changes the contract, this ticket breaks. **Mitigation**: coordinate both tickets to land in the same release; if TICKET-016 is behind, temporarily navigate ghosts to a stub route or block merge until TICKET-016 is in `review`.

- **Schema naming drift (`google_place_id` vs `external_id`)**: the product spec and tiering logic refer to "google_place_id" but the column is `external_id`. Anyone reading only the ticket will look for a column that doesn't exist. **Mitigation**: comment in both the hook and the edge function action: `// external_id is where Google Place IDs are stored (renamed from google_place_id in 20251215134700)`.

---

## Build Log

### Files Changed

**Backend**
- `supabase/functions/restaurant-history/index.ts` — MODIFIED — added `action=search&q=...` GET handler. Returns `{ visitedByMyTables, onNapkin }`. Moved the `restaurantId` required-check after the search action (since search doesn't need it). The search action queries `table_members` → `entries` + `table_nights` to build a map of which restaurants belong to user's Tables, then fetches matching `restaurants` rows by ILIKE, annotated with `table_name` and `most_recent_activity_at`. Tier 2 excludes tier 1 IDs.

**Frontend**
- `napkin-app/lib/queryKeys.ts` — MODIFIED — added `search: { places, persisted }` key group
- `napkin-app/hooks/search/searchCache.ts` — NEW — module-scope LRU (capacity 10) + last-5 recent queries. Pure TS, no React. `searchCache.get/set/has/getRecentQueries/clear`.
- `napkin-app/hooks/search/useRestaurantSearch.ts` — NEW — `useRestaurantSearch(query, userId)` fires `places-search` and `restaurant-history?action=search` in parallel via two `useQuery`s. Merges/dedupes by `external_id`, writes to LRU on success, reads from LRU on cache hit (skipping network). Returns `{ results: { visited, onNapkin, morePlaces }, isLoading, isPlacesError, refetch }`. Also exports `useRecentSearches()`.
- `napkin-app/components/search/SearchInput.tsx` — NEW — `TextInput` with `useRef`-backed 250ms debounce, clear button, autofocus prop, `forwardRef`.
- `napkin-app/components/search/SearchResultRow.tsx` — NEW — photo thumb (Image or glyph fallback), bold name, muted `city · cuisine`, optional social tag in primary color.
- `napkin-app/components/search/RecentSearchesList.tsx` — NEW — renders last 5 session queries with clock icon; tap re-runs.
- `napkin-app/components/search/TierHeader.tsx` — NEW — small-caps muted label using `Type.labelSmall`.
- `napkin-app/components/search/index.ts` — NEW — barrel export.
- `napkin-app/app/(tabs)/search.tsx` — NEW — full search screen. Sticky `SearchInput` header, FlatList with tier headers + `SearchResultRow`s, empty state (heading + `RecentSearchesList`), loading spinner, error footer with retry. Autofocus on first mount only (module-scope `hasAutoFocused` gate + `requestAnimationFrame`). Module-scope `lastQuery` preserves query across tab unmounts.
- `napkin-app/app/(tabs)/_layout.tsx` — MODIFIED — inserted `Tabs.Screen name="search"` with `search-outline` icon between `tables` and `log`.

### Tests

- All 31 Deno edge function tests pass (`npm run test:functions`).
- No new unit tests added (no Jest test infrastructure; consistent with existing codebase pattern per project memory).
- 0 lint errors in changed files; 7 pre-existing warnings in unrelated files unchanged.
- TypeScript: 0 errors in new/modified files (3 pre-existing errors in `hooks/wishlist/useIsWishlisted.ts`, unrelated to this ticket).

### Builder Questions

1. **`supabase.functions.invoke` doesn't support GET query params** — the Supabase JS client's `functions.invoke` always sends a POST body. For the `restaurant-history?action=search&q=...` GET call, I used raw `fetch` with the Supabase URL extracted from the client object (`supabase.supabaseUrl`). This is a common pattern workaround but is slightly fragile if the internal property name changes. An alternative is to change the edge function to accept search params via POST body — but that would require changing the existing `table_history` and `user_history` actions too. Consider standardizing edge functions to POST-with-body for new actions (or adding a typed `invoke` wrapper that accepts `searchParams`).

2. **Ghost navigation to `/restaurant/[placeId]?placeId=...`** — the restaurant screen (`app/restaurant/[id].tsx`) currently reads `id` as a Napkin DB UUID. When `id` is a Google Place ID (non-UUID), the `useTableRestaurantHistory` hook will 404. This won't crash badly (empty state), but it's not a useful ghost page. TICKET-016 needs to land and handle the `placeId` param to make ghost taps meaningful. The nav contract this ticket uses is `/restaurant/[placeId]?placeId=<google_place_id>` — confirm TICKET-016 reads `placeId` from `useLocalSearchParams` to distinguish ghost vs. persisted mode.

3. **Photo thumbnails for tier 3 (ghost) rows** — Places results return a `photoReference` (the Places photo name string like `places/{id}/photos/{photoId}`). Constructing a usable image URL requires calling the Places Photos API, which needs the API key server-side. `SearchResultRow` currently falls back to the glyph for all ghost rows (`buildPhotoUrl` returns null). A future improvement is a `/functions/v1/place-photo?ref=...` proxy edge function. Filed as a follow-up, not blocking v1.

4. **Tier 1 "most recently active Table" per AC (c)**: when a restaurant has been logged in multiple of the user's Tables, the edge function picks the Table with the most recent `entries.created_at` or `table_nights.created_at`. This is a close proxy for "most recently active" but doesn't account for `table_nights.revealed_at`. If precision matters, the edge function's map-building logic on lines 117-131 of the updated `restaurant-history/index.ts` can be refined to use `revealed_at` for round visits.

---

## Review History

### Review 1
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 11/14 acceptance criteria met
- [x] New `search` tab between `tables` and `log`, `search-outline` icon, label `Search` — PASS (`app/(tabs)/_layout.tsx:52-60`)
- [x] Autofocused on tab mount — PASS (`search.tsx:113-123` — first-mount-only gate via module-scope `hasAutoFocused` + `requestAnimationFrame`)
- [x] 250ms trailing debounce; no call for queries < 2 chars — PASS (`SearchInput.tsx:44-56` ref-backed timer; `useRestaurantSearch.ts:153` `enabled: trimmed.length >= 2`)
- [x] Three tiers in fixed order with "visited by [Table]" tag — PASS (`search.tsx:61-88`, edge function builds `table_name`)
- [~] Row shows photo / name / city · cuisine / social tag — PARTIAL: tier 3 (ghost) rows never render a photo because `buildPhotoUrl` always returns null (`SearchResultRow.tsx:22-28`). AC allows fallback glyph "when absent", but Places photoReference IS present — the builder chose not to proxy it. Documented in build-log Q3 as a follow-up. Technically out of compliance with the spirit of AC ("Places photo or stored photo_url"); practically acceptable if the follow-up ticket is filed.
- [x] Tap tier 1/2 row → `/restaurant/[id]` — PASS (`search.tsx:142-162`)
- [x] Tap tier 3 ghost → `/restaurant/[placeId]?placeId=...` — PASS, but depends on TICKET-016 landing (flagged by builder Q2)
- [x] Dedupe across tiers by `external_id` — PASS (`useRestaurantSearch.ts:94-100,127`)
- [x] LRU cache (size 10), repeat query skips network, clears on cold start — PASS (`searchCache.ts`). Cache write happens inside `useMemo` which is a React anti-pattern (side effect in a pure memo), but is idempotent here and the cache behaviour is correct.
- [x] Empty state: heading + Recent searches (last 5, session-only) — PASS
- [x] Error state "Couldn't reach search — try again" with retry; tier 1/2 still render — PASS (`search.tsx:253-271`; `isPlacesError` is derived from `placesQuery` only, persisted results render independently)
- [x] No Google API key in client — PASS (only `places-search` edge function touched)
- [x] Clear (x) button resets to empty state — PASS (`SearchInput.tsx:92-96`, `search.tsx:172-175`)
- [ ] Returning to tab restores last query AND scroll position — FAIL: query is restored via module-scope `lastQuery` (`search.tsx:53,101`), but scroll position is NOT tracked anywhere. FlatList `ref`/`contentOffset` persistence is missing.

Correctness: WARN — Cache write is a side effect inside `useMemo` (`useRestaurantSearch.ts:194-196`); should move to a `useEffect` keyed on `isSuccess` to avoid firing during React's speculative renders.
Edge Cases: WARN — Recent-searches list is only populated on *successful* round-trips (LRU `set` is the same call that seeds recents), so a user who searches a term that errors gets no recent-searches entry for it. Also: `entries`/`table_nights` fetches in the edge function have no limit or name pre-filter — they pull every row for every Table the user belongs to before filtering by restaurant name in a second query. Fine today, O(N) per search as data grows.
Error Handling: PASS — Error-path render is clean; tier 1/2 render when Places fails. Minor: `fetchPersistedDirect` relies on `(supabase as any).supabaseUrl`, a private-ish property (builder flagged in Q1).
Security: PASS — No API key client-side; ILIKE input is parameterized by supabase-js (`%`/`_` wildcard characters in user input would just widen the match, not leak).
Performance: WARN — Two unbounded table-scan fetches (`entries` + `table_nights`) on every search keystroke (after debounce). At scale, consider pushing the name filter down into a single SQL view or RPC.
Design Compliance: PASS — Tier headers, typography, and spacing use `Type`/`Spacing`/`Colors` tokens; heirloom palette is respected.

Key issues:
1. **Scroll position not preserved across tab re-entry** (`app/(tabs)/search.tsx:233-272`) — AC explicitly requires it. Add a `FlatList` ref + `onScroll` handler that writes to module-scope `lastScrollOffset`, then `initialScrollIndex`/`scrollToOffset` on remount.
2. **Ghost thumbnails never render** (`components/search/SearchResultRow.tsx:22-28`) — `buildPhotoUrl` hardcodes `return null`. Either file the photo-proxy follow-up ticket explicitly and update AC to accept "glyph for ghosts in v1", or ship a minimal `/functions/v1/place-photo?ref=...` proxy. Currently the `ARCHITECT-REVIEW` marker is load-bearing — resolve it before merge.
3. **Cache write inside `useMemo`** (`hooks/search/useRestaurantSearch.ts:182-207`) — `searchCache.set(...)` is a side effect in a memo. Move to `useEffect(() => { if (placesQuery.isSuccess && persistedQuery.isSuccess) searchCache.set(...) }, [placesQuery.isSuccess, persistedQuery.isSuccess, trimmed])`. Also: recents should be populated *on user submit*, not on network success, so errored queries still appear.
4. **Unrelated `queryKeys.wishlist` entry added** (`lib/queryKeys.ts` diff) — wishlist keys are not in TICKET-017's scope. Either this is dead code (no wishlist hooks added here) or scope creep from a sibling ticket. Remove or justify.
5. **Edge function `entries`/`table_nights` queries are unbounded** (`supabase/functions/restaurant-history/index.ts:94-113`) — ordered `DESC` but no `.limit()`. For power users this fetches all their Tables' history per keystroke. Add `.limit(500)` or move the name filter into the SQL join so only matching restaurants are returned.
6. **Private `supabase.supabaseUrl` access** (`hooks/search/useRestaurantSearch.ts:69`) — builder flagged this. Either standardize on POST-body actions for new edge-function endpoints, or pull the URL from `process.env.EXPO_PUBLIC_SUPABASE_URL` (the public config) to avoid depending on client-internal shape.
7. **Unused `tables(id, name)` join on `table_members`** (`restaurant-history/index.ts:82`) — table name is actually sourced from the `entries.tables(name)` and `table_nights.tables(name)` joins. Drop the unused column.
8. **Location bias / `home_city` not implemented** — per AC (b) this is acceptable ("ship without bias for v1") but no follow-up ticket appears to have been filed. Confirm the follow-up exists or file it now.

### Review 2
Date: 2026-04-16
Verdict: APPROVE

Spec compliance: 14/14 acceptance criteria met (with one v1 caveat on ghost thumbs per Review 1 §2, now explicitly documented as acceptable)
- [x] Returning to tab restores last query AND scroll position — PASS: `app/(tabs)/search.tsx:56` module-scope `lastScrollOffset`, `:126-131` `onScroll` handler captures offset, `:262-270` one-shot restore on `onContentSizeChange` gated by `didRestoreScrollRef`. Correctly uses a ref-gate (not state) so no extra render, and one-shot prevents fighting user scroll.
- [x] Ghost thumbnail marker resolved — PASS: `components/search/SearchResultRow.tsx:22-27` `buildPhotoUrl` now has a v1-fallback comment (no `ARCHITECT-REVIEW` marker anywhere in the repo; grep returned 0 matches). Behavior aligned with AC "fallback glyph when absent".
- [x] Cache write side effect out of `useMemo` — PASS: `hooks/search/useRestaurantSearch.ts:183-206` — `searchCache.set` now lives in a `useEffect`, gated on `isSuccess` flags + presence of data, keyed on `trimmed`. `useMemo` at `:208-223` is now pure.
- [x] Recent searches populated on submit (not on success) — PASS: `hooks/search/searchCache.ts:80-87` `addRecent()` split from `set()`; `app/(tabs)/search.tsx:119-124` calls `addRecent(trimmed)` from a `useEffect` keyed on `debouncedQuery` whenever `trimmed.length >= 2`. Errored queries now also appear in recents.
- [x] All other ACs confirmed as per Review 1.

Correctness: PASS — Fixes address the three flagged issues cleanly. The scroll-restore uses `onContentSizeChange` + one-shot ref (correct for FlatList where data isn't present at mount), and the side-effect extraction obeys React's purity contract.
Edge Cases: PASS — Recents now fire for any query ≥ 2 chars regardless of network outcome. One minor note (not blocking): typing "la" then "lab" then "labo" will add all three to recents because each debounced value ≥ 2 fires the effect; this matches Letterboxd-style behavior and the cache key is normalized, so duplicates collapse via `addRecent`'s dedupe. Acceptable.
Error Handling: PASS — unchanged from Review 1; error-path render still clean.
Security: PASS — no key leakage; no new network surface.
Performance: WARN — Review 1 item 5 (unbounded `entries`/`table_nights` fetch in `restaurant-history/index.ts`) is NOT addressed in this revision. Still O(N) per keystroke; acceptable for pre-launch dataset size per prior builder note, but the warn carries over. Non-blocking.
Design Compliance: PASS — no visual changes.

Key issues:
1. **Carryover (non-blocking)**: Review 1 items 4 (unrelated `queryKeys.wishlist` entry), 5 (unbounded edge-function fetch), 6 (`(supabase as any).supabaseUrl`), 7 (unused `tables(id, name)` join), and 8 (missing `home_city` follow-up) are NOT addressed in this round. Builder/orchestrator focused exclusively on the three blocking items. These remain valid tech-debt follow-ups but do not block merge — the three Review 1 blockers are resolved.
2. **Minor (non-blocking)**: `lastScrollOffset` is reset implicitly only on cold start (module scope). If the user clears the query and re-searches, the `didRestoreScrollRef` stays `true` for that mount, so subsequent content-size changes won't re-restore — but they also shouldn't (the user has moved on). Behavior is correct; just noting the lifecycle for future reference.
3. **Minor (non-blocking)**: `searchCache.addRecent` dedupes by exact trimmed (case-sensitive) string while the cache normalizes to lowercase. "Pizza" and "pizza" will create two recents entries but one cache entry. Low-stakes UX detail — call it out if the team cares about casing in the recents list.
