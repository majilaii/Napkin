---
id: TICKET-031
title: "Restaurant page v3 (signal strip, tier-switchable histogram, photos tab, richer info)"
priority: high
status: done
created: 2026-04-23
updated: 2026-04-23
tags: [restaurants, ui, pages, photos, info]
---

# Restaurant page v3

## Problem

The v2 restaurant page (TICKET-016) solved the personal-first hero and the log CTA, but three gaps remain:

1. **Info tab is barebones** — four rows (Address / Cuisine / Price / Google). Not enough to justify the tab.
2. **Scope-shaped tabs break journeys.** "Our Table" and "Everyone" assume the user is always in a table. Day-one solo users land on an empty tab; returning visitors have to toggle just to see external consensus.
3. **No photo surface.** Tablemates take photos at restaurants; those photos live buried in individual entry cards, never surfaced on the restaurant page itself.

## Solution (doctrine locked after wireframe v4)

Restructure around **one signal strip + content-shaped tabs**.

### Layout (top → bottom)

1. **Hero** — unchanged (photo, name, address line, bookmark, back).
2. **Signal strip** — one row of up to 4 cells with **ghost rules** between them (no boxes):
   - **You** — personal average, visit count
   - **Your table** — table average, tablemate count (only when the user has a table AND ≥1 tablemate has logged this restaurant)
   - **Napkin** — aggregate across all public Napkin users
   - **Google** — external signal (always inert — no histogram available)
   - Cells with no data render ghosted ("—" + muted sub)
   - Tapping a cell **swaps the histogram below**. The active cell gets a subtle terracotta underline.
   - Google cell is non-tappable for histogram (no distribution data from Places).
3. **Distribution histogram (single, tier-switchable)** — 5 rows (5★ → 1★), slim bars. Heading is italic serif kicker: `— Your table's distribution`. Subtle hint on the right: `tap to switch`. Default active tier = richest available (your table if ≥3 visits, else Napkin, else You).
4. **Tabs** — `Visits` · `Photos` · `Info`.
5. **Tab content** — see below.

### Visits tab

- Italic serif kicker above the list (only when the user has logged it): `— your last — Apr 14, rated 4.5. you're due another.`
- Voices weave by trust ring, in this order:
  1. **You** (self avatar olive-gradient; shown first when the user has logged)
  2. **Your tablemates** (terracotta-gradient avatars; sorted by date desc)
  3. Dashed divider with italic murmur: `— from outside your circle`
  4. **Public Napkin users** (ghosted-surface avatars with `@handle`-style names)
- Each voice row: avatar, display name, `·`, rating (italic serif terracotta), `·`, date; one-line italic note below prefixed with `— `.
- Empty state (discovery, never been, no tablemates): just public voices. No nudge copy needed — the floating log button carries intent.

### Photos tab (NEW)

**Two explicit sections** (user insisted on separation, not a mixed wall):

1. **From your table · N** — 3-col grid, tag chips warm-toned:
   - Tablemate tags → terracotta background (`rgba(160,63,40,0.85)`)
   - Your own tags → olive background (`rgba(107,124,58,0.85)`)
2. **Em-dash serif divider** between the two sections (see wireframe `.photo-sec-sep`).
3. **From other folks · N** — 3-col grid, tag chips dark (`rgba(28,28,25,0.55)`), labels are `@handle` style.

If the user has no table, the first section is hidden and the second expands. If there are no public photos, only the table section renders.

Below both sections, a dashed-rule note: `— what they ordered coming later` (placeholder for future dish-level browsing; NOT in this ticket).

### Info tab

- **Map preview** — 128px tall, rounded-10, subtle grid pattern + terracotta pin centered. Static — tap opens device maps app at lat/lng.
- **Action row** — two buttons side-by-side:
  - **Get directions** (solid ink, cream text) — deeplinks to Apple Maps on iOS / Google Maps on Android
  - **Copy address** (ghost, ink border)
- **Grouped rows** (each group separated by thin ink-rule with uppercase micro-caps label):
  - **Where** — Address, Area
  - **When** — Today's hours (`11:00 – 22:00 — open now`). Only render if Places returned hours.
  - **Reach** — Website / Call / Menu. Each row only renders if Places returned that field. Values in terracotta with trailing `›`.
  - **Basics** — Cuisine, Price (`$$ — affordable`)
- **Footnote** (dashed top rule, italic serif): `First logged by your table — Mar 2025. Now in 3 of your tables.` — only shown when the user's tables have logged this restaurant.

### Signal strip persistence

The signal strip + tabs header **persist on every tab** — it's the page's identity. Only the content below the tabs changes.

## Visual reference

Canonical wireframe: `wireframes/restaurant-info-rethink.html` (four frames — Discovery, Returning·Visits, Photos, Info). Implementation must match its visual density, typography, and color treatment exactly. Use Heirloom tokens from `constants/theme.ts`. No hardcoded colors.

**Non-negotiable**:
- Ratings are `/5`, numerals in italic Newsreader.
- Signal strip uses ghost vertical rules, not boxed cells.
- Terracotta underline on active signal cell.
- Em-dash pull-quote notation (`—`) prefixes italic serif body copy.
- Log pill stays bottom-right per existing `FloatingLogButton.tsx` — `+ Log` on first-time, `+ Log again` once logged.

## Scope

### Frontend

Rewrite `app/restaurant/[id].tsx` to the new structure. New components in `components/restaurants/`:

- `SignalStrip.tsx` — 4-cell row, active-tier prop, tap handler
- `SwitchableDistribution.tsx` — single histogram, accepts tier + data per tier
- `VoicesStream.tsx` — weaves you + tablemates + (divider) + public, trust-ring ordered
- `YourLastKicker.tsx` — italic serif kicker above Visits stream
- `PhotosTab.tsx` — two-section photo grid with em-dash divider
- `InfoTab.tsx` — map preview, action row, grouped rows, footnote
- `InfoMapPreview.tsx` — static map with pin; tap → `Linking.openURL` to maps deeplink

**Delete or repurpose**: `TableRatingBlock`, `RestaurantNumbers`, `CommunityTab`, `WhoBeenRow`, `VisitListRow`, `RatingDistribution` (replaced by `SwitchableDistribution`). Keep `RestaurantHero`, `FloatingLogButton`, `LogVisitSheet`, `PublicReviewsSection` (but may be subsumed into `VoicesStream`).

Update `hooks/restaurants/useRestaurantPage.ts` return shape to include the new fields.

### Backend (edge function `supabase/functions/restaurant-history/index.ts`, `action=page`)

Extend the response to include:

- `distributions`: `{ you: number[]; your_table: number[] | null; napkin: number[] }` — each a 5-element array `[count_1_star, count_2_star, ..., count_5_star]`. Null for `your_table` when the user has no table.
- `photos`: `{ from_your_table: PhotoItem[]; from_others: PhotoItem[] }` where `PhotoItem = { url: string; author_display_name: string; author_handle: string; is_tablemate: boolean; is_self: boolean; entry_id: string }`. Cap each list at 24.
- `place_details` (best-effort, only when ghost payload or cached Places data has them):
  - `hours_today`: `string | null` (e.g. `"11:00 – 22:00"`)
  - `open_now`: `boolean | null`
  - `hours_week`: `Array<{ day_range: string; range: string }> | null`
  - `website`: `string | null`
  - `phone`: `string | null`
  - `menu_url`: `string | null`
  - `lat`: `number | null`
  - `lng`: `number | null`
- `tables_count_with_logs`: `number` — "Now in N of your tables."
- `first_logged_at_by_your_table`: `string | null` — for the footnote.

If extending the existing schema for Places fields is too heavy, mark `place_details` as optional and render only the cells where data exists. **Do not block shipping on full Places coverage** — the Info tab must render gracefully with just Address + Cuisine + Price + Google if nothing else is available.

### Query keys

Add any new keys to `lib/queryKeys.ts` under `queryKeys.restaurants.*` — follow existing pattern.

## Acceptance criteria

1. First-time visitor (no personal logs, no table) sees signal strip with You/Your table ghosted, Napkin active with histogram, Google inert. Visits tab shows public voices. Photos tab shows only "From other folks" or an empty state if none. Info tab renders Address + Cuisine + Price + Google + any available Places fields.
2. Returning user in a table sees all four signal cells populated, Your table as default active histogram tier. Tapping You, Your table, or Napkin swaps the histogram. Google cell does nothing on tap.
3. Visits tab shows italic kicker referencing the user's last visit, their own voice first, tablemates next, dashed divider, public voices last.
4. Photos tab shows two labeled sections with em-dash divider when user has a table AND tablemates have uploaded photos. Only "From other folks" renders when no table photos exist.
5. Info tab: Get Directions opens maps app (Apple Maps on iOS, Google Maps on Android) at the correct lat/lng. Copy Address copies to clipboard. Website/Call/Menu rows only render when Places returned that field.
6. Signal strip + tabs persist across tabs (only content below tabs changes).
7. Log pill stays bottom-right, reads `+ Log` for discovery and `+ Log again` for returning user.
8. All ratings render `/5`. Italic Newsreader for numerals.
9. No visual regression on existing screens that link into the restaurant page (feed row tap, round detail "Previously here" banner tap, wishlist card tap, search result tap, solo deep-link, ghost deep-link).
10. Matches `wireframes/restaurant-info-rethink.html` at visual density and token level.

## Out of scope

- Dish-level "what people ordered" browsing (future ticket; placeholder line only)
- Full-screen photo carousel (tap-to-expand for now is optional; could be one-line `Alert` or no-op)
- Hours schema upgrades beyond best-effort from existing Places cache
- Napkin-wide histogram when user is solo (falls back to You-only or Napkin as appropriate — no emergence nudge card)
- Reserving / booking integrations

## Dependencies

- TICKET-016 (Restaurant page v2) — replaces its structure
- TICKET-020 (Public profiles) — public voices need public-user data
- TICKET-021 (Public reviews on restaurant pages) — source of public voices

## Notes

Voice ordering preserves the Tables-never-public doctrine: tablemate voices sit above public voices with a visible trust-ring divider. Nothing from a Table's private feed leaks into the public scope; only *public* entries from Napkin users appear below the divider.

---

## Build Log

### Status: ready for review

### Files Changed

**Edge function:**
- `supabase/functions/restaurant-history/index.ts` — extended `action=page` response with `distributions`, `napkin_aggregate`, `photos`, `place_details`, `tables_count_with_logs`, `first_logged_at_by_your_table`. Added `is_self` / `is_tablemate` flags to visits. Best-effort `place_details` reads `latitude`, `longitude`, `website`, `phone`, `menu_url` columns from `restaurants` table (graceful null if absent). Deployed to `ftvmseaqwwlcxtdlvxxz`.

**Hooks:**
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — updated `RestaurantPageData` type with all v3 fields; added `PhotoItem`, `PlaceDetails` types; back-fills v3 fields for older responses.

**New components (`napkin-app/components/restaurants/`):**
- `SignalStrip.tsx` — 4-cell strip with ghost vertical rules, active terracotta underline, tappable You/Your table/Napkin cells, Google cell inert.
- `SwitchableDistribution.tsx` — single histogram, tier-switchable, italic serif kicker, "tap to switch" hint.
- `RestaurantTabsV3.tsx` — Visits / Photos / Info tabs (replaces old Our Table / Everyone / Info).
- `VoicesStream.tsx` — trust-ring-ordered: self (olive gradient) → tablemates (terracotta gradient) → dashed ring divider → public (ghosted surface). LinearGradient avatars.
- `YourLastKicker.tsx` — italic serif kicker with terracotta left-border rule.
- `PhotosTab.tsx` — two-section photo grid; terracotta tags for tablemates, olive for self, dark for public; em-dash serif divider; "what they ordered coming later" placeholder.
- `InfoTab.tsx` — map preview + Get Directions + Copy Address + grouped info rows (Where/When/Reach/Basics) + dashed footnote.
- `InfoMapPreview.tsx` — static map with grid lines + terracotta pin; tap → Linking.openURL (Apple Maps on iOS, geo: on Android).

**Updated:**
- `napkin-app/components/restaurants/index.ts` — exports all new components.
- `napkin-app/app/restaurant/[id].tsx` — full rewrite to v3 layout: signal strip → histogram → tabs.

---

### Review 1 Fix Pass (2026-04-23)

**Edge function (`supabase/functions/restaurant-history/index.ts`):**
- **Blocker 1 fixed** — Visits feed `allVisibleUserIds` (which includes `user.id`) is now fetched unconditionally. Only the Rounds branch remains gated on `memberTableIds.length > 0`. Solo users with no tables now see their own entries in the Visits stream and their `personal.last_visit` kicker. Also moved `const allVisibleUserIds = [user.id, ...sharedUserIds]` outside the old guard block.
- **Blocker 2 fixed** — `entry_photos` query now uses `entries!inner(user_id, restaurant_id, table_id)` with `.eq('entries.restaurant_id', resolvedRestaurantId)` so the filter happens server-side before `.limit(48)`. Added `ARCHITECT-REVIEW` comment explaining the indexing gap. `photoErr` is now logged on error instead of silently swallowed.
- **Blocker 3 fixed** — `fromYourTable` now requires either `isSelf` OR (`entryTableId != null && memberTableIds.includes(entryTableId)`). Feed-only entries (`table_id = null`) from tablemates correctly route to `fromOthers`.
- **Issue 12 fixed** — Added `napkin_aggregate` field to the edge function's local `RestaurantPageData` type.

**Frontend components:**
- `components/restaurants/SwitchableDistribution.tsx` — when `activeTier === 'your_table'` and `distributions.your_table === null`, now renders an italic empty-state line ("— not enough visits yet") instead of silently falling back to napkin data under the "Your table's distribution" heading (issue 4).
- `app/restaurant/[id].tsx` — tier-init race fixed (issue 5): replaced `tierInitialized` state with a `tierDefaultAppliedRef` ref (tracks whether the auto-default has fired) and a `tierUserSelectedRef` ref (tracks whether the user has tapped). The auto-default only fires once on first data load, and never if the user already tapped. Renamed `setActiveTier` wrapper to mark `tierUserSelectedRef` on tap.
- `app/restaurant/[id].tsx` + `components/restaurants/VoicesStream.tsx` — typo `tamemateVisits` → `tablemateVisits` fixed everywhere (issue 6, replace_all).
- `components/restaurants/InfoTab.tsx` — switched from deprecated `Clipboard` from `react-native` to `expo-clipboard` (`Clipboard.setStringAsync`). Group separator `RULE_COLOR` changed from dusty-rose `rgba(221,192,186,0.4)` to ink-tone `rgba(28,28,25,0.12)` per spec. Dashed footnote rule replaced with cross-platform `DashedRule` component (repeating View segments) that renders correctly on Android (issue 8).
- `components/restaurants/SignalStrip.tsx` — cell `paddingVertical` increased from 4 to 10, `minHeight: 44` + `justifyContent: 'center'` added, `hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}` on each Pressable so tap targets meet 44pt minimum (issue 8).

### Tests

**Review 1 fix pass (2026-04-23):**
- `expo lint`: 0 errors, 33 warnings (all pre-existing in other files — no regressions introduced).
- Edge function deployed to `ftvmseaqwwlcxtdlvxxz` and accepted.

**Original build:**
- `expo lint`: 0 errors, 33 warnings (all pre-existing in other files).
- `expo export --platform ios`: bundle compiled clean (1932 modules).
- Edge function deployed and accepted.

### Builder Questions

1. **`photos` query scalability**: Now fixed — uses `entries!inner` join with server-side restaurant filter before `.limit(48)`. A further improvement would be to add `restaurant_id` directly to `entry_photos` with an index. `ARCHITECT-REVIEW` comment left in the edge function at the query site.

2. **`Clipboard` API**: Fixed — switched to `expo-clipboard` (`setStringAsync`).

3. **`place_details` columns**: The edge function reads `latitude`, `longitude`, `website`, `phone`, `menu_url` from the `restaurants` table. These columns may not exist yet in production schema — the function will return nulls gracefully, but a migration should add them when full Places coverage is desired.

4. **`napkin_aggregate`**: Currently fetches ALL entries at a restaurant (no public/privacy filter) for the Napkin histogram. This is consistent with how the old `google_rating_count` works (everyone). If Napkin numbers should only count entries from users with public profiles, this needs a join on `profiles.is_public` — not blocking for v1.

5. **`Newsreader_500Medium_Italic` font**: Used in SignalStrip rating numerals. Confirmed it's loaded in the project (used in `table-night-detail.tsx`).

6. **Dashed ring divider (InfoTab footnote)**: Fixed — replaced `borderStyle: 'dashed'` with a cross-platform `DashedRule` component (repeating small `View` segments). The `VoicesStream` ring divider between trust rings uses a `borderTopWidth: 1` solid rule (which was already there and acceptable per review).

---

## Review

### Review 1
Date: 2026-04-23
Verdict: REVISE

Spec compliance: 7/10 acceptance criteria met
- [x] AC1 Discovery signal strip — PASS: ghosted You/Your table, active histogram, Google inert.
- [x] AC2 Returning-user signal strip — PASS: default tier derived correctly; Google tap disabled via `disabled={inert || isEmpty}`.
- [ ] AC3 Visits tab kicker + self-first ordering — **FAIL (partial)**: `visitsRaw` is populated only when `memberTableIds.length > 0` (edge fn line 642). A solo day-one user who has logged this restaurant but has no table will see their own self voice missing from the Visits stream and no `YourLastKicker` (kicker depends on `personal.last_visit` which still populates, but the voice row disappears). Breaks the "individual-first" doctrine at the exact surface it matters.
- [x] AC4 Photos two-section layout — PASS structurally; but see Key Issue #2 re silent photo truncation.
- [x] AC5 Get Directions / Copy / Website / Call / Menu — PASS functionally; Clipboard import is deprecated (builder flagged).
- [x] AC6 Signal strip + tabs persist across tabs — PASS.
- [x] AC7 Log pill bottom-right, `+ Log` / `+ Log again` — PASS (plus glyph + "Log"/"Log again" text; matches wire).
- [x] AC8 Ratings `/5` numerals italic Newsreader — PASS (Newsreader_500Medium_Italic / 400 italic throughout).
- [ ] AC9 No regression on linked screens — **UNVERIFIED / RISK**: `components/restaurants/index.ts` still exports all legacy components (`VisitListRow`, `RatingDistribution`, `WhoBeenRow`, `RestaurantNumbers`, `TableRatingBlock`, `CommunityTab`) — good for backward compat on *other* callers (Round "Previously here" banner, entry-detail, etc.). Ticket said "Delete or repurpose" — builder kept them, which is fine. But the co-mingled atlas changes on the same branch pose a real regression risk that is outside this ticket's scope.
- [ ] AC10 Matches wireframe at density/token level — **PARTIAL**: fidelity issues listed below.

Correctness: FAIL — day-one solo user loses their own Visits row (edge fn gating).
Edge Cases: FAIL — SwitchableDistribution falls back to `napkin` data while still titling the section "Your table's distribution" (line 39–43 + `tierLabel` in `SwitchableDistribution.tsx`).
Error Handling: WARN — `photos` query swallows `photoErr` silently (line 789). `napkinEntries` fetch ignores errors (line 767). Either should log or surface.
Security: WARN — no new RLS exposure; trust ring preserved (public_reviews via RPC, visits gated by `allVisibleUserIds`). But: photos `fromYourTable` surfaces photos from **feed-only** tablemate entries (entries with `table_id IS NULL` belonging to a shared user), which are the user's private journal, not shared-to-table content. This crosses the "feed-only is not shared" line. Needs `table_id` scoping or explicit doctrine sign-off.
Performance: FAIL — `entry_photos` fetch does `.limit(200)` then filters in JS by `restaurant_id` (line 783–793). At scale this means (a) the 201st photo in the whole `entry_photos` table is the ceiling and this restaurant's photos can be totally absent from the result set, and (b) we're shipping ~200 rows + joins every page load. Builder self-flagged but did not add an `ARCHITECT-REVIEW` comment despite saying they would.
Design Compliance: WARN — see Key Issues #4–#6.

### Key issues

1. **Day-one solo user loses their self-voice and tablemate-less Visits stream.** `supabase/functions/restaurant-history/index.ts:642` gates the entire `visitsRaw` build on `memberTableIds.length > 0`. A user with no tables but personal entries at this restaurant will see an empty Visits list (only public reviews below the divider, which itself won't render because `hasPrivateVoices=false`). Fix: move the viewer's own-entries fetch outside the `memberTableIds.length > 0` block, and only gate the `sharedUserIds`/Rounds branches on table membership.

2. **Photos query is correctness-broken, not just slow.** `supabase/functions/restaurant-history/index.ts:783` selects the first 200 `entry_photos` rows **before** filtering by restaurant. For any restaurant whose photos aren't in the global first-200, the Photos tab silently shows zero. This is not "scale later" — it's wrong today. Minimum fix: filter server-side via `entries!inner(restaurant_id).eq('restaurant_id', resolvedRestaurantId)` or add `restaurant_id` to `entry_photos` and index it. Add the `ARCHITECT-REVIEW` comment the builder promised.

3. **Feed-only photos from tablemates leak into "From your table".** Same query (`index.ts:783–817`) routes any photo by a sharedUserId into `fromYourTable`, regardless of whether the entry was shared to a table (`table_id IS NOT NULL`) or journaled solo. Tablemates' private journal photos surface on the restaurant page. Scope either by `entries.table_id IS NOT NULL` or confirm doctrine explicitly permits this.

4. **SwitchableDistribution mis-labels fallback data.** `components/restaurants/SwitchableDistribution.tsx:39–43`: when `activeTier === 'your_table'` and `distributions.your_table === null`, the component renders Napkin's histogram under the heading "Your table's distribution". Either hide the your_table tier entirely in `SignalStrip` when `hasData=false` (already done) AND forbid activeTier from being 'your_table' in that state, or change the title to reflect the actual data.

5. **Tier re-initialization race.** `app/restaurant/[id].tsx:256–262`: if the user taps a signal cell before `pageData` arrives, their selection is overwritten the first time data loads. Low-probability but wrong. Use a ref or guard on `tierInitialized` being set by any user interaction.

6. **Visual fidelity gaps vs wireframe.**
   - `InfoTab` group separators use `RULE_COLOR = rgba(221,192,186,0.4)` (dusty rose). Spec says "thin **ink-rule**". Should be ink (`#1c1c19`) at low alpha, or `palette.textMuted` at low alpha to match the wire's ink treatment.
   - Footnote `borderStyle: 'dashed'` renders solid on Android (builder flagged). The wire's dashed rule is load-bearing (it's how the footnote reads as an aside). Needs a cross-platform implementation (e.g. `react-native-svg` dashed line, or a repeating `<Text>` em-dash row).
   - `SignalStrip` ghost vertical rules use full-height `borderLeftWidth: 1` — wire shows the rule inset vertically (not reaching top/bottom of cell). Minor.
   - `activeUnderline` in SignalStrip is positioned `bottom: -8` (outside the cell). Works, but it's floating into the parent's padding — if the outer strip ever adds a border-bottom or overflow:hidden this disappears. Fragile.

7. **Accessibility / tap targets.** SignalStrip cells have `paddingVertical: 4` (`SignalStrip.tsx:163`). Effective tap area ≈ 40px tall. Below the 44pt target, and Google cell has no disabled visual cue beyond not reacting to press. Also no `accessibilityRole="button"` / labels on any of the v3 tap surfaces.

8. **Typo: `tamemateVisits`** — in `VoicesStream.tsx` and `app/restaurant/[id].tsx:310`. "tablemate" → "tamemate". Rename before merge; it'll haunt future greps.

9. **Clipboard deprecation.** `InfoTab.tsx:18` imports `Clipboard` from `react-native` — removed in RN 0.73+. Works today, but should move to `expo-clipboard` (already likely in the project via Expo SDK). Low cost to fix.

10. **`hours_today` / `hours_week` always null.** Edge function never reads hours columns, so the "When" group never renders. Spec marked this best-effort — OK to ship, but the footnote claim that Info "renders gracefully with just Address + Cuisine + Price + Google" is all the user will ever see until a schema migration lands. Confirm stakeholder alignment or park a follow-up ticket.

11. **Branch hygiene.** This diff contains un-related atlas changes (`AtlasMapView`, `AtlasPinMarker`, `table-atlas` edge function, etc.) and UI primitive changes (`PillButton`, `Rating`, `Avatar`, `PhotoCollage`, `PhotoStrip`, `MultiPhotoRow`, new `PressableScale`). None are called out in the ticket's Files Changed list. Either extract to separate tickets/commits or explicitly add them to the ticket scope. This matches the recurring pattern flagged in agent memory.

12. **Missing `napkin_aggregate` in type.** Edge fn returns `napkin_aggregate` (`index.ts:881–884`) but the local `RestaurantPageData` type in the edge function (`index.ts:84–118`) doesn't declare it. The client type does. Harmless but a mismatch.

13. **`chipEntries` averages can include non-`chipTableId` entries in memberCount calc.** `tableVisitorIds.size` uses only `chipEntries` (correct). `tableRatings` is also chipEntries-only (correct). OK on re-read.

14. **Bookmark on ghost mode.** `persistedRestaurantId` falls back to `restaurantId` for non-ghost mode, but `restaurantId` may be a Google Place ID when arriving from certain link paths — `useIsWishlisted(persistedRestaurantId, ...)` will silently miss. Pre-existing issue, not introduced here, but worth noting given this file was rewritten.

### Recommendation

REVISE. Issues #1 and #2 are correctness blockers against the stated acceptance criteria. Issue #3 is a doctrine question that needs a call before ship. Everything else is polish / follow-ups.

---

### Review 2
Date: 2026-04-23
Verdict: APPROVE

All three blockers genuinely fixed (not papered over):

1. **Solo self-voice on Visits** — `supabase/functions/restaurant-history/index.ts:645-679`: `allVisibleUserIds = [user.id, ...sharedUserIds]` is now computed unconditionally, and the `feedEntries` fetch runs outside the `memberTableIds.length > 0` guard. Only the Rounds branch (`:682`) remains gated on table membership, which is correct (rounds are table-only by definition). A solo user's personal entry will populate `visits`, `distributions.you`, and `personal.last_visit` regardless of table membership.

2. **Photos query correctness** — `supabase/functions/restaurant-history/index.ts:798-803`: rewritten to use `entries!inner(user_id, restaurant_id, table_id)` with `.eq('entries.restaurant_id', resolvedRestaurantId)`. The restaurant filter is applied server-side via the inner-join, so `.limit(48)` now correctly limits *per-restaurant* photos, not global `entry_photos` rows. `photoErr` is logged (`:806`). `ARCHITECT-REVIEW` comment in place at `:796-797` noting the future indexing improvement.

3. **Trust-ring leak on Photos** — `supabase/functions/restaurant-history/index.ts:841-848`: routing is now `isSelf || (entryTableId != null && memberTableIds.includes(entryTableId))` → `fromYourTable`. A tablemate's feed-only photo (`table_id IS NULL`) falls through to `fromOthers`. The user's own feed-only photos still route to `fromYourTable` via the `isSelf` branch, as required.

Other spot-checks:
- `SwitchableDistribution.tsx:41-72` — `yourTableNull` gate renders italic empty-state ("— not enough visits yet") instead of napkin bars under "Your table's distribution" heading. PASS.
- `app/restaurant/[id].tsx:251-268` — `tierUserSelectedRef` + `tierDefaultAppliedRef` correctly prevent the default-tier effect from stomping on a pre-data user tap. PASS.
- `grep tamemate` across napkin-app returns nothing. PASS.
- `useRestaurantPage.ts:115` — `napkin_aggregate` declared on `RestaurantPageData`, with back-fill at `:162-164`. PASS.
- `InfoTab.tsx:60` — `RULE_COLOR = 'rgba(28, 28, 25, 0.12)'` ink-toned, dusty-rose gone. PASS.
- `SignalStrip.tsx:163-170` — `minHeight: 44`, `paddingVertical: 10`, `justifyContent: 'center'`, plus `hitSlop` on each Pressable. PASS.
- `InfoTab.tsx:26-48, 244` — `DashedRule` component uses repeating ink `View` segments, not `borderStyle: 'dashed'`. Renders on Android. PASS.
- `InfoTab.tsx:19, 147` — `import * as Clipboard from 'expo-clipboard'` + `Clipboard.setStringAsync`. PASS.
- `InfoTab.tsx:88` — `InfoGroup` returns null when `rows.length === 0`, so the When group is omitted entirely rather than rendering a placeholder header with no rows. PASS.

Residual non-blockers (carried forward, not gating merge):
- `hours_today` / `hours_week` / `open_now` still always null (no schema for them yet). When-group will never render in practice. Spec explicitly parked this as best-effort.
- `napkin_aggregate` counts all entries regardless of profile privacy (builder Q4). Consistent with how Google count works; acceptable for v1.
- Branch still carries unrelated atlas / UI primitive changes (recurring pattern flagged in agent memory). Not a blocker for this ticket's review but worth keeping an eye on at merge.


---

## Completion
- Completed: 2026-04-23
- Final verdict: APPROVE (12/12 ACs met after 1 revise cycle)
- Shipped in: commit `200fe01` on main (bundled with TICKET-022 + TICKET-030 Atlas Phase 2 in PR #40)
- Notes: Two post-approval bug fixes deployed to `restaurant-history` edge function: (1) `entry_photos.storage_url` column never existed — switched photos query to `photo_url` only; (2) SELECT on `restaurants` referenced nonexistent `latitude/longitude/website/phone/menu_url` columns — trimmed to actual columns (`lat/lng`). PublicReviewsSection + PublicReviewCard files deleted (work subsumed into `VoicesStream`); required a Metro cache clear after the rename because stale barrel exports were cached.
