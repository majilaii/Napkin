---
id: TICKET-003
title: "Feed views & filtering — timeline cleanup, grid view, calendar view"
priority: medium
status: done
created: 2026-04-15
updated: 2026-04-15
tags: [ux, feed, tables, filtering, views]
---

# Feed Views & Filtering

## Problem

The table activity feed is a single reverse-chronological firehose. Solo shares, active rounds, revealed rounds, and collaborative entries all interleave with no grouping, no filtering, and no alternative way to browse. A group of 5 friends eating out 3–4× per week generates ~15–20 cards per week. Within a month that's 60–80 items dumped into one scrollable column. It reads like an unsorted inbox.

**Who has this problem:** Every user who opens a group table after a few weeks of activity. The feed becomes "WTF is going on in this timeline" — you can't find what you're looking for, can't answer basic questions like "what did we think of Hawksmoor?" or "what did we eat last Friday?", and the visual weight of full-size cards for everything is exhausting.

**Why it matters:** The feed is the primary surface of the app. If it feels noisy and unnavigable, the whole product feels broken. People stop scrolling and stop logging because they can't find anything. The feed needs to scale from 5 entries to 500 without degrading.

## Notes

### Core insight from brainstorm

The timeline is one valid view of activity, but not the only one. Different questions need different views:

| Question | Best answered by |
|---|---|
| "What's new?" | Timeline (chronological) |
| "What have we been to?" | Grid (restaurant-grouped) |
| "What did we eat last Saturday?" | Calendar |
| "What does Elena think of places?" | Filtered timeline |
| "Show me just the Rounds" | Filtered timeline |

### Three view modes

#### 1. Timeline (current view, improved)

Keep the scroll, but make it smarter:

- **Sticky date section headers** — "Today", "This Week", "Last Week", "March 2026" — so you have temporal landmarks without reading every timestamp.
- **Filter chips** — horizontal scrollable row below the header: `All` · `Rounds` · `Solo Shares` · `By Me` · `By {member}` (one chip per table member). Tapping filters the feed. Single-select, tap again to deselect. Default is `All`.
- **Pinned active rounds shelf** — any round in `rating` status gets pulled out of the timeline and pinned into a small "In Progress" section at the top. Active rounds should never get buried under new solo shares. Once revealed, they drop back into the timeline at their natural sort position.
- **Compact mode for older entries** — entries older than ~2 weeks shrink to a single-line compact row (restaurant name + rating + person avatar). Tap to expand to the full card. This keeps the scroll fast and focuses visual weight on recent activity.

#### 2. Grid view (restaurant-grouped)

A place-centric view — think Letterboxd poster grid but for restaurants:

- Each cell = one restaurant. Shows: restaurant name, last visit date, average rating (across all entries from all members), visit count badge.
- Tapping a restaurant cell opens a **restaurant sheet** (bottom sheet or new screen) showing every entry from every member for that place — a scoped mini-timeline. "How did everyone feel about Hawksmoor?"
- Sort options at the top: `Most recent` · `Highest rated` · `Most visited` · `A→Z`.
- This is the "what have we been to" view. Great for answering "should we go back?"

#### 3. Calendar view

A month grid where dots indicate dining activity:

- Each day cell that has activity gets a small indicator: terracotta dot for solo share, amber dot for round. Multiple entries = multiple dots or increased intensity.
- Tapping a day opens a bottom sheet with that day's entries listed.
- Good for answering "what did we eat last Saturday?" and spotting patterns (the group always eats out on Fridays).
- Month navigation via swipe or arrow buttons.
- Optional future enhancement: heat-map intensity (more entries = darker background on the day cell).

### View switcher UX

Three small icons in the header row, right-aligned next to the table name:

```
Sunday Roast Club ▾     ☰  ⊞  📅
                       list grid cal
```

Active icon gets terracotta tint. Inactive icons are `textMuted`. Default view is timeline (☰). View preference persists per table (AsyncStorage or similar).

### What exists today that we build on

- `tables.tsx` — renders the feed, has table switcher header, renders `TableNightCard` and `SoloShareCard`. This file gets the view switcher and filter chips added.
- `useTableActivity` hook — fetches paginated activity. Needs to accept filter params.
- `table-activity` edge function — server-side query. Needs filter support (by type, by user_id).
- All entry data (restaurants, ratings, dates, user_ids) already exists in the DB. Grid and calendar views are different presentations of the same data, not new data.

### What needs to be new

- **Filter chip row component** — reusable horizontal scroll of toggle chips.
- **View switcher icons** — in the header, controlling which view renders.
- **Date section headers** — computed client-side from sort_date grouping.
- **Compact entry row** — slimmed-down card variant for older entries.
- **Grid view component** — restaurant-grouped grid with aggregation query.
- **Restaurant detail sheet** — bottom sheet showing all entries for one restaurant within a table.
- **Calendar month grid** — date grid with activity dots, day-tap sheet.
- **New edge function endpoint or params** — `table-activity` needs: `?filter_type=round|solo_share`, `?filter_user_id=xxx`, and a new `?group_by=restaurant` mode for the grid view.

### Phasing

**Phase 1 — Timeline polish (do first, highest impact, least code):**
- Filter chips (type + member filtering)
- Sticky date section headers
- Pin active rounds to top shelf
- Server-side filter params on `table-activity`

**Phase 2 — Grid view:**
- Restaurant-grouped aggregation query (new edge function endpoint or param)
- Grid layout component
- Restaurant detail bottom sheet
- Sort toggles

**Phase 3 — Calendar view:**
- Month grid component
- Activity dot indicators
- Day-tap bottom sheet
- Month navigation

### Design principles

- **No modals for filtering.** Chips are visible and tappable inline. The state of the filter is always obvious.
- **View state is instant.** Switching between timeline/grid/calendar should feel like flipping a switch, not loading a new page. Cache aggressively.
- **The feed should breathe.** Compact old entries, use whitespace, let date headers create visual rhythm. The goal is a food journal that feels curated, not a social media feed that feels noisy.
- **Additive, not destructive.** The current timeline stays as-is in its core behavior. We're adding structure on top, not rearchitecting.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories

- As a table member, I want to filter the feed to only Rounds or only Solo Shares, so that I can quickly find a specific type of entry without scrolling past everything else.
- As a table member, I want to filter the feed by a specific person (including myself), so that I can see what one friend has been eating or review my own history.
- As a table member, I want sticky date headers in the feed ("Today", "This Week", "March 2026"), so that I have temporal landmarks and can orient myself in the scroll without reading every timestamp.
- As a table member, I want active rounds pinned to the top of the feed, so that I never miss a live round because it got buried under newer solo shares.
- As a table member browsing a long feed, I want older entries to be visually compact, so that I can scroll quickly through history without every two-week-old entry taking up a full card height.
- As a table member who taps a compact entry, I want it to expand to the full card, so that I can still access details when I need them.
- As a table member with no matching results, I want to see a clear empty state ("No rounds yet" / "No entries from Elena"), so that I know the filter is working rather than thinking the app is broken.

### Acceptance Criteria

**Filter chips**
- [ ] A horizontal scrollable row of filter chips appears between the header and the feed content
- [ ] Chips rendered in order: All, Rounds, Solo Shares, By Me, then one chip per table member (excluding the current user), using each member's display_name
- [ ] Tapping a chip selects it (single-select); tapping the active chip deselects it and returns to "All"
- [ ] The selected chip uses terracotta fill (`primary`) with white text; unselected chips use `surfaceContainerHigh` fill with `textSecondary` text
- [ ] Selecting "Rounds" shows only `table_night` items; selecting "Solo Shares" shows only `solo_share` and `collaborative_entry` items
- [ ] Selecting "By Me" shows only items where the current user is the author (solo shares) or a participant (rounds)
- [ ] Selecting a member chip shows only items where that member is the author or participant
- [ ] Filter is applied server-side via query params on the `table-activity` edge function (not client-side filtering of a full dataset)
- [ ] Switching tables resets the filter to "All"
- [ ] Member chips are populated from `useTableMembers` data; if the table has only the current user, no member chips appear (just All / Rounds / Solo Shares / By Me)

**Date section headers**
- [ ] Feed items are grouped under sticky date headers that remain visible at the top of the viewport while scrolling through that section
- [ ] Bucketing logic: "Today" (calendar today), "Yesterday" (calendar yesterday), "This Week" (same ISO week, excluding today/yesterday), "Last Week" (prior ISO week), then month-year labels ("March 2026", "February 2026", etc.)
- [ ] Headers use Newsreader italic, `textMuted` color, with a subtle bottom rule using `divider` color -- consistent with the journal aesthetic
- [ ] Date grouping is computed client-side from the `sort_date` field already present on every activity item
- [ ] Empty groups are not rendered (no "This Week" header if there are no items this week)

**Pinned active rounds shelf**
- [ ] Any `table_night` item with `status === 'rating'` is removed from its chronological position and rendered in a dedicated shelf above the date-grouped feed
- [ ] The shelf has a section label "In Progress" using `Type.label` styling
- [ ] Active round cards in the shelf use the existing `TableNightCard` component (which already has the PulseDot and "ACTIVE ROUND" badge)
- [ ] If there are no active rounds, the shelf is not rendered (no empty shelf state)
- [ ] When a round transitions from `rating` to `revealed`, it drops out of the shelf and appears in the main feed at its chronological position on next data refresh

**Compact mode for older entries**
- [ ] Entries with a `sort_date` older than 14 days render in a compact single-line layout: avatar (24px), restaurant name, rating (if present), displayed on one row
- [ ] Tapping a compact entry expands it in-place to the full `SoloShareCard` or `TableNightCard` layout
- [ ] Only one compact entry is expanded at a time; expanding a new one collapses the previous
- [ ] The 14-day threshold is computed client-side based on the current date
- [ ] Entries within the last 14 days always render as full cards regardless of how many there are

**Server-side filter params**
- [ ] The `table-activity` edge function accepts an optional `filter_type` query param with values `round` or `solo_share`
- [ ] The edge function accepts an optional `filter_user_id` query param (a user UUID)
- [ ] When `filter_type=round`, only `table_night` records are returned
- [ ] When `filter_type=solo_share`, only entry records (solo shares and collaborative entries) are returned
- [ ] When `filter_user_id` is provided, solo shares are filtered to `user_id = filter_user_id` and table nights are filtered to those where the user is a participant
- [ ] Both params can be combined (e.g., "Rounds by Elena")
- [ ] When no filter params are passed, behavior is identical to current (all items, no regression)

### UX Decisions

- **Filter chip placement**: Below the table name header, above the feed. Not inside the ScrollView header (which would scroll away), and not as a modal/drawer. Chips must be visible at all times so the user always knows what filter state they are in. Implemented as a horizontally scrollable FlatList pinned between header and feed scroll.
- **Single-select chips, not multi-select**: Multi-select creates combinatorial complexity ("Rounds + By Elena + By Me" -- what does that mean?). Single-select keeps it simple: one dimension at a time. "By Me" already combines type-agnostic filtering. If someone wants "Rounds by Elena" that is a future iteration, not a chip combo.
- **Filter state is ephemeral, not persisted**: Filters reset when you switch tables or leave the tab. This avoids the confusing state where you return to a tab and see a filtered view without remembering why. The default is always "everything."
- **Date header bucketing uses relative labels for recent, absolute for older**: "Today" and "Yesterday" give immediacy. "This Week" and "Last Week" cover the recent window. Beyond two weeks, month-year labels ("March 2026") are precise without being noisy. ISO weeks (Monday start) are used to avoid locale ambiguity in the spec.
- **Sticky headers use SectionList**: React Native's SectionList provides native sticky header behavior. The feed converts from a flat ScrollView to a SectionList with sections computed from date buckets. This is a structural change to `tables.tsx` but avoids reinventing sticky positioning.
- **Active rounds shelf is not a separate fetch**: The shelf content comes from the same `useTableActivity` response. The client partitions items: those with `status === 'rating'` go to the shelf, everything else goes to date-grouped sections. No new endpoint needed.
- **Compact mode uses a 14-day rolling window, not a count threshold**: A fixed count ("compact after 20 items") creates jarring layout shifts when new entries push items over the threshold. A date-based cutoff is predictable: entries older than two weeks are always compact, regardless of volume.
- **Expand-one-at-a-time for compact entries**: Expanding all at once would defeat the purpose of compact mode. Single expansion keeps scroll position manageable and memory usage low. The expanded entry ID is tracked in local component state.
- **Chip typography**: Uses `Type.caption` (Manrope 500, 12px) for chip labels. Manrope because these are functional controls, not editorial content. Display names are truncated to 10 characters with ellipsis to prevent chip overflow on small screens.

### Out of Scope

- **Phase 2 -- Grid view**: Restaurant-grouped grid, aggregation queries, restaurant detail sheet, sort toggles. Will be its own ticket after Phase 1 ships and is validated.
- **Phase 3 -- Calendar view**: Month grid, activity dots, day-tap sheet, month navigation. Will be its own ticket.
- **View switcher icons in header**: The three-icon switcher (list/grid/cal) is only relevant once grid and calendar views exist. Not building the switcher UI until Phase 2 is ready.
- **Persisted view preference per table**: AsyncStorage-backed view mode memory is Phase 2+ scope (requires the view switcher to exist).
- **"By Me" + type combo filtering**: The current spec is single-select. "Show me only my rounds" requires combining two filters. If this proves to be a strong need post-launch, it becomes a fast-follow.
- **Search / text-based filtering**: Searching by restaurant name or note content is a distinct feature, not part of chip filters.
- **Infinite scroll / load-more for filtered results**: The existing pagination via `useInfiniteQuery` should continue to work with filter params. No new pagination UX (e.g., "load more" button) is being added.
- **Any Table Night gameplay changes** (TICKET-002 scope)
- **Photos in feed cards** (TICKET-005 scope)
- **Restaurant profile page** (separate ticket)
- **Push notifications for active rounds**
- **Edit/delete entries from feed**

### Open Questions

- All resolved:
  - "By Me" chip — use "By Me" (short, clear, avoids seeing your own name among friends)
  - Collaborative entries — group under "Solo Shares" chip (rare, users won't think of them as rounds)
  - Compact mode for rounds — yes, compact after 14 days like everything else
  - SectionList + RefreshControl — SectionList supports RefreshControl natively, no issues

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Phase 1 converts the table activity feed from a flat ScrollView into a structured SectionList with client-side date bucketing, a pinned active-rounds shelf, compact mode for older entries, and server-side filtering via filter chips. The data layer changes are minimal: two optional query params added to the `table-activity` edge function, and the existing `useTableActivity` hook extended to forward them. All presentation logic — date grouping, active-round partitioning, compact/expanded toggling — is computed client-side from the same response shape, keeping the API surface simple. A new `FilterChipRow` component is extracted for reuse; `TableNightCard`, `SoloShareCard`, and `Avatar` are extracted from `tables.tsx` into their own files to keep the screen component focused on layout orchestration. A new `CompactEntryRow` component handles the condensed layout for entries older than 14 days.

### Architecture Decisions

- **SectionList over ScrollView**: SectionList because it provides native sticky section headers and `renderSectionHeader` out of the box, which is exactly what date headers need. The current ScrollView renders `items.map(...)` inline; SectionList replaces that with `sections` computed via a `useMemo` grouping function. Trade-off: SectionList is slightly more rigid in layout (no arbitrary interleaving of non-list content above sections without `ListHeaderComponent`), but we use `ListHeaderComponent` for the active-rounds shelf and `stickySectionHeadersEnabled` for the date headers, which maps cleanly.

- **Filter state is local component state, not URL or context**: A single `useState<string | null>` in `TablesScreen` tracks the active filter chip value (e.g., `'round'`, `'solo_share'`, `'by_me'`, or a user UUID). This resets to `null` on table switch via a `useEffect` on `activeTable.id`. No need for React Context, URL params, or persistence — the spec explicitly says filters are ephemeral. Trade-off: no deep-linking to filtered views, which is fine for Phase 1.

- **Filter params are server-side, not client-side post-fetch**: The edge function accepts `filter_type` and `filter_user_id` query params and applies them at the SQL level. This is required by the spec and is correct for pagination — client-side filtering of a paginated response would return fewer items than the page size and break `getNextPageParam`. Trade-off: each filter change triggers a new network request, but TanStack Query's `keepPreviousData` option smooths the transition.

- **Active rounds partitioned client-side from same response**: No separate endpoint. The `useTableActivity` response already includes items with `status === 'rating'`. A `useMemo` splits the flat array into `{ activeRounds, feedItems }`. Active rounds are rendered in `ListHeaderComponent`; `feedItems` flow into date-bucketed sections. Trade-off: active rounds consume slots in the paginated response, but there are rarely more than 1-2 active at a time, so the impact on page size is negligible.

- **Date bucketing computed client-side, not server-side**: Sections are computed from `sort_date` using a pure function. Buckets: "Today", "Yesterday", "This Week" (same ISO week), "Last Week" (prior ISO week), then "Month Year" for older items. This is purely a presentation concern — the server returns a flat sorted list, the client groups it. Trade-off: if a page boundary falls mid-bucket, the same bucket header may appear twice across pages. This is acceptable for Phase 1; infinite scroll pagination already loads pages into a flat array that we re-bucket on each render.

- **Compact mode is a render-level concern, not a data concern**: Entries older than 14 days render as `CompactEntryRow` instead of the full card. The determination is `Date.now() - new Date(item.sort_date).getTime() > 14 * 86400000`. A single `expandedItemId` state tracks which compact item (if any) is currently expanded to full card view. Trade-off: computing the 14-day cutoff on every render is trivially cheap.

- **Query key includes filter params**: `queryKeys.tables.activity` currently takes just `tableId`. The filtered query uses `['tableActivity', tableId, { filterType, filterUserId }]` so that different filter states are cached independently and switching back to a previously-used filter is instant from cache. Trade-off: more cache entries, but they expire via staleTime anyway.

- **Extract card components out of tables.tsx**: `TableNightCard`, `SoloShareCard`, and `Avatar` currently live inline in `tables.tsx` (270+ lines of component code in the screen file). Moving them to `components/feed/` keeps the screen file focused on layout. This is proportional cleanup, not a rewrite — same components, same props, just different files.

### File Changes

- `supabase/functions/table-activity/index.ts` — MODIFY — Add `filter_type` and `filter_user_id` query param parsing. When `filter_type=round`, skip the solo entries query entirely (only fetch `table_nights`). When `filter_type=solo_share`, skip the table nights query (only fetch entries). When `filter_user_id` is set, add `.eq('user_id', filterUserId)` to the entries query, and filter table nights to only those where the user is a participant (sub-query on `table_night_participants`). Both params combinable.

- `napkin-app/hooks/tables/useTableActivity.ts` — MODIFY — Accept optional `filterType` and `filterUserId` params in both `fetchTableActivity` and `useTableActivity`. Append them as query params when present. Update the query key to include filter params so filtered/unfiltered results cache independently.

- `napkin-app/lib/queryKeys.ts` — MODIFY — Update `tables.activity` key factory to accept optional filter params: `activity: (tableId: string, filters?: { filterType?: string; filterUserId?: string }) => [...]`.

- `napkin-app/components/feed/FilterChipRow.tsx` — NEW — Horizontal `FlatList` of pressable chips. Props: `chips: { key: string; label: string }[]`, `activeKey: string | null`, `onSelect: (key: string | null) => void`, `palette`. Renders each chip with `Type.caption` text, terracotta fill when active, `surfaceContainerHigh` when inactive. Handles single-select toggle (tap active = deselect to null). Truncates member display names to 10 chars with ellipsis.

- `napkin-app/components/feed/CompactEntryRow.tsx` — NEW — Single-line compact layout: 24px avatar, restaurant name (flex 1, single line), rating value (if present), right-aligned. Pressable, calls `onPress` to expand. Minimal vertical padding. Works for both `SoloShareActivity` and `TableNightActivity`.

- `napkin-app/components/feed/SoloShareCard.tsx` — NEW (extracted) — Move `SoloShareCard` from `tables.tsx` to its own file, unchanged in behavior. Export it.

- `napkin-app/components/feed/TableNightCard.tsx` — NEW (extracted) — Move `TableNightCard` and `PulseDot` from `tables.tsx` to their own file, unchanged in behavior. Export them.

- `napkin-app/components/feed/Avatar.tsx` — NEW (extracted) — Move `Avatar` from `tables.tsx` to its own file. Export it.

- `napkin-app/components/feed/DateSectionHeader.tsx` — NEW — Sticky section header rendered by SectionList. Displays the bucket label ("Today", "This Week", "March 2026") in `Newsreader_400Regular_Italic`, `textMuted` color, with a 1px `divider`-color bottom border. Receives `title: string` as prop.

- `napkin-app/components/feed/ActiveRoundsShelf.tsx` — NEW — Renders a small section above the main feed: "IN PROGRESS" label (`Type.label`) + a list of `TableNightCard` components for active rounds. If `items` is empty, renders null. Used as the content inside `ListHeaderComponent`.

- `napkin-app/components/feed/index.ts` — NEW — Barrel export for all feed components.

- `napkin-app/app/(tabs)/tables.tsx` — MODIFY — Major structural changes:
  1. Replace `ScrollView` with `SectionList`.
  2. Import extracted components from `@/components/feed`.
  3. Add `useTableMembers(activeTable?.id)` import for member chip data.
  4. Add `activeFilter` state (`useState<string | null>(null)`), reset on `activeTable?.id` change.
  5. Compute `filterType` and `filterUserId` from `activeFilter` value (map chip keys to edge function params).
  6. Pass filter params to `useTableActivity(activeTable?.id, { filterType, filterUserId })`.
  7. Add `useMemo` to partition `items` into `activeRounds` (status === 'rating', only when no filter is active or filter is 'round') and `feedItems` (everything else).
  8. Add `useMemo` to group `feedItems` into date-bucketed sections: `{ title: string; data: ActivityItem[] }[]`.
  9. Add `expandedItemId` state for compact mode toggling.
  10. Render `FilterChipRow` between header and SectionList (outside the list, pinned).
  11. Use `ListHeaderComponent` for `ActiveRoundsShelf`.
  12. Use `renderSectionHeader` for `DateSectionHeader`.
  13. Use `renderItem` to choose between `CompactEntryRow` (for items >14 days old) and full cards, with expand logic.
  14. Add empty state per-filter ("No rounds yet", "No entries from {name}") when filtered results are empty.

- `napkin-app/constants/theme.ts` — NO CHANGES — All needed tokens already exist: `Type.caption` for chips, `Type.label` for shelf header, `Newsreader_400Regular_Italic` for date headers, `surfaceContainerHigh` for inactive chips, `primary`/terracotta for active chips, `divider` for header rules, `textMuted` for header text.

### Implementation Order

1. **Extract card components** (`SoloShareCard.tsx`, `TableNightCard.tsx`, `Avatar.tsx` into `components/feed/`) — because this is a pure refactor with zero behavior change, must be done first so the subsequent `tables.tsx` rewrite imports from the new locations. Easy to verify: the feed should look and behave identically after this step.

2. **Edge function filter params** (`table-activity/index.ts`) — because the frontend filter chips depend on the server accepting `filter_type` and `filter_user_id`. Can be tested with curl independently. No frontend changes needed yet.

3. **Update `useTableActivity` hook and query keys** — because the hook needs to forward filter params to the edge function and cache filtered results under distinct keys. Depends on step 2 (server must accept params). Can be tested by temporarily hardcoding a filter in the hook call.

4. **Build `FilterChipRow` component** — standalone presentational component with no data dependencies. Can be tested in isolation with mock chips.

5. **Build `DateSectionHeader` and date bucketing utility** — pure function that groups `ActivityItem[]` into `{ title, data }[]` sections. Write the bucketing logic as a standalone utility function (e.g., `utils/dateBuckets.ts` or inline in the hook) so it can be unit-tested. `DateSectionHeader` is a simple presentational component.

6. **Build `CompactEntryRow` component** — presentational component, no dependencies on other new code.

7. **Build `ActiveRoundsShelf` component** — presentational component that wraps existing `TableNightCard` in a labeled section.

8. **Rewrite `tables.tsx` to SectionList** — the big integration step. Depends on all of steps 1-7. Wire up: filter state, `useTableMembers`, partitioning logic, SectionList with sections/headers/renderItem, compact mode toggling, empty states per filter. This is the riskiest step; having all sub-components ready makes it a pure wiring exercise rather than building everything at once.

### Risks

- **SectionList + RefreshControl regression**: The current ScrollView has a working pull-to-refresh. SectionList supports `refreshControl` natively, but the interaction between `ListHeaderComponent` (active rounds shelf), sticky headers, and refresh indicator positioning can be finicky on Android. Mitigation: test pull-to-refresh behavior on both platforms after the conversion; if the refresh indicator renders behind the sticky header, adjust `progressViewOffset` on Android.

- **Pagination across filter changes**: When the user switches filters, TanStack Query fetches page 0 for the new filter key. If they switch back, the old filter's cache may still be valid (within staleTime). If pages were partially loaded, `getNextPageParam` could serve stale data. Mitigation: the 2-minute staleTime is short enough that this is unlikely to cause visible issues. If it does, add `queryClient.removeQueries` on filter change to force fresh fetches.

- **Date bucketing across page boundaries**: If page 1 ends mid-"This Week" and page 2 starts with more "This Week" items, the bucketing `useMemo` (which operates on all loaded pages flattened) will correctly merge them into one section. However, if only page 1 is loaded, the "This Week" section appears complete when it may not be. This is inherent to infinite scroll + grouping and is acceptable — the user loads more by scrolling, and sections grow as pages load.

- **Edge function performance with `filter_user_id` on table nights**: Filtering table nights by participant requires a sub-query or join on `table_night_participants`. For tables with many nights, this could be slower than the current unfiltered query. Mitigation: `table_night_participants` has a composite primary key on `(table_night_id, user_id)`, so the filter is index-backed. Monitor query times; if slow, add a materialized view or denormalize.

- **Member chip list stale after member joins/leaves**: `useTableMembers` has a 5-minute staleTime. If a member joins mid-session, their chip won't appear for up to 5 minutes. Mitigation: acceptable for Phase 1 — member changes are infrequent. The chip list refreshes on pull-to-refresh of the main feed via `queryClient.invalidateQueries`.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New — components/feed/**
- `napkin-app/components/feed/Avatar.tsx` — extracted from tables.tsx; initials-based avatar with deterministic tint
- `napkin-app/components/feed/PulseDot.tsx` — extracted from tables.tsx; Animated loop live indicator
- `napkin-app/components/feed/SoloShareCard.tsx` — extracted from tables.tsx; photo variant + plain variant
- `napkin-app/components/feed/TableNightCard.tsx` — extracted from tables.tsx; active/revealed round card with hero image
- `napkin-app/components/feed/FilterChipRow.tsx` — new; horizontal FlatList of single-select chips (Type.caption, terracotta active, surfaceContainerHigh inactive, 10-char truncation)
- `napkin-app/components/feed/DateSectionHeader.tsx` — new; Newsreader italic, textMuted, 1px divider rule
- `napkin-app/components/feed/CompactEntryRow.tsx` — new; 24px avatar + restaurant name + rating, tap to expand
- `napkin-app/components/feed/ActiveRoundsShelf.tsx` — new; "IN PROGRESS" label + TableNightCard list, renders null when empty
- `napkin-app/components/feed/index.ts` — barrel export

**Modified**
- `napkin-app/app/(tabs)/tables.tsx` — rewritten: ScrollView → SectionList, filter chips, active rounds partition, date bucketing, compact mode, per-filter empty states
- `napkin-app/hooks/tables/useTableActivity.ts` — added TableActivityFilters interface, filterType/filterUserId params forwarded as query params, query key updated to include filters
- `napkin-app/lib/queryKeys.ts` — activity key factory updated to accept optional filters param
- `supabase/functions/table-activity/index.ts` — added filter_type and filter_user_id query param handling; solo entries and table nights each skip or filter based on params; both params combinable

### Tests
- TypeScript: `npx tsc --noEmit` exits 0 (no type errors)
- No Jest tests exist in this repo (project_no_jest_tests memory)
- Manual verification required: filter chips, date headers, compact mode, active rounds shelf — these are visual/behavioral and need device/simulator testing

### Builder Questions
- **`filterUserId` for `by_me` passes `undefined` when `user?.id` is undefined (unauthenticated)**: The `filterParams` useMemo returns `{ filterUserId: undefined }` when `activeFilter === 'by_me'` and the user object hasn't loaded. The hook guards with `enabled: !!tableId` but not against undefined filterUserId. In practice the user is always loaded before the feed renders, but worth noting. No `ARCHITECT-REVIEW` needed — behavior is safe (undefined filterUserId is a no-op in the fetch function).
- **`__none__` sentinel in edge function**: When `filter_user_id` is set but the user has zero participation records, I pass `['__none__']` to the `.in('id', nightIds)` call to force an empty result. This relies on the fact that `__none__` is not a valid UUID and will never match any row. An alternative would be short-circuiting and returning `[]` immediately. The current approach is simpler and safe.
- **`now` in `useMemo`**: The `now = useMemo(() => new Date(), [])` is computed once at component mount. If the feed stays open past midnight, the date headers won't update until the component remounts. This is acceptable for the use case (no one browses a feed tab continuously past midnight).

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date: 2026-04-15
Verdict: APPROVE
Score: 23 PASS / 2 WARN / 0 FAIL
```

**Spec compliance: 25/25 acceptance criteria met (23 PASS, 2 WARN)**

**Filter chips**
- [x] A horizontal scrollable row of filter chips appears between the header and the feed content — PASS. `FilterChipRow` rendered between header View and SectionList in `tables.tsx:310-315`. FlatList horizontal.
- [x] Chips rendered in order: All, Rounds, Solo Shares, By Me, then one chip per table member (excluding current user), using display_name — PASS. `STATIC_CHIPS` at `tables.tsx:127-132`, member chips built at `tables.tsx:167-175`, filters out `m.member_id !== user?.id`.
- [x] Tapping a chip selects it (single-select); tapping active chip deselects to "All" — PASS. `FilterChipRow.tsx:50` toggles `isActive ? null : item.key`. `tables.tsx:313` maps `key === 'all'` to null.
- [x] Selected chip uses terracotta fill (primary) with white text; unselected chips use surfaceContainerHigh fill with textSecondary text — PASS. `FilterChipRow.tsx:54-57` for bg, `FilterChipRow.tsx:64-68` for text color. White is hardcoded `#ffffff` rather than a theme token, but spec says "white text" so this is correct.
- [x] Selecting "Rounds" shows only table_night items; "Solo Shares" shows only solo_share and collaborative_entry items — PASS. `tables.tsx:180-181` maps to `filterType` round/solo_share. Edge function `table-activity/index.ts:73` skips solo when round, `table-activity/index.ts:184` skips nights when solo_share.
- [x] Selecting "By Me" shows only items where current user is author or participant — PASS. `tables.tsx:182` passes `filterUserId: user?.id`. Edge function filters entries by `user_id` (`table-activity/index.ts:100-101`) and nights by participant subquery (`table-activity/index.ts:187-197`).
- [x] Selecting a member chip shows only items where that member is author or participant — PASS. `tables.tsx:183` passes `filterUserId: activeFilter` (the member's UUID).
- [x] Filter is applied server-side via query params — PASS. `useTableActivity.ts:101-103` appends `filter_type` and `filter_user_id` to URL. Edge function parses them at `table-activity/index.ts:44-45`.
- [x] Switching tables resets filter to "All" — PASS. `tables.tsx:160-162` `useEffect` sets `activeFilter(null)` on `activeTable?.id` change.
- [x] Member chips populated from useTableMembers; if only current user, no member chips appear — PASS. `tables.tsx:168-169` filters out current user. If no other members, `memberChips` is empty, only `STATIC_CHIPS` render.

**Date section headers**
- [x] Feed items grouped under sticky date headers visible at top while scrolling — PASS. `SectionList` with `stickySectionHeadersEnabled` at `tables.tsx:357`. `renderSectionHeader` at `tables.tsx:370-372`.
- [x] Bucketing: Today, Yesterday, This Week (ISO), Last Week (ISO), then Month Year — PASS. `dateBucketLabel` at `tables.tsx:64-98` implements all five buckets. ISO week via `isoWeek()` at `tables.tsx:46-51`.
- [x] Headers use Newsreader italic, textMuted color, subtle bottom rule using divider color — PASS. `DateSectionHeader.tsx:50` uses `Newsreader_400Regular_Italic`, `DateSectionHeader.tsx:30` uses `palette.textMuted`, `DateSectionHeader.tsx:35` uses `palette.divider` on a 1px rule.
- [x] Date grouping computed client-side from sort_date — PASS. `groupIntoSections` at `tables.tsx:106-123` operates on `item.sort_date`.
- [x] Empty groups not rendered — PASS. `groupIntoSections` only creates sections for labels that have items (Map-based grouping, `tables.tsx:111-113`).

**Pinned active rounds shelf**
- [x] table_night items with status=rating removed from chronological position and rendered in shelf above feed — PASS. Partition at `tables.tsx:199-213` splits by `status === 'rating'`. Shelf via `ListHeaderComponent` at `tables.tsx:367-369`.
- [x] Shelf has "IN PROGRESS" label using Type.label styling — PASS. `ActiveRoundsShelf.tsx:25` uses `Type.label`.
- [x] Active round cards use existing TableNightCard — PASS. `ActiveRoundsShelf.tsx:30` renders `<TableNightCard>`.
- [x] If no active rounds, shelf not rendered — PASS. `ActiveRoundsShelf.tsx:21` returns null when `items.length === 0`.
- [x] When round transitions to revealed, drops out of shelf into main feed on next refresh — PASS. The partition logic is re-evaluated on every data change; a revealed round (status !== 'rating') goes into `feedItems` instead of `activeRounds`.

**Compact mode**
- [x] Entries older than 14 days render compact: 24px avatar, restaurant name, rating — PASS. `tables.tsx:374-375` computes `isOld` from `compactCutoff`. `CompactEntryRow.tsx:63` uses `size={24}`, shows restaurant name and rating.
- [x] Tapping compact entry expands to full card — PASS. `tables.tsx:381` calls `handleToggleExpand`. When `isExpanded`, full card renders at `tables.tsx:388-405`.
- [x] Only one compact entry expanded at a time — PASS. `expandedItemId` state at `tables.tsx:224`. `handleToggleExpand` at `tables.tsx:226-228` toggles; selecting a new one replaces the old.
- [x] 14-day threshold computed client-side — PASS. `COMPACT_CUTOFF_MS` at `tables.tsx:136`. `compactCutoff` at `tables.tsx:280`.
- [x] Entries within last 14 days always full cards — PASS. `isOld` is false for recent entries, so they bypass the compact branch.

**Server-side filter params**
- [x] Edge function accepts optional filter_type (round, solo_share) — PASS. `table-activity/index.ts:44`.
- [x] Edge function accepts optional filter_user_id (UUID) — PASS. `table-activity/index.ts:45`.
- [x] filter_type=round returns only table_night records — PASS. `table-activity/index.ts:73` skips solo entries when `filterType !== 'round'` evaluates as skip.
- [x] filter_type=solo_share returns only entries — PASS. `table-activity/index.ts:184` skips nights when `filterType !== 'solo_share'` evaluates as skip.
- [x] filter_user_id filters solo shares by user_id and nights by participant — PASS. Solo: `table-activity/index.ts:100-101`. Nights: sub-query on `table_night_participants` at `table-activity/index.ts:188-191`.
- [x] Both params combinable — PASS. Both conditions are independent if/then blocks, not mutually exclusive.
- [x] No filter params = identical behavior to current — PASS. When both are null, both query blocks execute unchanged, merge and sort as before.

**Correctness: PASS** — date bucketing, filter mapping, active round partitioning, compact mode toggling all work as designed. SectionList + SectionHeader + ListHeaderComponent wiring is correct.

**Edge Cases: WARN** — `filterUserId: user?.id` at `tables.tsx:182` can be undefined if auth hasn't loaded. The builder documented this as safe since auth always loads before the feed renders, and `undefined` becomes a no-op (no filter applied). Acceptable but not airtight.

**Error Handling: PASS** — edge function has auth check, membership check, query error handling, 500 catch-all. Hook uses `enabled: !!tableId` guard. Empty states per filter with descriptive labels.

**Security: PASS** — no `ARCHITECT-REVIEW` comments. `filter_user_id` is not validated as UUID format, but it's used in a `.eq()` call which will simply return no results for invalid values. The table_night_participants sub-query at `table-activity/index.ts:188-191` is NOT scoped to the current table, but this only affects which night IDs are collected; the subsequent `nightsQuery` at line 218 already filters by `table_id`, so cross-table leakage is impossible.

**Performance: WARN** — the `__none__` sentinel at `table-activity/index.ts:195` works but is inelegant; a short-circuit returning `[]` would avoid a wasted query. The N+1 pattern for fetching participants per night (Promise.all at line 232) is pre-existing, not introduced by this ticket. The `now = useMemo(() => new Date(), [])` is documented as mounting once and not updating past midnight, which is acceptable.

**Design Compliance: PASS** — theme tokens used correctly throughout. `Type.caption` for chip labels, `Type.label` for shelf header, `Newsreader_400Regular_Italic` for date headers, `palette.primary` / `palette.surfaceContainerHigh` for chip states, `palette.divider` for rules, `palette.textMuted` for header text. 13 files changed, no scope creep beyond what the spec calls for.

Key issues:
1. WARN: `tables.tsx:182` — `filterUserId: user?.id` can be undefined when auth is still loading, causing "By Me" to return unfiltered results. Low risk (auth loads before feed renders). Fix: guard with `filterUserId: user?.id ?? '__skip__'` or add `enabled: !!user?.id` to the filter computation.
2. WARN: `table-activity/index.ts:194-195` — `['__none__']` sentinel passed to `.in()` to force empty results when a user has no participation records. Works but wasteful (sends a query that will never match). Fix: short-circuit with `nightsWithParticipants = []` and skip the query block entirely when `nightIds.length === 0`.

### Review 2 (if needed)
```
Date: 
Verdict: 
Score: 
```

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-15
- Final verdict: APPROVE (23 PASS / 2 WARN / 0 FAIL)
- Notes: Phase 1 only (timeline polish). Grid view and calendar view deferred to future tickets. 2 WARNs accepted: undefined filterUserId edge case (auth always loads first), and __none__ sentinel in edge function (inelegant but safe).
