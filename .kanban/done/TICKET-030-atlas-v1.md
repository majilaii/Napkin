---
id: TICKET-030
title: "Atlas — geographic lens on a Table (city index + city page + cross-link chip)"
priority: high
status: done
created: 2026-04-22
updated: 2026-04-23
tags: [tables, atlas, maps, restaurants, ui]
---

# Atlas v1

## Problem

Tables today show activity (reverse-chron feed) and wishlist (places we want to go). There's no surface that answers **"where have we been?"** — and in particular no way to lean on the Table's collective travel history when I'm planning a trip.

The killer use case: I'm going to Shanghai next week. I open my Table → Atlas → Shanghai → see every spot my Tablemates have logged there, sortable by rating / recency, filterable by who was there. I leave with a shortlist from people I trust.

Atlas is also the product shape that makes Tables *compound* — every Tablemate's trip increases the Table's value to every other member. Nothing else Napkin has does this.

## Notes

### Locked decisions from brainstorm (wireframes in `wireframes/atlas-canvas.html`)
- **Atlas is Table-scoped only.** One Atlas per Table, never cross-Table. Never public. Solo users don't see Atlas.
- **City-first, not map-first.** Atlas sub-tab opens to a photo-masonry of *cities*, not a world map. Map is a *lens inside a city*, not the entry.
- **City normalization = top-level name only.** "New York City", "Tokyo", "London". No neighborhood rollup. Pull from `restaurants.city` (already populated from Places `locality`).
- **Restaurants without geo** (pre-Places legacy logs with null city/lat/lng) are excluded from Atlas. No fallback.
- **Aggregate per restaurant, not per visit.** One tile / one pin per restaurant. Tile type reflects what happened there:
  - **Solo-only** — 1 avatar + personal rating + date
  - **Round-only** — avatar stack + group-avg rating + lowercase `round` chip + "N of us · date" micro-line
  - **Mixed** — "1 round · N solos" micro-line + aggregate avatar stack. Rating = Round's group-avg (Rounds are the event; solos annotate).
- **Wished-and-visited crossover** — when the viewer personally wishlisted a restaurant that a Tablemate has now logged, render a tiny terracotta outline heart on the tile (top-left) and the pin (top-left, overlapping edge ~2px).
- **Map library** — `react-native-maps`, Apple Maps on iOS (free, native), Google Maps on Android (free tier, needs API key).
- **Map pins — three variants:**
  - **Solo** — 24px cream circle with 1.5px terracotta ring, italic Newsreader rating inside (terracotta ink, tabular-nums)
  - **Round** — 34px cream circle with double ring (2px olive outer + 1px terracotta inner), italic Newsreader group-avg rating inside
  - **Mixed** — Round shell + 6px amber edge-dot at 4 o'clock (half-outside, 1px cream outline). Rating = Round's group-avg.
  - Identity stays OFF the pin. No initials, no avatar stacks. Identity lives in scope pills + peek sheet.
- **Empty state copy** — primary line (Newsreader italic): *"Your first spots land here."* + uppercase muted caption `noted · tried · pinned`. No Tablemate names, no "table" word.
- **Cross-link chip** on restaurant page — below the restaurant name, a small terracotta-bordered chip: `📍 N of M in [city] →`. Deep-links to Atlas city page. Only rendered when ≥2 Table restaurants in that city.

### Page layout

#### Atlas sub-tab on Tables (new — 3rd option)
Sub-tab row becomes `Activity · Wishlist · Atlas` in `app/(tabs)/tables.tsx`. Selecting Atlas swaps the content area (feed) for the Atlas surface.

#### Atlas city index (entry view)
1. **Stat line** — `4 of us · 7 cities · 52 spots · since Mar 2025` (Manrope, muted, tabular-nums)
2. **City masonry** — 2-column Pinterest-grid of city cards, each:
   - Photo-backed hero (use the most-recent or highest-rated photo from that city)
   - Overlay bottom-left: italic Newsreader city name, large
   - Meta line: `12 spots · 3 of us · last Mar`
   - Rounded `Radius.lg` (14px), inset black 10% outline, ambient shadow
3. **Sort default** — most-recent first (the active cities rise). *Open question: alphabetical or most-logged as alternative.*

#### City page (tap a city card)
1. **Header** — chevron-back + city name (Newsreader italic) + meta micro-line `12 spots · 3 of us`
2. **Scope pills row** — `everyone · [Clara] · [Thomas] · [Julian] · [you]` — selecting a pill filters to that person's visits. `everyone` is default/selected.
3. **Sort + view toggle row** — `top rated ▾` on left; two icon toggles on right: **grid** (photo masonry) and **map** (pins). Grid is default.
4. **Grid view (default)** — 2-col photo masonry of restaurant tiles. Solo / Round / Mixed variants as defined above. Tap tile → restaurant page.
5. **Map view** — Apple/Google Map centered on the city bbox. Solo / Round / Mixed pin variants. Tap pin → peek sheet rising from bottom with the visit history at that restaurant (reuse feed card components). Below the map: horizontal peek strip of 4–5 mini-cards (photo + name + rating) — tap to scroll to that pin.
6. **Legend** below the map (small, muted, 11px): `solo · round · mixed` with mini swatches.
7. **Empty city state** — if a city has <1 log, don't show it in the index at all. If you deep-link to a city that no longer has logs, render the empty-state component with copy *"Your first spots land here."*

#### Cross-link chip on restaurant page
Inserted in `app/restaurant/[id].tsx` below the restaurant name / hero, above the numbers row. Only rendered when the Atlas has ≥2 restaurants in this restaurant's city. Chip text: `📍 N of M in [city] →`, where N = this Table's visit count at this restaurant (or 1), M = total restaurants in the city for this Table. Tap deep-links to `/table/[id]/atlas/[city]`.

### Data shape

Single new edge function `table-atlas/` with 2 actions:

**Action: `city-index`**
- Input: `{ table_id }`
- Auth: caller must be a member of `table_id` (RLS + manual check)
- Returns: `{ stats: { members, cities, spots, founded_at }, cities: [{ name, spot_count, member_count, last_visit_at, hero_photo_url }] }`
- Sort: `last_visit_at DESC`
- Query: aggregate `entries`/`table_nights` through `restaurants` where `table_id = ? AND city IS NOT NULL`, group by `city`, count distinct restaurants, distinct members, max visit date, pick photo

**Action: `city-page`**
- Input: `{ table_id, city }`
- Auth: same
- Returns: `{ city, city_stats, restaurants: [{ id, name, cuisine, photo_url, lat, lng, visits: [...], rating, tile_type: 'solo' | 'round' | 'mixed', wished_by_viewer: bool, companion_ids: [uuid] }] }`
- Tile type derivation: if a restaurant has ≥1 Round → `round`; if it also has solo visits → `mixed`; if no Rounds → `solo`.
- Rating for tile:
  - Solo → viewer's personal avg there, else most-recent solo rating
  - Round → Round's `average_rating`
  - Mixed → Round's `average_rating` (Rounds are load-bearing)
- `wished_by_viewer` — joined against `wishlist_items` for `caller_user_id`

### Query hooks (`hooks/tables/`)
- `useTableAtlas(tableId)` — `city-index` query; `staleTime: 5min`
- `useTableAtlasCity(tableId, city)` — `city-page` query; `staleTime: 5min`

### Query keys
Add to `lib/queryKeys.ts`:
```
atlas: (tableId: string) => ['atlas', tableId] as const,
atlasCity: (tableId: string, city: string) => ['atlas', tableId, city] as const,
```
Invalidate on: `useCreateEntry` success (invalidate both), `useWishlistAdd`/`useWishlistRemove` success (just `atlasCity` — affects `wished_by_viewer`).

### Routing
- Atlas sub-tab → inline swap within `tables.tsx` (same pattern as Activity / Wishlist).
- City page → new route `app/table/[id]/atlas/[city].tsx`.
- Need `Stack.Screen` entry in `_layout.tsx` with `headerShown: false`.

### Components to build (all new in `components/atlas/`)
- `AtlasCityIndex` — masonry of `CityCard`
- `CityCard` — photo-backed tile with name overlay + meta
- `AtlasCityPage` — header + scope pills + sort/toggle + grid/map views
- `AtlasGridView` — 2-col masonry of `RestaurantTile`
- `RestaurantTile` — solo / round / mixed variants, with optional heart glyph
- `AtlasMapView` — `react-native-maps` wrapper with `SoloPin` / `RoundPin` / `MixedPin` markers and peek-sheet on tap
- `AtlasPinMarker` — the pin primitives (solo / round / mixed; heart overlay prop)
- `AtlasPeekStrip` — horizontal scroll of mini cards under map
- `AtlasLegend` — tiny footnote legend
- `AtlasEmptyState` — the "Your first spots land here." component (reusable between fully-empty Atlas and empty city)
- `AtlasCrossLinkChip` — the chip on the restaurant page

### Scope
- New edge function `supabase/functions/table-atlas/`
- New components in `components/atlas/` per list above
- New route `app/table/[id]/atlas/[city].tsx`
- New sub-tab wiring in `app/(tabs)/tables.tsx`
- New query hooks + query keys
- `react-native-maps` install + `npx expo prebuild --platform ios` if needed + `pod install` + dev client rebuild
- Android Maps API key — add a placeholder slot in `app.json` + document in the build log (real key goes in env or secrets)
- Cross-link chip inserted in `app/restaurant/[id].tsx`
- Invalidations wired from `useCreateEntry`, `useWishlistAdd`, `useWishlistRemove`

### Depends on
- **TICKET-014** (restaurants table with city + lat/lng) — hard dep (done)
- **TICKET-015** (wishlist) — hard dep (done), for `wished_by_viewer` signal
- **TICKET-027** (companion tagging) — soft dep; scope pills filter by companion. Done.

### Things NOT in this ticket
- **Travel tick** ("you're in Shanghai and 2 Tablemates have pins here") — needs geolocation permission + geofence. Separate follow-up ticket.
- **World-map zoom-out** — deferred to V2.
- **Wishlist-as-layer** on Atlas map — deferred. Atlas stays "been" only; Wishlist tab stays separate.
- **Personal Atlas on public profile** — separate future ticket.
- **Wishlist-to-Atlas notification** ("Julian went to the spot you saved") — separate ticket.
- **Heatmaps / density overlays** — rejected (Table-scale data too sparse).
- **Cross-Table aggregate Atlas** — forbidden by privacy doctrine (Tables never public).
- **Atlas-per-restaurant entry** — rejected in brainstorm. Only Atlas → city → restaurant, plus the cross-link chip.

---

## Build Log

### Phase 1 — shipped 2026-04-22

#### Files Changed

**New files:**
- `supabase/functions/table-atlas/index.ts` — edge function with `city-index` and `city-page` actions
- `napkin-app/hooks/tables/useTableAtlas.ts` — city-index query hook
- `napkin-app/hooks/tables/useTableAtlasCity.ts` — city-page query hook
- `napkin-app/components/atlas/AtlasEmptyState.tsx` — empty state component
- `napkin-app/components/atlas/CityCard.tsx` — photo-backed city masonry tile
- `napkin-app/components/atlas/RestaurantTile.tsx` — solo/round/mixed restaurant tile
- `napkin-app/components/atlas/AtlasGridView.tsx` — 2-col masonry grid
- `napkin-app/components/atlas/AtlasCityIndex.tsx` — stat line + city masonry entry view
- `napkin-app/components/atlas/AtlasCityPage.tsx` — header + scope pills + sort + grid
- `napkin-app/components/atlas/AtlasCrossLinkChip.tsx` — restaurant page chip
- `napkin-app/components/atlas/index.ts` — barrel export
- `napkin-app/app/table/[id]/atlas/[city].tsx` — city deep-dive route

**Modified files:**
- `napkin-app/lib/queryKeys.ts` — added `atlas.index` and `atlas.city` keys
- `napkin-app/hooks/tables/useCreateEntry.ts` — invalidates `['atlas', tableId]` on success
- `napkin-app/hooks/wishlist/useWishlistAdd.ts` — invalidates `['atlas']` on success
- `napkin-app/hooks/wishlist/useWishlistRemove.ts` — invalidates `['atlas']` on success
- `napkin-app/app/(tabs)/tables.tsx` — added Atlas 3rd sub-tab, AtlasCityIndex rendering
- `napkin-app/app/_layout.tsx` — registered `table/[id]/atlas/[city]` Stack.Screen
- `napkin-app/app/restaurant/[id].tsx` — inserted AtlasCrossLinkChip below RestaurantTabs
- `napkin-app/app.json` — added `react-native-maps` plugin block (empty androidApiKey placeholder)
- `napkin-app/package.json` + `package-lock.json` — react-native-maps installed

#### Edge Function Deployed
`npx supabase functions deploy table-atlas --project-ref ftvmseaqwwlcxtdlvxxz` — deployed successfully.

#### Tests
- Deno test suite: 6 test files, 38 steps, all pass
- TypeScript: 0 new errors introduced (2 pre-existing `is_personal` errors in tables.tsx remain from before this ticket)
- Lint: 0 errors, all warnings are pre-existing

#### Manual Steps Required for Phase 2 (map view)
Before Phase 2 can be built, the user must complete:
1. `npx expo prebuild --platform ios` — generates the native iOS project with react-native-maps
2. `cd ios && pod install` — installs CocoaPods native dependency
3. Rebuild dev client: `npx expo run:ios`
4. Android: add your real Google Maps API key to `app.json` `react-native-maps` plugin block (currently empty string `""`)

#### Deviations from Spec
- **`useCreateEntry` invalidation**: The hook only knows `tableId` when called with one. For the general case (no tableId), only `['atlas', tableId]` is invalidated if tableId is present. Atlas city-level keys `['atlas', tableId, city]` are not individually targeted — instead `['atlas', tableId]` is used as a prefix invalidation which covers both index and all city pages. This is consistent with how React Query prefix matching works and matches the spec's intent.
- **Cross-link chip placement**: Placed between RestaurantTabs and the Our Table content block. The wireframe shows it below the hero restaurant name — RestaurantHero contains the name, and RestaurantTabs is immediately below. The chip is the first thing below tabs, which visually achieves "below name / above numbers band" without reaching inside the RestaurantHero component.
- **Gradient overlays on tiles/cards**: The wireframe uses CSS `linear-gradient` for photo darkening. In React Native, expo-linear-gradient would require a native rebuild. Used a bottom-positioned overlay View and textShadow on text instead — functional but less smooth than a true gradient overlay. Can be upgraded to `expo-linear-gradient` post-Phase 2 rebuild.
- **`tables.tsx` `(as const)` array trick**: The tab array type cast is slightly verbose because `isSocialTable` is a boolean conditional. Works correctly at runtime.

#### Open Follow-ups
- Phase 2: AtlasMapView, pin components (SoloPin/RoundPin/MixedPin), peek sheet, legend, grid/map toggle — blocked on native rebuild
- Android Maps API key: add real key to `app.json` before Android Phase 2 build
- Consider upgrading tile/card gradient darkening to `expo-linear-gradient` in Phase 2

---

## Build Log (fix pass) — 2026-04-22

### Blockers

1. **Round-entries double-count** — added `.is('table_night_id', null)` to both entries queries:
   - `supabase/functions/table-atlas/index.ts:157` (`city-index` entries query)
   - `supabase/functions/table-atlas/index.ts:296` (`city-page` entries query)
   `round_count` and `solo_count` now reflect only genuine solo entries.

2. **Non-member redirect** — `app/table/[id]/atlas/[city].tsx:46–54`: added `error` from `useTableAtlasCity` and a `useEffect` that calls `router.replace('/tables')` whenever `error` is truthy. Covers 403 non-member and any other failure.

3. **Round visit-row participants** — `supabase/functions/table-atlas/index.ts`:
   - Added `RoundParticipant` type and discriminated-union `VisitRow` type (round branch carries `round_participants: RoundParticipant[]`; solo branch carries `entry_id`).
   - Build loop at ~line 524 constructs full `round_participants` array from `participant_user_ids` instead of reading only index 0.
   - Updated `hooks/tables/useTableAtlasCity.ts` `AtlasVisitRow` to match discriminated union with `AtlasRoundParticipant`.

4. **Solo tile mini-avatar + name** — `components/atlas/RestaurantTile.tsx`:
   - Imported `Avatar` from `@/components/feed/Avatar`.
   - Solo `microLine` now renders `· Mar 12` (middle-dot + date); name rendered separately.
   - Added `soloName`/`soloAvatarUrl` props to `OverlayProps` and `Overlays`.
   - Solo `whoRow` renders `<Avatar size={14} />` + name text before the micro-line. Styles `soloWho` + `soloName` added.

### Nits

5. **Scope-pill initials** — `components/atlas/AtlasCityPage.tsx:186–213`: `miniAv` circle now contains a `Text` with `pill.label.slice(0,1).toUpperCase()`, styled `Newsreader_400Regular_Italic` 9px, cream (`#fdf6ec`) when selected, `palette.textSecondary` otherwise. Added `alignItems/justifyContent: center` to `miniAv` style and new `miniAvInitial` style.

6. **Hero-photo pick (most-recent)** — `supabase/functions/table-atlas/index.ts:207–255`: refactored `upsertCity` to track `hero_photo_date`; photo is updated only when the incoming `date >= hero_photo_date`, so the hero ends up being the photo from the most-recent visit in the city.

7. **Mixed-tile round pluralization** — `components/atlas/RestaurantTile.tsx:83`: mixed `microLine` now uses `` `${round_count} round${round_count !== 1 ? 's' : ''}` ``.

8. **Dead `spots` Set code** — `supabase/functions/table-atlas/index.ts:283`: removed empty `Set.flatMap(() => []).size ||` branch; `spots` is now simply `sortedCities.reduce((sum, c) => sum + c.spot_count, 0)`.

9. **`hasSocialTable` rename** — `app/restaurant/[id].tsx:135–521`: renamed `hasSocialTable` → `hasAnyTable` (3 occurrences, replace_all).

10. **Simplify tabs cast** — `app/(tabs)/tables.tsx:276`: replaced double `as const` + `as (...)[]` with single direct type annotation `as ('activity'|'wishlist'|'atlas')[]`.

11. **Cross-link encoding** — `app/(tabs)/tables.tsx:347`: removed `encodeURIComponent()` call; now passes raw `cityName` to `params.city`, consistent with `AtlasCrossLinkChip` which also passes raw. Expo Router handles URL encoding via `params`.

### Verify
- `npx tsc --noEmit`: 0 new errors (2 pre-existing `is_personal` errors unchanged)
- Deno tests: 6 test files, 38 steps, all pass
- `npx supabase functions deploy table-atlas`: deployed successfully (130.2kB)

---

## Build Log (phase 2) — 2026-04-22

### Files Created

- `napkin-app/components/atlas/AtlasPinMarker.tsx` — SoloPin / RoundPin / MixedPin pin primitives + HeartOverlay. Nested Views replicate the CSS inset box-shadow double-ring. All pins use ambient shadow and `fontVariant: tabular-nums`.
- `napkin-app/components/atlas/AtlasMapView.tsx` — react-native-maps MapView wrapper. PROVIDER_DEFAULT on iOS, PROVIDER_GOOGLE on Android. fitToCoordinates on mount (≥2 pins), fallback initialRegion for 1 pin. Exposes `animateToPin` via `forwardRef` + `useImperativeHandle`. Skips pins with null lat/lng silently.
- `napkin-app/components/atlas/AtlasLegend.tsx` — Tiny muted footnote row with mini solo/round/mixed swatches mirroring pin shapes. Manrope 11px, textMuted, letter-spacing 0.3.
- `napkin-app/components/atlas/AtlasPeekSheet.tsx` — Modal + Animated.spring bottom sheet (same pattern as AddMemberSheet). Renders full visit history for a selected restaurant. Round rows show participant names ("N of us — Clara · Thomas · you"); solo rows show individual name. Tap navigates to `/entry-detail` or `/table-night-detail`. Drag-to-dismiss via PanResponder. Max height 62% of screen.

### Files Modified

- `napkin-app/components/atlas/AtlasCityPage.tsx` — Wired `viewMode` state (grid/map toggle). Both buttons in view-toggle are now pressable. Map view renders `AtlasMapView` + `AtlasLegend` + `AtlasPeekStrip` (inline ~40 lines). Pin press fires light haptic + `animateToPin` + opens peek sheet. Peek strip card press does same. Scope pills and sort order persist across view changes. Filtered list shared between map pins and grid/strip.
- `napkin-app/components/atlas/index.ts` — Added exports for 4 new components and their types.

### Tests
- TypeScript: 0 new errors (2 pre-existing `is_personal` errors unchanged)
- Deno: 6 test files, 38 steps, all pass

### Deviations from Spec

- **`react-native-svg` not available**: Heart overlay on pins uses `Ionicons name="heart-outline"` at 12px rather than a raw SVG path. Visual result is equivalent for this size. If `react-native-svg` is added in a future rebuild, can be swapped.
- **Round pin font size**: Spec says 14px rating inside Round/Mixed. At 28px inner circle diameter, 14px is tight; used 11px to avoid clipping. Can adjust after visual QA on device.
- **`tracksViewChanges={false}`**: Applied on all Markers for perf per spec. This means the pin view won't update after initial render — acceptable since ratings don't change while the map is open.
- **AtlasPeekStrip card width**: 130px (vs 80px from spec "80×80 photo"). The spec says "80×80 photo + name + rating" — the photo is 80×80 but the card needs text below it. Card total width 130px with 80px photo height matches the wireframe peek-card proportions.

### Builder Questions

- **Double-fire concern (pin press)**: The spec says "confirm PressableScale / haptic flows for marker press don't double-fire." `Marker.onPress` is used directly (no wrapping PressableScale), so there is only one event source. Haptic is fired manually in the `handlePinPress` callback before opening the sheet. No double-fire risk.
- **Android Maps API key**: Still placeholder empty string in `app.json`. Must be filled before any Android build. No change from Phase 1.
- **Runtime**: All new JS compiles clean. Map component will error at runtime until `npx expo prebuild --platform ios && pod install && npx expo run:ios` is done by the user.

---

## Build Log (phase 2 fix pass) — 2026-04-22

### Blockers Fixed

1. **MapView nested in vertical ScrollView** — `components/atlas/AtlasCityPage.tsx`.
   Extracted scope pills + sort/view-toggle into a shared `controls` constant. The page now branches on `viewMode`:
   - `grid`: header pinned above, then a single `<ScrollView>` containing controls + grid content (pull-to-refresh works here).
   - `map`: header pinned above, then `<View style={styles.mapModeContainer}>` (flex, no vertical ScrollView) containing controls + `AtlasMapView` + `AtlasLegend` + `AtlasPeekStrip`. Map pan/zoom now has no ancestor vertical scroll to conflict with.
   Added `mapModeContainer` and `mapContent` styles.

2. **Dead `imgOutline` overlay** — `components/atlas/AtlasCityPage.tsx:614-621`.
   Removed the `<View style={styles.imgOutline} />` element (which had `borderWidth: 0`, rendering nothing). Dropped the `imgOutline` style. Applied `borderWidth: 1, borderColor: 'rgba(0, 0, 0, 0.08)'` directly on the `<Image>` via a new `peekPhotoImg` style — consistent with how `Avatar` applies its inset border outline.

### Nits Fixed

3. **Stale fit deps** — `components/atlas/AtlasMapView.tsx:91`.
   Replaced `[validPins.length]` dep with `[pinKey]` where `pinKey = validPins.map(r => r.id).sort().join(',')`. Map now refits when the scope-pill filter swaps restaurants even if the count is unchanged.

4. **Dead ternary** — `components/atlas/AtlasCityPage.tsx:81-86`.
   Collapsed `tile.rating % 1 === 0 ? \`${tile.rating}\` : \`${tile.rating}\`` to `tile.rating.toFixed(1)`. Ratings now always render with one decimal place in the peek strip.

5. **Solo-pin font size** — `components/atlas/AtlasPinMarker.tsx`.
   `soloRating.fontSize` raised from `9` to `11` (matching `roundRating`). `lineHeight` updated from `11` to `13` to match. File-top docstring and inline comment updated to say "11px (matches Round)".

6. **"you" last in Round participant list** — `components/atlas/AtlasPeekSheet.tsx:58-74`.
   `buildRoundWho` now sorts `round_participants` so the entry matching `currentUserId` sorts to the end before mapping to display names. Output reads `"Clara · Thomas · you"` per wireframe.

### Verify
- `npx tsc --noEmit`: 0 new errors (2 pre-existing `is_personal` errors unchanged)
- Deno tests: 6 test files, 38 steps, all pass

---

## Product Spec

### User Stories

- As a **Tablemate planning a trip to Shanghai**, I want to open my Table → Atlas → Shanghai and see every spot anyone at my Table has logged there, sorted by rating, so that I leave with a shortlist in under a minute.
- As a **Tablemate browsing locally**, I want to open my home city in Atlas and see where everyone has eaten, so that I can pick a neighborhood I haven't tried or revisit a forgotten spot.
- As a **Tablemate who trusts one person's palate for a specific cuisine**, I want to scope the Atlas by that person (e.g., "Julian only") and see just their pins, so that I can piggyback their taste.
- As a **Tablemate planning a Round**, I want to filter Atlas by multiple companions to see places where we all already love to eat, so that Round planning is trivial.
- As a **user who wishlisted a spot** that a Tablemate has now visited, I want a quiet heart glyph on that tile/pin in Atlas, so that I notice the bridge between wish and record without an inbox buzz.
- As a **user opening Atlas on a brand-new Table**, I want a graceful empty state ("Your first spots land here.") — no Tablemate names, no mention of "table" — so that the surface doesn't feel like a dead door.
- As a **user reading a restaurant page** in a city where my Table has other logs, I want a small cross-link chip ("N of M in Shanghai →") below the name, so that I can zoom out to the city view with one tap.
- As a **user tapping a pin on the map**, I want a peek sheet rising from the bottom showing every visit at that restaurant (Round cards + Solo cards, chronologically), so that I see the full history, not just one event.
- As a **user switching between grid and map view**, I want the scope pills, sort, and companion filter to persist so that my filter doesn't reset on view change.
- As a **solo user (no Table)**, I don't see Atlas at all — the sub-tab is hidden, and no prompt ever suggests it. Tables remain earned, not defaulted.

### Acceptance Criteria

1. Tables tab has a new `Atlas` sub-tab as the 3rd option, following the existing sub-tab pattern.
2. Selecting Atlas when the Table has ≥1 restaurant with a non-null city renders the stat line + city masonry.
3. Selecting Atlas when the Table has 0 restaurants-with-city renders `AtlasEmptyState` with the copy "Your first spots land here." and the `noted · tried · pinned` caption.
4. Each city card shows: photo-backed hero, italic Newsreader name, meta line (`N spots · M of us · last [month]`).
5. City cards are ordered `last_visit_at DESC`.
6. Tapping a city card navigates to `/table/[id]/atlas/[city]`.
7. City page header shows: chevron-back, italic city name, meta line; bottom of body has pressable scope pills (one per member including `everyone` and `you`), sort menu (`top rated ▾` default, `most recent` alt), and a grid/map toggle (grid default).
8. Grid view renders restaurant tiles as Solo / Round / Mixed variants, distinguishable at a glance (avatar count, `round` chip, micro-line), with italic-Newsreader rating.
9. Heart glyph appears on any tile where the viewer personally wishlisted that restaurant prior to first visit.
10. Map view renders `react-native-maps` Map with Solo / Round / Mixed pin variants as spec'd (double-ring for rounds, amber edge-dot for mixed, italic rating inside). Same heart-overlay support.
11. Tapping a pin opens a peek sheet with the full visit history at that restaurant (Round cards + Solo cards).
12. Scope pills persist when toggling between grid/map.
13. Sort change refreshes the order of tiles AND map pins (pins are same set; sort only affects grid + peek-strip order).
14. Empty state for an empty city (deep-link) renders `AtlasEmptyState`.
15. Restaurant page renders `AtlasCrossLinkChip` when the current Table has ≥2 logged restaurants in that restaurant's city. Tapping the chip navigates to `/table/[id]/atlas/[city]`.
16. `useCreateEntry` invalidates `['atlas', tableId]` and `['atlas', tableId, city]` on success.
17. Wishlist add/remove invalidates `['atlas', tableId, city]` (heart glyph reflects current state).
18. Solo users (users with no `table_members` row) never see Atlas — sub-tab is hidden and `/atlas/*` routes redirect to `/tables`.
19. Numbers (stat line, ratings, counts) use `fontVariant: ['tabular-nums']`.
20. All pins and tiles apply image outline `rgba(0, 0, 0, 0.10)` and ambient shadows per design system.
21. Pin markers + tiles use `PressableScale` for tactile feedback on tap (scale 0.96, haptic light).
22. City page uses the HTML wireframe `wireframes/atlas-canvas.html` as design reference.

### Non-Goals (explicit)
- World map at Atlas entry
- Wishlist overlay on the Atlas map
- Geofenced travel tick
- Personal Atlas on public profile
- Cross-Table aggregate

### Open Questions (tracked; decide before build merges)
1. **Mixed-tile aggregate rating** — confirmed: Round's group-avg. No blended avg in V1.
2. **City sort default** — locked: most-recent.
3. **Wishlist-to-Atlas notification** — deferred. Separate ticket.
4. **Atlas vs. private diary** — solo user with no social Table has personal-Table-only logs. Atlas is Tables-scope only in V1 — personal Atlas is a future ticket on the public-profile side.

### References
- Wireframes — `wireframes/atlas-canvas.html`
- Pattern reference — `.kanban/done/TICKET-016-restaurant-page-v2.md` (aggregated edge endpoint + leaf component decomposition)
- Map library docs — https://docs.expo.dev/versions/latest/sdk/map-view/ (react-native-maps via Expo)

---

## Review History

Reviews drove the fix passes captured in the Build Log sections above:

- **Phase 1 review → fix pass (2026-04-22)** — resolved in `## Build Log (fix pass) — 2026-04-22`.
- **Phase 2 review → fix pass (2026-04-22)** — resolved in `## Build Log (phase 2 fix pass) — 2026-04-22`. Blockers fixed: MapView nested in vertical ScrollView, dead `imgOutline` overlay. Nits fixed: stale fit deps, dead ternary, solo-pin font size, "you" last in Round participant list.

Final state after phase 2 fix pass: `npx tsc --noEmit` 0 new errors; Deno tests 6 files / 38 steps passing.

---

## Completion

- **Completed:** 2026-04-23
- **Final verdict:** APPROVE (all blockers + nits from both review passes resolved)
- **Shipped in:** `200fe01 TICKET-022 calibration + TICKET-030 Atlas Phase 2 + TICKET-031 scaffolding + session bugfixes (#40)` — merged to `main`.
  - Phase 1 commit: `250df75 feat: Atlas v1 — geographic lens on a Table's dining history (TICKET-030 Phase 1)`
  - Phase 2 commit: `7f22e8c feat: Atlas Phase 2 — map view, pins, peek sheet, legend, grid/map toggle`
  - Session audit follow-up: `4a49746 fix: session audit — table-management redeploy + atlas hooks + diary column`
- **Deployed:** `table-activity` edge function (Atlas endpoint) deployed to production Supabase (`ftvmseaqwwlcxtdlvxxz`).
- **Follow-ups (not blocking ship):** see `#### Open Follow-ups` under the Phase 1 Build Log. Deferred items tracked in `### Things NOT in this ticket`.
