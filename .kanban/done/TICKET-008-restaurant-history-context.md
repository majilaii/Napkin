---
id: TICKET-008
title: "Restaurant history & context — every post remembers the last visit"
priority: high
status: in-progress
created: 2026-04-16
updated: 2026-04-16
tags: [enrichment, round-detail, entry-detail, restaurants, memory]
---

# Restaurant History & Context

## Problem

A Table accumulates taste over time — that's the whole value of being a group. But every Round and every entry is currently shown as an island. There's no "you've been here before" awareness, no comparison to last time, no sense of the Table's accumulated relationship with a place.

When Sarah posts "4.5 at Lucali," the app doesn't notice that the Table ate there six months ago and gave it a 3.8. That's the most interesting thing in the room — a half-star improvement, a shift in taste, a second-chance data point. Instead, the card just shows a score.

**The mental model is Letterboxd's "rewatch" + "your previous rating" + "films in the same franchise."** Every detail page on Letterboxd puts the work in context: when you last watched, who else liked it, what came before. Napkin's detail pages don't contextualize at all.

**Who has this problem:** every Table that's been together for more than a few weeks. Power users feel this most — their history is the point.

**Why it matters:** without restaurant history surfaces, the app has no reason to be used long-term. The accumulated data is locked away. This is also the feature that makes Napkin feel *smart* — the one that makes people say "oh, it remembers."

## Notes

### What this ticket delivers

Three surfaces of restaurant memory:

1. **"Previously here" strip** on Round detail — shows count + last-visit score for the Table at this restaurant
2. **"Previously here" strip** on Entry detail — shows count + last-visit score for *this user* at this restaurant (across all tables)
3. **Minimal restaurant screen** (`/restaurant/[id]`) — a read-only list of all Rounds + solo entries at that restaurant visible to the current user, with a table-wide average

### Concrete additions

| # | What | Where | Effort |
|---|---|---|---|
| 1 | "Previously here" banner on Round detail — "You've been here 2 times before · last: 4.2 on Oct 14" | `app/table-night-detail.tsx` | S |
| 2 | Delta indicator on Round hero — "↑ 0.3 from last visit" chip next to Final Average bubble | `app/table-night-detail.tsx` | S |
| 3 | "Previously here" banner on Entry detail — "Your 3rd visit · last: 3.8" | `app/entry-detail.tsx` | S |
| 4 | Restaurant screen (`app/restaurant/[id].tsx`) — hero photo, Table avg, list of visits | new route | M |
| 5 | "See all visits" link from both banners → restaurant screen | both detail screens | S |
| 6 | Restaurant name on detail pages becomes tappable → restaurant screen | both detail screens | S |

### Data layer

No new tables. All queries go against existing `restaurants`, `entries`, and `table_nights`.

New edge function action on an existing function (suggest adding to `table-management` or a new `restaurant-history`):

- `GET ?action=history&restaurant_id=X&table_id=Y` → returns `{ visits: [{ kind: 'round' | 'solo', id, rating, date, user_display_names }], table_average, visit_count }`
- `GET ?action=user_history&restaurant_id=X&user_id=Y` → returns `{ visits: [...], user_average, visit_count }`

Both filter on table membership for RLS safety.

### New hooks

```typescript
// hooks/restaurants/useRestaurantHistory.ts
useTableRestaurantHistory(restaurantId, tableId) → { visits, tableAverage, visitCount, lastVisit }
useUserRestaurantHistory(restaurantId, userId) → { visits, userAverage, visitCount, lastVisit }
```

Add `staleTime: 1000 * 60 * 5` consistent with other queries. Add `queryKeys.restaurant.history(...)` and `queryKeys.restaurant.userHistory(...)`.

### UX decisions to lock in during product spec

- **"Previously here" banner styling** — subtle, uses `surfaceContainerLow` background with an inset italic line: "You've been here before · Oct 14, 2025 · 4.2." Keep it one line. Tappable chevron affordance on the right. Positioned just below the metadata line on each detail page (above Final Average / overall rating bubble).
- **Delta indicator on Round hero** — small amber chip `↑ 0.3` if current > previous, olive `↓ 0.2` if worse, muted `— Same` if within 0.1. Only shown when there's at least one previous visit.
- **Hide if no history** — if this is the first visit, no banner. Don't render "First visit!" messaging — that's feature-worthy in its own way but not here.
- **Restaurant screen scope** — this is NOT a social restaurant profile. It's a private, table-scoped memory page. No reviews from strangers, no maps integration, no "popular at this place." Just: hero photo, address, table-wide average, chronological list of visits (Rounds + solo entries), tap any to navigate into its detail.
- **Cross-table privacy** — the Entry detail "Previously here" only surfaces visits the current user was part of. If Jacky and Sarah ate at Lucali in one Table, and Jacky ate at Lucali in another Table with different people, the Entry detail in the first Table only shows Jacky's visits that were in that Table (not the other one). This keeps Table privacy absolute.

Correction — revisit decision: actually, for the *Entry* detail "Previously here" banner, it's one user's personal history. So it should span all their visits regardless of Table. Decide during product spec. Leaning: show cross-Table for Entry detail (it's "your" history), keep Round detail Table-scoped only.

### Out of scope

- ❌ Restaurant leaderboards ("your top 10 restaurants this year")
- ❌ Trends / charts (score over time) — future, TICKET-017 maybe
- ❌ Public restaurant pages / reviews from non-Table users
- ❌ Maps integration
- ❌ "Popular dishes at this restaurant" aggregates across tables (privacy question to solve separately)
- ❌ Editing restaurant metadata from the restaurant screen
- ❌ Photos gallery on restaurant screen (v2 — use existing hero + table-night photo pools)

### Risks

- **Two Round visits, same night, different Tables** — edge case if a user is in two Tables and hosts a Round in each at the same restaurant. Counts should be scoped to the Table context properly; test this in spec.
- **Restaurants table may have duplicates** — Google Places sometimes returns slightly different `place_id` for the same venue. Deduplication is already an existing issue; not this ticket's job but the banner accuracy will inherit whatever state the data is in. Note for spec.
- **"Last visit" ordering when dates are equal** — tiebreaker should be `created_at` desc. Specify in architecture.
- **Cross-Table privacy on Entry detail** — architectural decision above needs to be locked before implementation. If we go cross-Table, the query can't filter by `table_id` — must use user-scoped RLS which is fine.

### Files touched (anticipated)

- **New**: `supabase/functions/restaurant-history/index.ts` (or action added to `table-management`), `hooks/restaurants/useRestaurantHistory.ts`, `app/restaurant/[id].tsx`, `components/restaurants/PreviouslyHereBanner.tsx`, `components/restaurants/DeltaChip.tsx`, `components/restaurants/VisitListRow.tsx`
- **Modified**: `app/table-night-detail.tsx`, `app/entry-detail.tsx`, `lib/queryKeys.ts`

### Dependencies

- None hard. Independent of TICKET-007. Can ship before or after.
- Weak synergy: if TICKET-007 (reactions/replies) ships first, the restaurant screen's visit rows can show reaction counts.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories
-

### Acceptance Criteria
- [ ]

### UX Decisions
-

### Out of Scope
-

### Open Questions
-

---

## Technical Design
<!-- Filled by architect agent -->

### Approach


### Architecture Decisions
-

### File Changes
-

### Implementation Order
1.

### Risks
-

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New**
- `supabase/functions/restaurant-history/index.ts` — Edge function with two GET actions. `table_history` returns the Table's accumulated memory at a restaurant (revealed Rounds + solo entries) with computed group averages, aggregate Table average, and last-visit summary. `user_history` returns the signed-in viewer's cross-Table personal history at a restaurant. Both verify auth; `table_history` additionally verifies `table_members` before returning anything.
- `napkin-app/hooks/restaurants/useRestaurantHistory.ts` — `useTableRestaurantHistory(restaurantId, tableId, excludeNightId?)` and `useUserRestaurantHistory(restaurantId, userId, excludeEntryId?)`. 5-minute staleTime. Exports `Visit`, `TableRestaurantHistory`, `UserRestaurantHistory`, `RestaurantBasic` types.
- `napkin-app/components/restaurants/PreviouslyHereBanner.tsx` — One-line memory banner. `voice='user'` → "You've been here X times before"; `voice='table'` → "The table has been here X times before." Subline: "last: Oct 14, 2025 · 4.2". Hidden when `visitCount <= 0`. Uses `palette.surfaceContainerLow` and italic Newsreader copy, terminating chevron when tappable.
- `napkin-app/components/restaurants/DeltaChip.tsx` — Small delta indicator for the Round hero. `|Δ| < 0.1` → muted "— Same"; Δ > 0 → amber `↑ 0.3 from last visit`; Δ < 0 → olive `↓ 0.2 from last visit`. Renders nothing if `previous` is null.
- `napkin-app/components/restaurants/VisitListRow.tsx` — Restaurant-screen row: kind label + date + (names for Rounds) + rating pill + chevron.
- `napkin-app/components/restaurants/index.ts` — Barrel export.
- `napkin-app/app/restaurant/[id].tsx` — Table-scoped restaurant memory screen. Accepts `id` + optional `tableId` query param. Hero photo (if cached), restaurant name/address, Table average bubble, chronological list of `VisitListRow`s with tap-to-navigate to the underlying Round or entry. Handles missing `tableId` with a quiet fallback message.

**Modified**
- `napkin-app/lib/queryKeys.ts` — Added `restaurants.tableHistory(...)` and `restaurants.userHistory(...)` key builders (supporting optional exclusion params).
- `napkin-app/app/table-night-detail.tsx` — Pulled in `useTableRestaurantHistory` (excluding current `nightId`). Restaurant name in the header is now a `Pressable` that navigates to `/restaurant/[id]?tableId=...`. Added `PreviouslyHereBanner` (table-voiced) immediately below the header, above the Final Average bubble. Added `DeltaChip` beside the summary sentence comparing `overallAvg` against `restaurantHistory.last_visit?.rating`.
- `napkin-app/app/entry-detail.tsx` — Pulled in `useUserRestaurantHistory` (viewer-scoped, excluding current entry). Added `table_id` to the `EntryDetail` type and to the entry-fetch SELECT. Restaurant name + address are now wrapped in a `Pressable` that navigates to `/restaurant/[id]?tableId=...` (falling back to no-tableId when the entry isn't tied to a Table). Added viewer-voiced `PreviouslyHereBanner` immediately above the "Part of a Round" banner.

### Tests
- Not yet run. Edge function should be deployed and tested with curl against a Table with ≥ 2 visits at the same restaurant. Suggested manual checks:
  - Open a Round at a known-repeat restaurant → "Previously here" banner renders with correct count; `DeltaChip` shows delta vs. prior group average.
  - Open a solo entry at a restaurant the viewer has visited before (cross-Table) → banner renders viewer-voiced.
  - Tap restaurant name on Round → lands on `/restaurant/[id]` with the Table's full visit list.
  - Tap restaurant name on Entry detail → same.
  - Open a Round at a first-time restaurant → neither banner nor delta chip renders.

### Builder Questions
- Entry-detail banner currently uses viewer-scoped history (answering: "have *I* been here before?"). The ticket notes asked to decide between viewer-scoped and author-scoped. This build ships viewer-scoped because it matches the Letterboxd mental model. Revisit if designers prefer author-scoped.
- Restaurant screen's tableId is required for accurate scoping. When opened from a non-Table entry (private solo), no tableId is passed and the screen shows a quiet fallback. We may want a personal-memory variant later (user-scoped list across all Tables).

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date:
Verdict:
Score: X PASS / X WARN / X FAIL
```

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: YYYY-MM-DD
- Final verdict:
- Notes:
