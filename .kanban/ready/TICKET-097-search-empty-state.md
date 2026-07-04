---
id: TICKET-097
title: Search page empty state — fill the pre-query page with the user's own material
priority: medium
status: in-progress
created: 2026-07-04
tags: [search, ui]
---

# TICKET-097 — Search page empty state

## Problem

Founder: the search tab pre-query is just a bar + near-blank page. It should fill,
Beli/Letterboxd-style, with the user's OWN material. Doctrine holds: no public
trending/explore content — everything shown is personal.

## Spec

The empty state (restaurants mode, no query) becomes a scrollable stack. Each
section renders ONLY when it has data:

### 1. RECENT
- Kicker via `TierHeader`, plus a small right-aligned `clear` text action in the
  same row (Manrope, muted).
- Recent searches survive app restarts: `searchCache.recentQueries` backed by
  AsyncStorage (`@react-native-async-storage/async-storage` 2.2.0, already
  installed). Hydrate once on first access (async — `useRecentSearches`
  re-renders when hydration lands), write-through on add/clear. Cap raised
  5 → 8. Storage key `napkin.recentSearches.v1`. Existing exported API shape
  preserved; extended as needed.
- Rows: `time-outline` Ionicon (muted) + query text (Manrope). Tap = run that
  search (set input + debounced query — same path `RecentSearchesList` uses
  today). Reuse/extend `RecentSearchesList`, don't duplicate.

### 2. PINNED NEAR YOU
- NEVER prompt for location from this tab. On mount,
  `Location.getForegroundPermissionsAsync()` — only if already granted, obtain
  coords (silent/granted-only path added to `useNearbyLocation`, API backward
  compatible).
- No permission or no coords → the section is simply ABSENT. No CTA, no nag,
  no explanatory copy.
- Data: first page of the personal wishlist (existing hook, no pagination
  loops), keep rows with lat/lng, haversine-sort, take 6. Row visual matches
  `SearchResultRow`'s ledger style (photo tile, name, meta
  `city · cuisine · 0.3 mi` — distance formatted like wishlist rows). Tap →
  `/restaurant/[id]`.

### 3. YOUR LISTS
- Top 4 of `useMyLists` (already reverse-chron by updated_at). Compact
  typographic row: list title in Newsreader italic (content), `<n> spots` meta
  in Manrope, NO thumbnails (lists are typographic per design doctrine). Tap →
  `/list/[id]`.

### 4. Nothing at all (new user)
- Keep today's minimal state — at most one short line. No onboarding prose.

### While typing (results showing)
- Append one section **YOUR LISTS** at the END of the tiered results when list
  titles match the query — client-side case-insensitive substring filter of
  `useMyLists` on title (description as tiebreaker), top 3, same row component
  as block 3. This is **TICKET-094 option A** (ticket file for 094 lands with
  PR #113). No server calls for list search.

### Acceptance criteria
- [ ] Recents persist across app restarts (cap 8, storage key
      `napkin.recentSearches.v1`), write-through on add/clear.
- [ ] `clear` action in the RECENT kicker row empties recents (memory + disk);
      section disappears.
- [ ] Tapping a recent runs that search first tap, even with keyboard up
      (keyboardShouldPersistTaps).
- [ ] PINNED NEAR YOU appears only with prior location grant AND wishlist rows
      carrying coords; max 6, nearest first, meta shows `city · cuisine · X mi`.
- [ ] No location permission prompt is ever triggered from the search tab.
- [ ] YOUR LISTS shows top 4 lists, typographic rows, taps route to
      `/list/[id]`.
- [ ] Sections absent when empty; brand-new user sees today's clean state.
- [ ] Typing mode appends "Your lists" section (top 3 title/description
      matches) after tier 3; absent when no match.
- [ ] People search mode untouched. Query pipeline/tiers/LRU cache untouched
      except recents persistence.
- [ ] All spacing/color/type from theme tokens; TierHeader for every kicker;
      `·` separators; no emoji; no "see all" links; zero explanatory sentences.

## UX decisions

- No location prompt from search — granted-only silent path (the wishlist tab
  owns the lazy opt-in prompt).
- No public/trending content — doctrine: everything personal.
- Recents persisted to AsyncStorage (survive restarts), cap 8.
- Implements TICKET-094 option A (client-side list-title matching in search).
- Sections are quiet — no "see all" links (wishlist/lists have their own tabs).

## Out of scope

- People-mode empty state.
- Server-side list search (TICKET-094 option B).
- Trending / explore / any public content.

## Build Log

Built 2026-07-04 on `feat/ticket-097-search-empty-state`.

### Files Changed

- `napkin-app/hooks/search/searchCache.ts` — recents persisted to AsyncStorage
  (`napkin.recentSearches.v1`), cap 5 → 8, lazy hydration with merge (session
  adds stay newest), write-through on add/clear, epoch guard so a clear can't
  be resurrected by an in-flight hydration, `subscribeRecents`/`clearRecents`
  added (existing API preserved; `clear()` still clears both). Result LRU
  untouched.
- `napkin-app/hooks/search/useRestaurantSearch.ts` — `useRecentSearches` now
  `useSyncExternalStore`-backed so hydration/clear re-render.
- `napkin-app/hooks/useNearbyLocation.ts` — added `requestIfGranted()`
  (silent, granted-only via `getForegroundPermissionsAsync`; never prompts);
  `coords/status/request` unchanged — existing consumers (wishlist,
  dining-map) untouched.
- `napkin-app/components/search/TierHeader.tsx` — optional right-aligned quiet
  text action (Manrope caption, muted) for the recents `clear`.
- `napkin-app/components/search/RecentSearchesList.tsx` — kicker now
  TierHeader (continuity with result tiers) + optional `onClear`.
- `napkin-app/components/search/SearchResultRow.tsx` — optional
  `distanceLabel` appended to the meta line (`city · cuisine · 0.3 mi`).
- `napkin-app/components/search/ListRow.tsx` (new) — typographic list row
  (italic serif title, `<n> spots` Manrope meta, no thumbnail), metrics match
  SearchResultRow.
- `napkin-app/components/search/SearchEmptyState.tsx` (new) — the empty-state
  stack (recent / pinned near you / your lists), sections render only with
  data; new user gets today's clean state.
- `napkin-app/components/search/emptyStateUtils.ts` (new) — pure selectors:
  `selectNearbyPinned` (first wishlist page → coords-bearing rows →
  haversine-sort → take 6, dedupe, drops pending captures) and
  `filterListsByQuery` (title matches first, description tiebreaker, top 3).
- `napkin-app/components/search/index.ts` — barrel exports.
- `napkin-app/app/(tabs)/search.tsx` — empty branch renders SearchEmptyState;
  mount-time location switched to the silent granted-only path (feeds both
  Places bias and the near-you section); `buildFlatList` gains a trailing
  "Your lists" section (typing mode, debounced-query keyed); renderItem
  handles the new `list` item type; `/list/[id]` navigation. Query
  pipeline/tiers/LRU untouched; people mode untouched; Ritz ghost-payload
  path untouched.

### Tests

- `napkin-app/hooks/search/__tests__/searchCacheRecents.test.ts` (new, 13
  tests) — write-through, dedupe-to-front, cap 8, lazy hydration + notify,
  pre-hydration merge order, corrupt/tampered stash, clear + clear-race
  (epoch), subscription notify/unsubscribe, snapshot reference stability.
- `napkin-app/components/search/__tests__/emptyStateUtils.test.ts` (new, 11
  tests) — no-coords → absent, nearest-first + cap 6, drops
  null-restaurant/no-coords/pending rows, dedupe, SearchResultRow shaping +
  "0.3 mi" formatting; list filter case-insensitivity, title-before-
  description ranking, top-3 cap, blank query, null descriptions.
- Full suite: 31 suites / 371 tests pass. `npx tsc --noEmit`: only the 4
  known pre-existing errors (CandidatePickerPanel ×3, ImportLinkSheetNonce
  ×1). `npm run lint`: 0 errors, no new warnings (all 50 warnings
  pre-existing, none in touched files).

### Builder Questions

- The tab previously called `requestForegroundPermissionsAsync` on mount for
  Places bias — i.e. it PROMPTED from the search tab. Per this ticket's "never
  prompt from this tab" rule (and to avoid duplicating position logic), that
  effect now uses the silent granted-only path. Consequence: users who never
  granted location elsewhere lose the (never-explicitly-granted) search bias
  until they opt in via wishlist "Nearest"/map. Flagging in case the bias
  prompt was considered load-bearing.

---

## Review History

### Review 1 — code-reviewer (cold)
```
Date: 2026-07-04
Verdict: FAIL → fixed → re-verified
Score: 9/10 acceptance criteria on first pass · 1 P0 · 3 P2
```
- **P0 (fixed):** recents write-through raced the lazy AsyncStorage hydration read — an add in the first ~50ms after launch committed to disk before the read returned, permanently wiping the prior session's recents. The jest mock's same-microtask `getItem` hid it. Fix: `persistRecents` is gated until hydration settles; pre-hydration adds queue into ONE combined write flushed in `hydrateRecents`' finally; `clearRecents` owns its state (direct `removeItem`, marks hydrated, drops pending). Two regression tests with a delayed `getItem` mock pin the invariant (no `setItem` while the read is in flight; merge lands in a single write; clear-mid-read never resurrects).
- Reviewer endorsed the location-prompt removal: silent-if-granted is correct; if geo-bias coverage matters later, earn the grant contextually (thin-results chip), never a mount-time prompt.
- P2s (open, non-blocking): `hasQuery` at 1 char vs 2-char search threshold briefly shows "No results" (pre-existing on main); `SearchResultRow` carries a pre-existing ARCHITECT-REVIEW comment about user ratings.
