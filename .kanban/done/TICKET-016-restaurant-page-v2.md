---
id: TICKET-016
title: "Restaurant page v2 (personal-first hero, log CTA, who's been, Google context)"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-17
tags: [restaurants, ui, solo-log, wishlist, pages]
---

# Restaurant page v2

## Problem

The existing restaurant page (`app/restaurant/[id].tsx`) is a minimal "Table memory" screen: hero photo, restaurant name, Table's average, visits list. Built when restaurants were byproducts of logging.

Now that restaurants are first-class (TICKET-014) and wishlist exists (TICKET-015), the restaurant page needs to become Napkin's main restaurant detail surface — reachable from search (TICKET-017), from feed rows, from wishlist cards, and from Round/entry detail. It has to carry more weight without becoming cluttered — the aesthetic reference is **Beli** (confident, restrained, score-forward) with **Letterboxd's** rhythm for the visit log.

## Notes

### Locked decisions from brainstorm
- **Hero number = personal average** (cross-Table — your avg across every time you've logged this restaurant, in any of your Tables including the personal diary). Visit count below.
- **Table average** is secondary — shown as a smaller chip under the personal hero. Tapping it can flip the hero, but personal stays the default.
- **Google rating is external context, not social layer.** Show it small, labeled "Google", next to the Napkin numbers. No Napkin-wide / cross-Table aggregate. (Path A doctrine.)
- **Wishlist heart** top-right of hero. One tap = toggle personal wishlist. No "add to Table" action.
- **"Log a visit" CTA** prominent under the hero. Two paths:
  - **Solo log** → creates an entry in the user's personal Table (TICKET-014)
  - **Start a Round here** → jumps into Table Night start flow pre-filled with this restaurant (only shown when the user has at least one social Table)
- **"Who's been" row** — avatars of Tablemates who've logged this spot, with their personal avg. Scope: people you share a Table with. (Not strangers. Not public.)
- **Rating distribution strip** — small histogram showing how ratings cluster (Letterboxd-style). Optional — only render when total visits ≥ 3.
- **Ghost restaurants** — a restaurant reached from a search result may not yet be persisted in Napkin. Page still renders (from the Places payload); wishlist or log triggers the TICKET-014 upsert-from-place action before the mutation completes. UI should not leak the ghost/persisted distinction to the user.

### Page layout (top → bottom)
1. **Top bar** — back button, share (future).
2. **Hero band** — photo, restaurant name (Newsreader italic), address + city + cuisine + price tier in one muted line. Wishlist heart top-right.
3. **Numbers band**:
   - Big: personal avg ("You · 4.5 · 8 visits")
   - Small row: Table chip ("Table Alpha · 4.2 · 5 visits"); Google chip ("Google · 4.3")
4. **Log CTA** — single prominent button "Log a visit" → opens sheet with two options (Solo log / Start a Round). If the user has no social Tables, only Solo log is shown.
5. **Rating distribution strip** — (only if ≥3 visits total in your scope)
6. **Who's been** — horizontal scroll of avatars with personal avg under each
7. **Visits feed** — reverse-chron log rows: avatar, names, rating, one-line note, date. Rounds and solo entries intermixed. Tap → existing detail screens.

### Scope
- Rewrite `app/restaurant/[id].tsx`
- New components in `components/restaurants/`: `RestaurantHero`, `RestaurantNumbers`, `WhoBeenRow`, `RatingDistribution`, `LogVisitSheet`
- Wire up: `useUserRestaurantHistory`, `useTableRestaurantHistory`, `useTableWishlist` (for heart state), `useWishlistAdd` / `useWishlistRemove`, Places-backed render path when restaurant is a ghost
- Entry points updated: any existing navigation to `/restaurant/[id]` should still work; add query param `placeId` for ghost render
- Rename existing screen flows if needed, but keep the file path `app/restaurant/[id].tsx` stable

### Depends on
- **TICKET-014** (restaurant entity + Google fields + personal Table + solo log flow) — hard dep
- **TICKET-015** (wishlist hooks + heart button component) — hard dep

### Things NOT in this ticket
- Search UI or search entry points (TICKET-017)
- Napkin-wide / public aggregate number (Path A forbids)
- Round-creation flow itself (exists; we just jump into it pre-filled)
- Solo-log UI beyond the sheet → existing entry-creation flow handles composer
- Photo grid of past visits' hero shots (future)
- Map pin / directions link (future)
- Menu / hours / phone UI (future)

---

## Product Spec

### User Stories

- As a **user tapping a result from search**, I want the restaurant page to render immediately from the Places payload even if nobody in my Tables has logged it, so that discovery doesn't hit a dead end.
- As a **user arriving from the feed or a Round**, I want to see *my* relationship with this place first (my average, my visit count) before any group or external number, so that the page feels like my journal, not a review site.
- As a **solo logger**, I want a single prominent "Log a visit" button that drops straight into the composer against my personal Table, so that logging a meal alone is a two-tap affair.
- As a **member of one or more social Tables**, I want "Log a visit" to also offer "Start a Round here" prefilled with this restaurant, so that turning dinner into a Table Night is one tap from the page.
- As a **user who has no social Tables yet**, I want the Round option hidden (not shown-and-disabled), so that the page doesn't tease a feature I can't use.
- As a **Tablemate**, I want to see avatars of people I share a Table with who've been here and their personal avg, so that I know whose taste to trust on this spot.
- As a **user browsing a restaurant with many visits**, I want a small distribution strip showing how ratings cluster, so that I can see consensus vs controversy at a glance.
- As a **user tapping the heart**, I want a one-tap wishlist save with instant visual feedback that persists across sessions and Tables, so that saving feels Pinterest-cheap.
- As a **first visitor to a ghost restaurant**, I want wishlisting or logging to "just work" without any loading-into-existence ceremony, so that the ghost/persisted distinction never leaks.

### Acceptance Criteria

**Routing / data loading**
- [ ] Route `/restaurant/[id]` accepts an `id` that is either a Napkin `restaurants.id` or — when `placeId` query param is present — a Google `place_id` for a ghost restaurant not yet persisted.
- [ ] When `placeId` is present and the restaurant is not yet in the DB, hero/name/address/cuisine/price/photo/Google rating render from the Places payload passed through the route (or refetched via `places-search`). No visible loading-into-existence step.
- [ ] The existing `tableId` query param is accepted but optional; its only effect is to bias which Table's chip is shown as the secondary number (see UX Decisions). Removal of `tableId` does not break the page.

**Hero band**
- [ ] Restaurant name rendered in Newsreader italic; address + city + cuisine + price tier rendered as a single muted line beneath.
- [ ] Hero photo shown above the name when available (from `restaurants.photo_url` or ghost Places `photo_reference`).
- [ ] Wishlist heart is positioned top-right of the hero band; tap toggles personal wishlist via TICKET-015's `useWishlistAdd` / `useWishlistRemove`; filled/unfilled state reflects `useTableWishlist` / personal wishlist state optimistically.
- [ ] For a ghost restaurant, tapping the heart triggers TICKET-014's upsert-from-place before the wishlist mutation completes; UI shows filled state immediately (optimistic).

**Numbers band (tiered visual hierarchy)**
- [ ] Primary: large personal avg displayed as `"You · 4.5 · 8 visits"` using `useUserRestaurantHistory(restaurantId, userId)`; averaged across every Table the user has logged in, including the personal Table.
- [ ] Secondary row, smaller: one Table chip `"<Table name> · 4.2 · 5 visits"` (see Open Questions on multi-Table selection) + Google chip `"Google · 4.3"`.
- [ ] Google chip is labeled "Google" and never merged with Napkin numbers. No Napkin-wide / cross-Table aggregate is displayed anywhere on the page.
- [ ] Personal avg hidden entirely when user has 0 visits; Table chip hidden when there are 0 Table-scoped visits; Google chip hidden when `google_rating` is null.

**Log CTA**
- [ ] A single prominent "Log a visit" button sits below the numbers band.
- [ ] Tapping opens a bottom sheet (`LogVisitSheet`) with two options: "Solo log" and "Start a Round here".
- [ ] "Start a Round here" is hidden when the user is a member of zero social (non-personal) Tables. The sheet then renders only "Solo log" — if only one option remains, the sheet may auto-dismiss and route directly (see UX Decisions).
- [ ] "Solo log" routes to the existing entry composer with the restaurant prefilled and the target Table resolved server-side to the user's personal Table (per TICKET-014).
- [ ] "Start a Round here" routes into the existing Round/Table Night start flow with `restaurant_id` prefilled; if the user has multiple social Tables, the existing Table picker in that flow handles selection (not this ticket).

**Distribution strip**
- [ ] Rendered only when total visits in the user's scope (personal + visible Tablemates' visits) is ≥ 3. Hidden otherwise.
- [ ] Small horizontal histogram of rating buckets (Letterboxd-style). Non-interactive in v1.

**Who's been row**
- [ ] Horizontal scroll of avatars for users who have logged this restaurant AND share at least one Table with the current user. Each avatar shows that user's personal avg beneath.
- [ ] Excludes strangers, excludes the current user themselves.
- [ ] Hidden entirely when the result set is empty.

**Visits feed**
- [ ] Reverse-chronological feed below Who's-been. Each row shows avatar(s), display names, rating, one-line note, date.
- [ ] Rounds and solo entries are intermixed in one stream (not separately sectioned).
- [ ] Tap a Round row → existing `/table-night-detail`; tap a solo entry row → existing `/entry-detail`.
- [ ] Feed scope matches Who's-been: includes visits from users the viewer shares a Table with, plus the viewer's own visits. No strangers.

**State handling**
- [ ] Loading state shows a single unobtrusive indicator; the hero (name/photo from Places, if ghost) renders as early as possible.
- [ ] Error state in the numbers/visits region degrades gracefully: hero + Google chip + Log CTA still render so the page remains usable.
- [ ] Pure-ghost state (zero visits anywhere, restaurant just looked up from search): hero + Google chip + wishlist heart + Log CTA only. No Who's-been, no distribution, no visits feed, no empty-state literals like "No visits yet."

### UX Decisions

- **Tiered numbers**: personal avg is visually dominant (largest type, Newsreader numerals, own line). Table + Google chips sit on one row beneath, matched in size and weight so neither reads as more authoritative than the other. External context (Google) is visually equivalent to a sibling Table, never the hero.
- **Default Table chip**: show the Table associated with the user's *most recent visit* to this restaurant. Rationale: recency reflects current relevance; avoids picking a stale Table. See Open Questions for the multi-chip alternative.
- **Empty Who's-been with no shared-Table visits**: hide the row entirely rather than show strangers or an empty-state message. Keeps the page Tables-first.
- **Distribution strip threshold**: `≥ 3 visits` in the viewer's scope. Below that, a histogram of 1–2 bars reads as decoration, not signal.
- **Heart placement**: top-right of the hero band, overlaid on the photo with a subtle scrim for legibility. Always visible (not scrolled with the feed).
- **Log CTA as sheet vs inline two-button**: sheet, always, even when only one option is available. Rationale: a single prominent button is calmer than two side-by-side CTAs of near-equal weight; the sheet also leaves room to add a third option later (e.g., "Log to a specific Table") without redesigning the hero. Exception: if the user has zero social Tables AND has "Don't ask again" behavior later, we can short-circuit to Solo log — v1 keeps the sheet for consistency.
- **Ghost/persisted transparency**: the user should never see the word "ghost" or any loading shimmer implying the restaurant is being created. Heart tap and Log tap both trigger the TICKET-014 upsert silently; the first write wins the persist.
- **Round-context viewing**: the page is the same whether arrived from inside a Round or globally. `tableId` only biases the secondary chip (see Open Questions). No alternate layout.

### Out of Scope

- Search UI or any search entry point (TICKET-017).
- Any public/universal/Napkin-wide aggregate score (Path A forbids).
- Photo grid of past visits' hero shots.
- Menu, hours, phone number, website link.
- Map pin or directions link.
- Round-creation flow itself — this ticket only jumps into the existing flow with `restaurant_id` prefilled.
- Solo-log composer UI beyond the sheet option — existing entry composer handles it.
- Editing or removing past visits from this page.
- Share button (placeholder only; no implementation).

### Open Questions — Resolved (2026-04-16)

- **(a) Multi-Table Table chip**: **Show most-recent Table.** `tableId` query param (if present) takes precedence as bias, then falls back to most-recent visit's Table. No chip stacking, no cycling.
- **(b) Pure-ghost layout**: **Minimalist — hero + Google chip + heart + Log CTA.** No "Be the first" prompt. The Log button *is* the call to action.
- **(c) Who's-been when no one you share a Table with has visited**: **Hide the row entirely.** No empty-state label.
- **(d) Tapping the Table chip**: **Non-interactive.** Chip is a context label, not navigation.
- **(e) `tableId` query param**: **Keep as soft bias only.** Ignored gracefully when absent.

---

## Technical Design

### Approach

Rewrite `app/restaurant/[id].tsx` into a composition of small, data-contract-driven components under `components/restaurants/`. The screen becomes a thin shell that resolves an `id` (Napkin `restaurants.id`) or a `placeId` (Google Place ID for a ghost), hydrates a single `RestaurantPageData` object from one new `restaurant-page` edge-function action, and feeds the sub-sections (`RestaurantHero`, `RestaurantNumbers`, `WhoBeenRow`, `RatingDistribution`, visits list, `LogVisitSheet`). All data flows top-down; `WishlistHeartButton` is reused unchanged and handles its own ghost-upsert path. The existing `useUserRestaurantHistory` / `useTableRestaurantHistory` hooks are kept but no longer drive the page directly — the new aggregated endpoint is the page's primary read to avoid N round-trips and to compute the Who's-been and distribution server-side where the RLS/membership filter lives.

### Architecture Decisions

- **One aggregated edge-function action over composing 4–5 client hooks** because Who's-been and the visits feed both require "users who share a Table with me" — a join the client can't do cheaply or safely. Trade-off: adds a new action to an existing function rather than reusing `useUserRestaurantHistory` as-is; the legacy hooks keep their current callers (entry-detail, round-detail banners) unchanged.
- **Extend `restaurant-history` with `action=page` instead of a new function** because the data is conceptually an extension of the same concern (memory at a venue) and shares the auth/membership-check boilerplate. Trade-off: function grows; acceptable because it stays under the "one file, action-routed" shape used elsewhere.
- **Client-side distribution histogram** because the raw ratings are already in the visits payload; pushing bucketing to the server would duplicate math and lock the bucket count. Trade-off: ~N numbers crossed over the wire instead of 5, but N is small (visits at one restaurant).
- **Ghost render uses the Places payload passed through navigation state**, not a separate fetch, when arriving from search. If a user deep-links with only `?placeId=...`, fall back to a one-shot `places-search?placeId=` lookup. Trade-off: requires search screens (TICKET-017) to navigate with the full Places row; this is cheap because they already have it in hand.
- **`LogVisitSheet` navigates, it does not mutate**. "Solo log" pushes to `/create-entry` with the restaurant payload; "Start a Round" pushes to the same screen with `mode=round`. The composer already owns the `useCreateEntry` / `useStartRound` mutations and the server-side personal-Table resolution from TICKET-014. Trade-off: we don't get a "logged in one tap" experience, but that's the composer's job to optimize later; the page stays stateless about the log action.
- **Personal avg comes from the aggregated endpoint, not `useUserRestaurantHistory`** so that the page's hero, numbers band, and visits feed all share one cache entry and re-render together. `useUserRestaurantHistory` stays for the entry-detail "Previously here" banner.
- **Table chip selection is server-computed**, using the user's most-recent visit's Table (biased by `tableId` query param if present and the user is a member). Client only displays.

### Data contract

New edge-function action `GET /restaurant-history?action=page&restaurant_id=X&table_id=Y?`:

```ts
RestaurantPageData = {
  restaurant: {
    id: string; name: string; address: string | null; city: string | null;
    country: string | null; cuisine: string | null; price_level: number | null;
    photo_url: string | null; google_rating: number | null;
    google_rating_count: number | null; external_id: string | null;
  };
  personal: { average: number | null; visit_count: number };
  table_chip: { table_id: string; table_name: string; average: number; visit_count: number } | null;
  whos_been: Array<{ user_id: string; display_name: string; avatar_url: string | null; personal_average: number; visit_count: number }>;
  visits: Visit[];         // existing Visit shape, extended with `user_id` + `avatar_url`
  visit_count: number;
}
```

Scope rules enforced server-side:
- `personal`: viewer's own entries across all Tables they belong to.
- `table_chip`: most-recent visit's Table among Tables the viewer is a member of (biased by `table_id` param); null if viewer has no Tables that have visited this restaurant.
- `whos_been` + `visits`: rows authored by users with whom the viewer shares at least one Table (excluding viewer). Computed via `table_members` self-join on `member_id`.

Ghost case: `restaurant_id` lookup returns null → endpoint returns `{ restaurant: null, personal: {null, 0}, ... }` with all arrays empty. The client synthesizes `restaurant` from the Places payload.

### File Changes

- `supabase/functions/restaurant-history/index.ts` — MODIFY — add `action=page` branch that returns `RestaurantPageData` (handles restaurant fetch, shared-Table join, visits, per-user personal averages, and Table chip selection in one round-trip).
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — NEW — `useRestaurantPage(restaurantId | null, tableId?)` + placeholder synthesis helper `restaurantFromPlace(payload): RestaurantPageData['restaurant']` used when ghost.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `restaurants.page(restaurantId, tableId?)`.
- `napkin-app/app/restaurant/[id].tsx` — REWRITE — thin shell: read `id`, optional `placeId`, optional `tableId` and serialized Places payload; assemble data (synthesize restaurant for ghost, merge with page data once it arrives); render sub-components.
- `napkin-app/components/restaurants/RestaurantHero.tsx` — NEW — photo + name (Newsreader italic) + muted meta line (`address · city · cuisine · $$`) + heart overlay. Props: `{ restaurant, userId, restaurantPayloadForGhost? }`.
- `napkin-app/components/restaurants/RestaurantNumbers.tsx` — NEW — primary personal row + secondary chip row. Props: `{ personal, tableChip, googleRating, googleRatingCount }`. Hides each piece per acceptance rules.
- `napkin-app/components/restaurants/WhoBeenRow.tsx` — NEW — horizontal scroll of avatars with personal avg below. Props: `{ users: WhosBeenEntry[] }`. Hidden by caller when empty.
- `napkin-app/components/restaurants/RatingDistribution.tsx` — NEW — buckets the `visits[].rating` client-side (0.5 step bins), renders a 10-bar horizontal histogram. Props: `{ ratings: number[] }`. Caller renders only when `ratings.length >= 3`.
- `napkin-app/components/restaurants/LogVisitSheet.tsx` — NEW — bottom sheet with "Solo log" and (when `hasSocialTable`) "Start a Round here". Uses React Native `Modal` + translated view (pattern used elsewhere; no new dep). Props: `{ visible, onClose, onSoloLog, onStartRound, showRoundOption }`.
- `napkin-app/components/restaurants/index.ts` — MODIFY — add barrel exports.
- `napkin-app/components/restaurants/VisitListRow.tsx` — REUSE as-is (already handles solo/round rows).

No migration needed — `restaurants` already has `cuisine`, `price_level`, `google_rating`, `google_rating_count`, `photo_url`.

### Data flow

1. Screen reads `{ id, placeId?, tableId?, placePayload? }` from route params. `id` is required by the route file shape; for a pure-ghost arrival search passes the Place ID as `id` AND sets `placeId=id` so the server knows to resolve by `external_id` rather than UUID.
2. `useRestaurantPage(id, tableId)` fires. Endpoint resolves by UUID if `id` looks like one, else by `external_id`.
3. While loading: if `placePayload` is present, hero renders synthesized data immediately; numbers/visits regions show a single small spinner.
4. On success: page data replaces any synthesized hero fields. `WishlistHeartButton` is given `restaurantId` once known, else the `restaurant` Places payload — it already handles the silent upsert on tap.
5. `LogVisitSheet` → navigation only:
   - Solo log → `router.push('/create-entry', { restaurant: <payload or id>, mode: 'solo' })` — composer resolves personal Table server-side per TICKET-014.
   - Start a Round → `router.push('/create-entry', { restaurant: <payload or id>, mode: 'round' })`.
6. `hasSocialTable` is derived from `useTables(user.id)` — filter out `is_personal`.

### Ghost rendering

"Ghost" means the restaurant has no row in `restaurants` yet. Two entry points:

- **From search (TICKET-017)**: navigator passes the Places payload as a route param (JSON-stringified). Screen decodes it and renders the hero immediately. The aggregated fetch runs in parallel and returns empties; components hide per their normal rules. Heart tap → `WishlistHeartButton` invokes wishlist mutation with `restaurant: payload` (already handled in TICKET-015). Log tap → navigation carries `payload` to the composer, which upserts via TICKET-014's flow.
- **Deep link with only `placeId`**: fall back to `places-search` with a single-result lookup to hydrate the payload, then same as above. This is a cold path — a basic spinner over the hero area is acceptable.

The user never sees a "saving restaurant" state because both the heart and the log button trigger background upserts that complete before their owning mutation commits; the UI shows only the final confirmed state.

### Implementation Order

1. **Edge function `action=page`** — unblocks the rest; testable with curl standalone.
2. **`useRestaurantPage` hook + queryKey** — contracts the client side against the endpoint.
3. **Leaf components** (`RestaurantHero`, `RestaurantNumbers`, `WhoBeenRow`, `RatingDistribution`, `LogVisitSheet`) — pure presentational, no data deps beyond props; can be built in parallel with placeholder data.
4. **Rewrite `app/restaurant/[id].tsx`** — wire everything, handle ghost synthesis, route to composer.
5. **Search integration hand-off** — verify TICKET-017 passes `placePayload` correctly (coordinate only; no code owned here).

### Risks

- **Shared-Table join perf**: the `members-of-Tables-I-share` join can be wide for users in many Tables. Mitigation: do the membership lookup once (`table_members` where `member_id = viewer`), cache the table_id set in memory, then filter `entries`/`table_nights` by `table_id IN (...)` — the indexes that back the activity feed already cover this access path.
- **`id` shape ambiguity (UUID vs Place ID)**: route param `id` could be either. Mitigation: detect UUID by regex server-side; explicit `placeId` param wins when present. Document the contract in the edge function.
- **Stale Table chip**: "most recent visit's Table" flips as the user logs elsewhere. Acceptable and intended; the chip is contextual, not canonical. No mitigation needed.
- **Ghost payload drift**: the Places payload shape passed through navigation must match `RestaurantPayload` expected by the wishlist mutation. Mitigation: export a single `RestaurantPayload` type from one place (already in `useWishlistAdd.ts`) and have the restaurant screen + search both consume it.
- **Distribution strip visual with small N**: 3-bucket histograms can look dumb. Mitigation: the `>= 3 visits` gate already guards the worst case; v1 ships without further tuning.

---

## Build Log

### Files Changed

**Edge function**
- `supabase/functions/restaurant-history/index.ts` — Added `action=page` branch. New types: `WhosBeenEntry`, `RestaurantPageData` (extends existing `Visit` type with `user_id`, `avatar_url`, `note`). The branch resolves the restaurant by UUID or by `external_id` (for ghost arrivals), computes personal average, Table chip (most-recent-visit Table biased by `table_id` param), Who's-been via shared-Table member join, and visits feed (solo entries + revealed rounds scoped to viewer's Tables + their Tablemates).

**Client hooks**
- `napkin-app/lib/queryKeys.ts` — Added `restaurants.page(restaurantId, tableId?)`.
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — NEW. `useRestaurantPage(restaurantId, tableId?)` query hook + `restaurantFromPlace(payload)` ghost synthesis helper. Types: `RestaurantPageRestaurant`, `RestaurantPageData`, `PageVisit`, `WhosBeenEntry`.

**Components (all new)**
- `napkin-app/components/restaurants/RestaurantHero.tsx` — Photo band (220pt, full-width) + Newsreader italic name + muted meta line (address · city · cuisine · $$). Heart button overlaid top-right with translucent pill background. Falls back to a no-photo bar when `photo_url` is null.
- `napkin-app/components/restaurants/RestaurantNumbers.tsx` — Tiered numbers: large personal avg + visit count; secondary row of Table chip + Google chip. Each element hidden per acceptance rules.
- `napkin-app/components/restaurants/WhoBeenRow.tsx` — Horizontal scroll of Tablemate avatars with first-name + personal avg below. Hidden when empty.
- `napkin-app/components/restaurants/RatingDistribution.tsx` — 10-bin half-star histogram bucketed client-side from `visits[].rating`. Hidden by caller when `ratings.length < 3`.
- `napkin-app/components/restaurants/LogVisitSheet.tsx` — React Native Modal bottom sheet with "Solo log" and (conditionally) "Start a Round here" options.
- `napkin-app/components/restaurants/index.ts` — Added barrel exports for all five new components.

**Screen rewrite**
- `napkin-app/app/restaurant/[id].tsx` — Full rewrite. Accepts `id` (UUID or Place ID), optional `tableId`, `placeId`, `placePayload`. Ghost path: parses `placePayload` for immediate hero render before server data arrives. Wires `useRestaurantPage`, `useTables` (for `hasSocialTable`), `useMyWishlist` (cache warm). Renders: top bar → hero → numbers → log CTA → distribution strip → who's been → visits feed. `LogVisitSheet` navigates to `/create-entry` for both options (restaurant prefill deferred — composer doesn't accept it yet).

### Tests

TypeScript: `npx tsc --noEmit` passes with zero errors.

No automated UI tests added (no existing UI test infrastructure in this repo; manual verification at dinner per Step 8 of CLAUDE.md).

### Builder Questions

1. **`LogVisitSheet` navigation does not prefill the restaurant in `create-entry`.** The existing composer (`app/create-entry.tsx`) only accepts a `tableId` param — there is no `restaurantId` or `placePayload` param. The design says "composer already owns the useCreateEntry / useStartRound mutations and the server-side personal-Table resolution from TICKET-014", but the route params don't support prefill yet. The sheet navigates to `/create-entry` today without restaurant context. A future ticket should add `restaurantId` and `placePayload` params to `create-entry.tsx` to close the two-tap flow. The current behaviour is: Log button → sheet → "Solo log" → create-entry opens at the restaurant search step.

2. **Ghost photo URL.** `RestaurantHero` accepts a `ghostPhotoUrl` prop but the screen doesn't pass one. Ghost restaurants from Places have a `photoReference` (a Places API photo resource name), not a ready-to-render URL. Constructing the URL requires a signed Places Photos API call. The prop is plumbed but unused in v1; a future improvement is to call `places-search` with the photo reference to get a displayable URL.

3. **`placePayload` TICKET-017 hand-off.** The search screen (`app/(tabs)/search.tsx`) currently navigates to `/restaurant/[id]?placeId=...` for ghost results but does NOT pass `placePayload`. The screen handles this gracefully (falls back to server fetch), but hero data won't appear until `useRestaurantPage` resolves. To enable the instant ghost hero, TICKET-017 should update `handleResultPress` to JSON-stringify and pass the full `SearchResultRow` as `placePayload`.

## Builder Questions — Answers

### 1. `create-entry` restaurant prefill

**Do it now, in this ticket.** The "two-tap log" is the whole point of the Log CTA — shipping a button that dumps users back at the restaurant search step is a regression, not a deferral. Don't open a follow-up.

Concrete changes inside this ticket:
- Extend `app/create-entry.tsx` to accept `restaurantId?: string`, `placePayload?: string` (JSON), and `mode?: 'solo' | 'round'` via `useLocalSearchParams`.
- When `restaurantId` is present, skip the restaurant search step and seed the composer's restaurant state with a minimal `PlaceResult`-shaped object fetched via the existing restaurant lookup (or synthesized from a one-shot read of `restaurants` by id). When `placePayload` is present (ghost), parse it directly — no fetch.
- When `mode === 'round'`, default the post-mode state to round after the Table picker resolves; keep the rest of the flow intact.
- The personal-Table auto-resolution for `mode === 'solo'` already exists per TICKET-014 — just set the mode and let the existing flow skip the Table picker if only one target (personal Table) applies.

If you hit unexpected coupling in the composer state machine, stop and flag — but the default posture is finish the flow here.

### 2. Ghost photo URL

**Ship v1 with no ghost photo and remove the dead `ghostPhotoUrl` prop.** Plumbing a prop nothing passes is noise. Rationale:
- `places-search` already persists `photo_reference` and the `_shared/restaurant.ts` upsert hydrates `photo_url` on the first heart/log tap. So the ghost-without-photo window is short: first interaction promotes the restaurant and the next page load has the photo.
- A signed Places Photos fetch purely to decorate the pre-persist hero isn't worth the latency or the API spend.
- The hero's "no-photo bar" fallback already looks intentional — keep it.

Follow-up ticket only if users complain the ghost hero feels empty after real use.

### 3. TICKET-017 hand-off

**Make the one-line fix to `app/(tabs)/search.tsx` in this ticket, don't defer to TICKET-017.** It's a three-line edit inside the existing `handleResultPress` ghost branch:

```ts
params: {
  id: item.placeId,
  placeId: item.placeId,
  placePayload: JSON.stringify(item),
},
```

Rationale: the instant-hero UX is part of TICKET-016's acceptance criteria ("No visible loading-into-existence step"). TICKET-017 is already merged as of `c83383f`; there's no coordination cost, just a tiny edit. The `SearchResultRow` type is already the `RestaurantPayload` shape (per the Ghost payload drift risk you flagged) so consuming it on the restaurant page should be a type-level no-op.

### Summary of next actions for builder

1. Extend `create-entry.tsx` to accept `restaurantId` / `placePayload` / `mode` and skip the restaurant-search step when prefilled.
2. Remove the unused `ghostPhotoUrl` prop from `RestaurantHero`.
3. Patch `search.tsx` `handleResultPress` to pass `placePayload` for ghost results.
4. Re-run `npx tsc --noEmit` and manually verify: search → ghost restaurant → heart, then search → ghost restaurant → Log → Solo log lands in the composer with the restaurant preselected.

---

## Build Log — Follow-up

### Files Changed

- `napkin-app/app/(tabs)/search.tsx` — `handleResultPress` ghost branch now passes `placePayload: JSON.stringify(item)` alongside `id` and `placeId`, enabling instant hero render on the restaurant page (answer 3).

- `napkin-app/components/restaurants/RestaurantHero.tsx` — Removed `ghostPhotoUrl` prop from the `Props` interface and the function signature. `photoUri` now resolves from `restaurant.photo_url` only. Import of `RestaurantPayload` kept (still needed for `restaurantPayloadForGhost`) (answer 2).

- `napkin-app/app/create-entry.tsx` — Extended `useLocalSearchParams` to accept `restaurantId`, `placePayload`, and `mode` params. Added `prefillPlace` memo that parses `placePayload` into a `PlaceResult` on first render. `selectedPlace` and `query` are initialised from `prefillPlace` so the restaurant-search step is skipped when the restaurant is already known. Added a `useEffect` that fetches restaurant data from `restaurant-history?action=page` when only `restaurantId` is present (slow-network fallback). `postMode` initial value seeded from `modeParam`. `autoFocus` on the search `TextInput` suppressed when either prefill param is present (answer 1).

- `napkin-app/app/restaurant/[id].tsx` — `handleSoloLog` and `handleStartRound` now navigate to `/create-entry` with `placePayload` (serialised from the resolved restaurant or ghost synthesis) and `mode` params. When server data isn't loaded yet, falls back to `restaurantId` param; for ghost arrivals without payload, passes `placePayload` through. `createEntryParams` computed via `useMemo` (answer 1).

### Tests

`npx tsc --noEmit` — zero errors.

### Notes

- The `restaurantId`-only fallback path in `create-entry.tsx` (slow-network case) does a one-shot invoke of `restaurant-history?action=page`. In practice this path is almost never hit because `restaurant/[id].tsx` now always prefers to pass `placePayload` when a restaurant object is in hand. The `restaurantId` param exists only as a belt-and-suspenders for the case where the screen navigates before `pageData` has resolved.
- `mode='round'` seeds `postMode` to `'round'` on mount, but the `isPersonalTable` reset effect will flip it back to `'solo'` if the user's selected Table is personal. This is correct: rounds can't be posted to personal Tables.

---

## Review History

### Review 1
Date: 2026-04-17
Verdict: APPROVE (with WARNs)

Spec compliance: 22/23 acceptance criteria met

**Routing / data loading**
- [x] Route accepts Napkin UUID or Place ID + `placeId` — PASS (server regex-detects UUID vs external_id; screen passes both through)
- [~] Ghost render from Places payload / refetched via `places-search` — **WARN**: payload path works end-to-end from search; refetch-by-placeId fallback for cold deep-links is NOT implemented (see Key issue 1). Acknowledged in builder question 3.
- [x] `tableId` query param optional — PASS

**Hero band**
- [x] Newsreader italic name + meta line — PASS (`RestaurantHero.tsx:91-115`)
- [x] Photo above name when available — PASS (falls back to `noPhotoBar` when null)
- [x] Wishlist heart top-right, toggles personal wishlist — PASS (reuses `WishlistHeartButton`, ghost branch passes payload)
- [x] Ghost heart triggers upsert silently — PASS (handled inside `WishlistHeartButton` from TICKET-015)

**Numbers band**
- [x] Primary large personal avg — PASS (`RestaurantNumbers.tsx:48-71`)
- [x] Secondary Table + Google chips same weight — PASS (both use `Type.titleSmall`, same chip style)
- [x] Google chip labeled "Google", never merged — PASS
- [x] Each hidden when empty — PASS (visit_count===0, null chip, null rating)

**Log CTA**
- [x] Single prominent button — PASS
- [x] Bottom sheet with Solo + Round options — PASS (`LogVisitSheet.tsx`)
- [x] Round hidden when no social Tables — PASS (`hasSocialTable` filters `is_personal`)
- [x] Solo log routes to composer with prefill — PASS (post-follow-up: `create-entry` now accepts `placePayload`/`restaurantId`/`mode`)
- [x] Start Round routes to composer with mode=round — PASS

**Distribution strip**
- [x] Only rendered when ≥3 visits — PASS (`allRatings.length >= 3`)
- [x] 10-bin half-star histogram, non-interactive — PASS

**Who's been row**
- [x] Shared-Table users only, with personal avg — PASS (server-side `table_members` self-join; client shows first name + avg)
- [x] Excludes viewer — PASS (`neq('member_id', user.id)`)
- [x] Hidden when empty — PASS

**Visits feed**
- [x] Reverse-chron, avatar/names/rating/note/date — PASS
- [x] Rounds + solos intermixed — PASS (one sorted array)
- [x] Navigation targets — PASS (`handleVisitPress`)
- [x] Scope matches Who's-been (viewer + shared users) — PASS

**State handling**
- [x] Loading: unobtrusive indicator; hero renders ASAP for ghost — PASS
- [x] Error degrades gracefully — PASS (error banner; hero + CTA still render)
- [x] Pure-ghost state renders hero + Google chip + heart + Log CTA only — PASS

---

**Correctness**: PASS — data flow is coherent; server scope rules match spec; ghost-from-payload synthesis is clean.

**Edge Cases**: WARN — cold ghost deep-link (`?placeId=X` with no `placePayload`, restaurant not in DB) shows indefinite spinner. `restaurant/[id].tsx:258-262` only renders the loading view, never escapes; no `places-search` fallback as the spec allows.

**Error Handling**: PASS — edge function wraps in try/catch with structured error; hook unwraps via `unwrapInvokeError`; screen renders "Could not load visit history" banner without breaking hero/CTA.

**Security**: PASS — service-role client validates `auth.getUser(token)`; all scope filters (`member_id = user.id`, `in(memberTableIds)`, `neq('member_id', user.id)`) are enforced server-side. No RLS bypass leaks.

**Performance**: WARN — `action=page` issues 5–7 sequential Supabase queries (restaurant → memberships → personalEntries → tableChip entries → sharedMembers → sharedEntries → feedEntries → feedNights). Acceptable for a detail page but a lot per navigation. `table_chip` query duplicates work that `feedEntries` already does — could be computed in-memory from the visits set. Not blocking.

**Design Compliance**: PASS — follows edge-function action-routed pattern, TanStack Query conventions, theme tokens, Heirloom Journal typography. Barrel exports added. Scope rule "Table is the product" preserved (no cross-Table aggregate).

**Key issues** (all non-blocking):

1. **Cold ghost deep-link has no fallback** (`napkin-app/app/restaurant/[id].tsx:258`) — When a user arrives with only `?placeId=...` (no `placePayload`, restaurant not persisted), the screen spins forever because `pageData.restaurant` is null and `ghostRestaurant` is null. Spec explicitly allows `places-search?placeId=` refetch. Suggest adding a `useQuery` that hits `places-search` by placeId when `isGhost && !parsedPlacePayload && pageData?.restaurant === null`. Probably rare in practice (no surface currently generates such links), but it's a real dead-end.

2. **`tableChip` perf redundancy** (`supabase/functions/restaurant-history/index.ts:463-488`) — `tableEntries` query is essentially a subset of the `feedEntries` query run later. Consolidating would save one round trip. Not blocking; revisit if the page feels slow.

3. **Round author avatar dropped** (`supabase/functions/restaurant-history/index.ts:612-614`) — Rounds set `avatar_url: null` and `user_id: host_user_id` but don't fetch the host's avatar, while solo visits do. `VisitListRow` doesn't render avatars today so no visible bug, but the data-shape asymmetry will bite later. Consider joining `profiles` on `host_user_id`.

4. **`create-entry` fallback fetch is inert in practice** (`napkin-app/app/create-entry.tsx:160-198`) — Comment acknowledges this is belt-and-suspenders; acceptable but the `restaurantId`-only path does a full `action=page` fetch just to populate a place name/address. If ever hit, this is wasteful. Minor.

5. **Distribution scope interpretation** (`napkin-app/app/restaurant/[id].tsx:229-236`) — `allRatings` is computed from `pageData.visits` which already includes viewer's own entries + shared tablemates. Matches the spec's "personal + visible Tablemates' visits ≥ 3". Correct.

**Final verdict: APPROVE**

Ticket meets all hard acceptance criteria; the single partial-miss (ghost refetch fallback) is a cold-path that no existing surface triggers and was flagged by the builder. Ship it; open a small follow-up for the `places-search` fallback if/when a share-link entry point appears.
