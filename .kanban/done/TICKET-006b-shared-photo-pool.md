---
id: TICKET-006b
title: "Shared Photo Pool (Phase 2 of Live Round Experience)"
priority: medium
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [tables, rounds, photos, ux]
---

# Shared Photo Pool (Phase 2 of Live Round Experience)

## Problem
After TICKET-006, each person's photos are attached to their own review — but there's no **shared visual memory** of the night. When five people dine together, the best photos are scattered across five individual entries. There's no unified "album" for the group experience.

The dream: after a Table Night, the Round detail page becomes a **memory reel** — everyone's photos merged into a beautiful shared grid. Like a Google Photos shared album that auto-creates itself from the round.

## Notes
- Phase 1 (TICKET-006) delivered multi-photo per review with `entry_photos` table
- This phase merges all participants' photos into a single shared pool on the Round detail page
- Ownership still matters — show who took each photo (small avatar overlay)
- Extract the multi-photo thumbnail row into a shared component (duplicated in `create-entry.tsx` and `table-night.tsx` today — ~40 lines each)
- Post-reveal, the Round detail becomes a "memory page": verdict + ratings + shared photo grid
- Consider: should participants be able to add photos to the pool *after* the round concludes? (e.g., someone took a great dessert shot but forgot to upload during voting)

### Inspiration
- Google Photos shared albums — auto-populated from participants
- Apple Shared Photo Library — seamless merge
- Instagram collab posts — multiple contributors, one post

### Dependencies
- TICKET-006 (Phase 1) — `entry_photos` table, multi-photo upload infrastructure ✅ DONE

### Key decisions to make in spec phase
1. **New `round_photos` table vs. virtual view?** Could just query `entry_photos` joined through `entries` where `table_night_id = X`. No new table needed — the "pool" is a query, not a data structure. But a dedicated table allows photos not tied to any individual entry (group shots, ambiance).
2. **Post-round photo additions?** Allow adding photos after reveal? Useful but complicates the lifecycle.
3. **Photo grid layout**: Simple uniform grid vs. Pinterest-style masonry vs. featured hero + grid?
4. **Extract `MultiPhotoRow` component**: The thumbnail row is duplicated in `create-entry.tsx` and `table-night.tsx`. This ticket should extract it into `components/MultiPhotoRow.tsx`.
5. **RLS for round_photos**: If new table, follow the `entry_photos` pattern — SELECT via table membership join, INSERT by table members, DELETE by photo owner.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories

- As a table member viewing a past Round, I want to see all photos from every participant in one place, so that the Round detail page feels like a shared memory of the night — not five separate reviews.
- As a table member browsing the shared photo grid, I want to see a small avatar overlay on each photo so I know who took it without leaving the grid.
- As a table member who forgot to add photos during the Round, I want to add photos to the Round after it has been revealed, so that late-night or next-morning photos still make it into the shared album.
- As a developer working on photo features, I want a single `MultiPhotoRow` component used in both `create-entry.tsx` and `table-night.tsx`, so the thumbnail strip logic is not duplicated and diverging.

### Acceptance Criteria

**Shared Photo Grid on Round Detail**
- [ ] The `table-night-detail.tsx` screen shows a new "Photos" section below the "Who Said What" section (above the footer)
- [ ] The Photos section aggregates all `entry_photos` from all entries where `table_night_id` matches the current Round — no new database table
- [ ] Photos render in a uniform grid: 3 columns, square thumbnails, `Spacing.xs` gap
- [ ] Each photo thumbnail has a small circular avatar overlay (initials-based, bottom-left corner, 20px diameter) showing who took it
- [ ] The section header reads "Photos" with the standard `SectionLabel` pattern, plus a count: "Photos (12)"
- [ ] If zero photos exist across all participants, the Photos section is hidden entirely
- [ ] Tapping a photo opens a full-screen lightbox showing the photo at full resolution (simple modal with close button — not a full gallery viewer)
- [ ] The existing per-participant photo strip inside each `ParticipantRow` remains unchanged — the shared grid is additive, not a replacement

**Post-Round Photo Additions**
- [ ] On the Round detail page (status `revealed` or `closed`), an "Add Photos" button appears at the end of the photo grid
- [ ] Tapping "Add Photos" opens the existing camera/library picker flow
- [ ] Uploaded photos are attached to the current user's entry for that Round (creates an `entry_photos` row linked to their existing entry)
- [ ] If the user has no entry for this Round (they were a participant but never submitted), the "Add Photos" button is hidden for them
- [ ] Newly added photos appear in the grid immediately after upload completes (optimistic or invalidate query)
- [ ] There is no time cutoff — photos can be added anytime after reveal

**MultiPhotoRow Component Extraction**
- [ ] A new `components/MultiPhotoRow.tsx` exists, exported as a reusable component
- [ ] It accepts props: `photos: PhotoSlot[]`, `maxPhotos: number`, `onAdd`, `onRemove`, `onRetry`, `palette`
- [ ] `create-entry.tsx` uses `MultiPhotoRow` instead of its inline implementation
- [ ] `table-night.tsx` uses `MultiPhotoRow` instead of its inline implementation
- [ ] Visual behavior is identical to the current inline versions (hero label on first photo, upload spinner, error retry, dismiss button, add slot)

**Data Fetching**
- [ ] The shared photo pool query reuses the existing `fetchNightEntryPhotos` pattern already in `table-night-detail.tsx`, extended to return `{ photo_url, user_id, entry_id }` per photo (not just URLs grouped by user)
- [ ] Query key follows the existing pattern: `['night-photos-pool', nightId]`
- [ ] `staleTime: 1000 * 60 * 5` consistent with other photo queries

### UX Decisions

- **Virtual view (query) vs. new table**: Query-based pool. The "pool" is `entry_photos JOIN entries WHERE table_night_id = X`. No new `round_photos` table. Reason: every photo is already tied to an entry, and entries are tied to the Round. A dedicated table only matters if we need orphan photos (group shots not tied to any individual entry), and that is a v3 concern.
- **Post-round photo additions**: Allowed, no time cutoff. Photos attach to the user's existing entry. Reason: this is a memory album for close friends — there is no reason to lock it. People take photos after dinner, the next morning, or find them in their camera roll a week later.
- **Grid layout**: Uniform 3-column square grid. Not masonry, not a hero+grid. Reason: masonry requires aspect ratio metadata and layout calculation that adds complexity for marginal visual benefit at this photo count (most Rounds will have 3–15 photos).
- **Avatar overlay on grid photos**: Small initials circle (20px) positioned bottom-left of each thumbnail with a subtle dark scrim behind it. Ownership matters but should not dominate the visual.
- **Lightbox on tap**: Simple full-screen modal with the photo, a close button, and the photographer's name. Not a swipeable gallery — that's a future polish pass.
- **Photos section placement**: Below "Who Said What", above footer. Ratings are the primary content; photos are supplemental context.
- **MultiPhotoRow extraction scope**: Extract the thumbnail strip (horizontal scroll of photo slots with add/remove/retry) into a shared component. The upload logic stays in each screen's hook/callback — the component is purely presentational.

### Out of Scope

- New `round_photos` database table — no orphan/group-shot photos in v1
- Swipeable photo gallery / carousel viewer — single-photo lightbox only
- Photo deletion by other users — you can only remove your own photos
- Photo reordering within the grid — grid order is by `sort_order` then `created_at`
- Photo captions or comments — no per-photo text
- Masonry / Pinterest-style layout — uniform grid only
- Photo upload from the grid for users who have no entry
- Realtime updates to the photo grid — standard query invalidation is sufficient

### Open Questions

None.

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Build a shared photo pool on the Round detail page (`table-night-detail.tsx`) by querying existing `entry_photos` joined through `entries` where `table_night_id` matches — no new database tables. The pool is a flat array of `{ photo_url, user_id, entry_id, display_name }` fetched via a single Supabase client-side query. Extract the duplicated `MultiPhotoRow` thumbnail strip (currently ~40 lines each in `create-entry.tsx` and `table-night.tsx`) into a shared presentational component. Add a 3-column uniform photo grid with avatar overlays, a simple lightbox modal, and a post-round "Add Photos" flow that inserts into `entry_photos` via direct Supabase client calls (no new edge function needed — RLS already allows `INSERT` on `entry_photos` for the entry owner's rows).

### Architecture Decisions

- **Query-based pool, not a new table**: The pool query is `entry_photos JOIN entries WHERE table_night_id = X`, fetched client-side with the Supabase JS client (not an edge function). The existing `fetchNightEntryPhotos` function in `table-night-detail.tsx` already does 90% of this — it just needs to return a flat array with per-photo metadata instead of a `Record<string, string[]>` grouped by user. Because RLS on `entry_photos` grants `SELECT` to table members (via the `entries` join), no service-role call is needed. Trade-off: no orphan "group shots" unattached to an entry — acceptable for v1.

- **Two query functions, not one refactored one**: Keep the existing `fetchNightEntryPhotos` (grouped by user, used by `ParticipantRow` photo strips) and add a new `fetchNightPhotoPool` (flat array, used by the grid). They share the same two-query pattern (fetch entries, then fetch photos) but return different shapes. Merging them into one function would couple the per-participant strip and the shared grid unnecessarily, and the data transformation cost is trivial. Trade-off: two similar queries that could drift, but they are co-located in the same file and easy to keep in sync.

- **Direct Supabase client insert for post-round photos, not an edge function**: Adding photos post-round means inserting into `entry_photos` with a known `entry_id`. The RLS policy on `entry_photos` already allows `INSERT` when `entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())`. The client can do this directly via `supabase.from('entry_photos').insert(...)` after uploading to storage with the existing `compressAndUpload`. No new edge function action is required. Trade-off: the client computes the next `sort_order` itself (max existing + 1), which could race if two devices upload simultaneously for the same entry — but this is a close-friends app where one person adding photos from two devices at once is not a realistic scenario.

- **Extract MultiPhotoRow as a pure presentational component**: The component receives `photos`, `maxPhotos`, `onAdd`, `onRemove`, `onRetry`, and `palette`. It does not manage upload state — that stays in each screen's callbacks. Both `create-entry.tsx` and `table-night.tsx` use the `Image` component differently (`expo-image` in table-night, `react-native` `Image` in create-entry), so the extracted component should use `expo-image` consistently (it is already a dependency). Trade-off: minor visual diff if `expo-image` renders slightly differently than RN `Image` in the create-entry flow — verify visually.

- **Lightbox is a local Modal, not a route**: The lightbox is a React Native `Modal` rendered inside `table-night-detail.tsx`, not a new Expo Router route. It shows one photo full-screen with a close button and photographer name. This avoids navigation stack complexity for what is essentially a zoom view. Trade-off: no deep-linking to a specific photo — not needed for a private group feature.

### File Changes

- `napkin-app/components/MultiPhotoRow.tsx` — **NEW** — Extracted horizontal photo thumbnail strip (presentational). Accepts `PhotoSlot[]`, `maxPhotos`, `onAdd`, `onRemove`, `onRetry`, `palette`. Renders hero label, upload spinner, error retry, dismiss button, add slot.
- `napkin-app/app/create-entry.tsx` — **MODIFY** — Replace inline photo thumbnail `ScrollView` + slot rendering (~lines 942-1004) with `<MultiPhotoRow>`. Remove duplicated styles (`photoRow`, `photoThumbContainer`, `photoThumb`, `heroLabel`, `thumbOverlay`, `photoRemoveButton`, `photoAddSlot`).
- `napkin-app/app/table-night.tsx` — **MODIFY** — Replace inline photo thumbnail `ScrollView` + slot rendering (~lines 597-651) with `<MultiPhotoRow>`. Remove duplicated styles (`photoRow`, `photoThumbContainer`, `photoThumb`, `heroLabel`, `thumbOverlay`, `photoDismiss`, `photoAddSlot`).
- `napkin-app/app/table-night-detail.tsx` — **MODIFY** — (1) Add `fetchNightPhotoPool` function returning flat `PoolPhoto[]` array with `{ photo_url, user_id, entry_id, display_name }`. (2) Add `useNightPhotoPool` hook with query key `['night-photos-pool', nightId]`. (3) Add `SharedPhotoGrid` component: 3-column grid with avatar overlays, "Add Photos" button. (4) Add `PhotoLightbox` component: full-screen `Modal` with close button and photographer name. (5) Add post-round photo upload flow: pick image, `compressAndUpload`, insert `entry_photos` row, invalidate pool query. (6) Wire `SharedPhotoGrid` between the "Who Said What" section and the footer.
- `napkin-app/lib/queryKeys.ts` — **MODIFY** — Add `photoPool: (nightId: string) => ['night-photos-pool', nightId] as const` under `tableNight`.

### Implementation Order

1. **Extract `MultiPhotoRow` component** — because both `create-entry.tsx` and `table-night.tsx` depend on it, and we want to verify the extraction is visually identical before adding new features. Unify on `expo-image`'s `Image` component. Verify both screens still work.
2. **Add `fetchNightPhotoPool` + `useNightPhotoPool` in `table-night-detail.tsx`** — because the grid and lightbox depend on this data. Add the query key to `queryKeys.ts`. Test the query returns correct flat results by logging.
3. **Build `SharedPhotoGrid` + `PhotoLightbox`** — the grid renders `PoolPhoto[]` in a 3-column `FlatList` (or `View` with `flexWrap`) with avatar initials overlays. Tapping a photo opens the lightbox modal. Wire into the detail screen below "Who Said What", above footer. Hide section if zero photos.
4. **Build post-round "Add Photos" flow** — add the "Add Photos" button at the end of the grid. On tap, reuse the existing `handlePhotoPress` camera/library picker pattern. Upload via `compressAndUpload`, then insert into `entry_photos` with the user's entry_id for this night. Invalidate `['night-photos-pool', nightId]` and `['night-entry-photos', nightId]` on success. Requires finding the user's entry_id — query `entries` where `table_night_id = nightId AND user_id = currentUser`. Hide button if user has no entry.

### Risks

- **`expo-image` vs `react-native` `Image` visual parity**: The `MultiPhotoRow` extraction unifies on `expo-image`. The `create-entry.tsx` screen currently uses RN's `Image`. If there are visual differences (e.g., loading placeholder behavior, cache behavior), they will be visible immediately. Mitigation: test both screens visually after extraction; `expo-image` is a strict superset and should render identically for static URIs.
- **`sort_order` race on post-round insert**: When a user adds photos post-round, the client queries `MAX(sort_order)` for their entry and increments. If two uploads fire simultaneously, they could collide on the unique index `(entry_id, sort_order)`. Mitigation: use `Date.now()` as `sort_order` instead of sequential integers for post-round additions — the unique index is on `(entry_id, sort_order)` and timestamps will not collide in practice. Alternatively, catch the unique constraint error and retry with an incremented value.
- **User with no entry cannot add photos**: The spec says "Add Photos" is hidden if the user has no entry. But a participant who joined the round but never voted (and the round auto-revealed) would have no entry row. This is correct per spec but could confuse a user who was present. Mitigation: this is explicitly called out in acceptance criteria — no action needed, just be aware.
- **Photo pool query performance**: The query does two hops (entries by `table_night_id`, then `entry_photos` by `entry_id IN (...)`). For a typical round of 3-8 people with 0-6 photos each, this is at most ~50 photos — trivial. No performance concern at this scale.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed
- `napkin-app/components/MultiPhotoRow.tsx` — NEW: Extracted horizontal photo thumbnail strip. Props: `photos: PhotoSlot[]`, `maxPhotos`, `onAdd`, `onRemove`, `onRetry`, `palette`. Renders hero label on first photo, upload spinner, error retry (Ionicons refresh icon), dismiss button, add slot with camera icon. Uses `expo-image`'s `Image` component throughout.
- `napkin-app/app/create-entry.tsx` — MODIFIED: Replaced inline photo ScrollView (~lines 942–1004) with `<MultiPhotoRow>`. Added import. Removed duplicated photo styles (`photoRow`, `photoThumbContainer`, `photoThumb`, `heroLabel`, `thumbOverlay`, `photoRemoveButton`, `photoAddSlot`).
- `napkin-app/app/table-night.tsx` — MODIFIED: Replaced inline photo ScrollView (~lines 597–651) with `<MultiPhotoRow>`. Added import. Removed duplicated photo styles. Removed unused `Image` import from `expo-image`.
- `napkin-app/app/table-night-detail.tsx` — MODIFIED: Added `fetchNightPhotoPool` + `useNightPhotoPool` (flat array query returning `PoolPhoto[]`). Added `fetchMyEntryId` + `useMyEntryId` (finds current user's entry_id for the night). Added `SharedPhotoGrid` component: 3-column flexWrap grid, avatar initials overlay on each photo, "Add Photos" button. Added `PhotoLightbox` component: full-screen Modal with close button and photographer name. Added `SectionLabelWithCount` helper. Wired photo grid between "Who Said What" and footer. Post-round upload: uses `compressAndUpload` + direct `supabase.from('entry_photos').insert()`, invalidates both `photoPool` and `night-entry-photos` query keys.
- `napkin-app/lib/queryKeys.ts` — MODIFIED: Added `photoPool: (nightId: string) => ['night-photos-pool', nightId] as const` under `tableNight`.

### Tests
- TypeScript check (`npx tsc --noEmit --skipLibCheck`) passes with zero new errors. Two pre-existing errors in `table-night.tsx` (missing `@react-native-community/slider` types, implicit `any`) were present before this PR.
- No automated test suite exists for this codebase (Jest exits with "No tests found" — see project memory).

### Builder Questions
- The `SharedPhotoGrid` receives `queryClient` as a prop from the parent screen (to call `invalidateQueries` after upload). This avoids calling `useQueryClient()` inside a non-component function, but it does mean the prop type uses `ReturnType<typeof useQueryClient>`. This is idiomatic but slightly verbose — an alternative is moving `uploadPhoto` into a custom hook. ARCHITECT-REVIEW: is the current prop-drilling approach acceptable, or should the upload logic be extracted to a `useAddPoolPhoto` hook in a future pass?
- The `useMyEntryId` query fires a Supabase round-trip on every revealed round detail page load to find the user's `entry_id`. This is a lightweight query but an extra network call. Alternative: include `entry_id` in the `table_night_participants` join inside `useTableNightStatus`. Left as-is per the design decision to avoid modifying the existing hook.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date: 2026-04-16
Verdict: REVISE
Score: 20 PASS / 1 WARN / 1 FAIL

Spec compliance: 21/22 acceptance criteria met

**Shared Photo Grid on Round Detail**
- [x] Photos section below "Who Said What", above footer — PASS (table-night-detail.tsx:392-403)
- [x] Aggregates entry_photos via entries WHERE table_night_id, no new table — PASS (fetchNightPhotoPool, line 100-149)
- [x] 3-column uniform grid, square thumbnails, Spacing.xs gap — PASS (line 457, photoGrid style)
- [x] 20px circular avatar overlay, bottom-left, initials-based — PASS (gridThumbAvatar style)
- [x] Section header "Photos" with count — PASS (SectionLabelWithCount, line 559)
- [x] Hidden when zero photos and no add button — PASS (line 553-555)
- [x] Tapping opens full-screen lightbox with close button — PASS (PhotoLightbox component)
- [x] Per-participant photo strip in ParticipantRow unchanged — PASS (no diff to ParticipantRow)

**Post-Round Photo Additions**
- [x] "Add Photos" button on revealed/closed rounds — PASS (line 554, 597-598)
- [x] Opens camera/library picker — PASS (handleAddPhoto, line 498-549)
- [x] Uploads to entry_photos linked to user's entry — PASS (uploadPhoto, line 460-495)
- [x] Hidden if user has no entry — PASS (line 554: myEntryId !== null check)
- [ ] Photos appear after upload (invalidate query) — FAIL: sort_order uses Date.now() which overflows PostgreSQL INTEGER (max 2^31-1 = 2.15B, Date.now() = ~1.77T). Insert will always fail. See table-night-detail.tsx:467.
- [x] No time cutoff — PASS (no time check in code)

**MultiPhotoRow Component Extraction**
- [x] components/MultiPhotoRow.tsx exists — PASS
- [x] Accepts photos, maxPhotos, onAdd, onRemove, onRetry, palette — PASS (line 34-47)
- [x] create-entry.tsx uses MultiPhotoRow — PASS
- [x] table-night.tsx uses MultiPhotoRow — PASS
- [x] Visual behavior identical (hero label, spinner, retry, dismiss, add slot) — PASS

**Data Fetching**
- [x] fetchNightPhotoPool returns { photo_url, user_id, entry_id, display_name } — PASS (PoolPhoto type, line 49-55)
- [x] Query key ['night-photos-pool', nightId] — PASS (queryKeys.ts:34)
- [x] staleTime: 1000 * 60 * 5 — PASS (line 155)

Correctness: FAIL — Date.now() as sort_order overflows PostgreSQL INTEGER column, every post-round upload will error
Edge Cases: WARN — empty display_name produces "undefined" initials, but this is a pre-existing pattern (ParticipantRow:754 has the same issue)
Error Handling: PASS — upload errors surfaced via Alert, camera permission handled, catch blocks present
Security: PASS — RLS-based inserts, no service-role escalation, no raw SQL
Performance: PASS — trivial query volume (3-8 entries, <50 photos)
Design Compliance: PASS — follows existing patterns (query hooks, Supabase client queries, theming)

Key issues:
1. **[BLOCKING] sort_order INTEGER overflow** — table-night-detail.tsx:467 uses `Date.now()` (~1.77 trillion) as sort_order, but the column is `INTEGER` (max 2,147,483,647). Every post-round photo insert will fail with a Postgres overflow error. Fix: query `SELECT MAX(sort_order) FROM entry_photos WHERE entry_id = ?` and use `max + 1`, or use `poolPhotos.filter(p => p.entry_id === myEntryId).length` as a simpler client-side approximation.
2. **[NON-BLOCKING] Unused `Image` import** — table-night-detail.tsx:14 imports `Image` from react-native but it is never used. Pre-existing, not introduced by this PR.

ARCHITECT-REVIEW response (from build log):
The queryClient prop-drilling approach is acceptable for now. The upload logic is small and localized. Extracting to a `useAddPoolPhoto` hook would be a reasonable future refinement but is not blocking.
```

### Review 2
```
Date: 2026-04-16
Verdict: APPROVE
Score: 22 PASS / 0 WARN / 0 FAIL

Spec compliance: 22/22 acceptance criteria met

**Shared Photo Grid on Round Detail**
- [x] Photos section below "Who Said What", above footer — PASS
- [x] Aggregates entry_photos via entries WHERE table_night_id, no new table — PASS
- [x] 3-column uniform grid, square thumbnails, Spacing.xs gap — PASS
- [x] 20px circular avatar overlay, bottom-left, initials-based — PASS
- [x] Section header "Photos" with count — PASS
- [x] Hidden when zero photos and no add button — PASS
- [x] Tapping opens full-screen lightbox with close button — PASS
- [x] Per-participant photo strip unchanged — PASS

**Post-Round Photo Additions**
- [x] "Add Photos" button on revealed/closed rounds — PASS
- [x] Opens camera/library picker — PASS
- [x] Uploads to entry_photos linked to user's entry — PASS
- [x] Hidden if user has no entry — PASS
- [x] Photos appear after upload (invalidate query) — PASS (sort_order overflow fixed)
- [x] No time cutoff — PASS

**MultiPhotoRow Component Extraction**
- [x] components/MultiPhotoRow.tsx exists — PASS
- [x] Accepts photos, maxPhotos, onAdd, onRemove, onRetry, palette — PASS
- [x] create-entry.tsx uses MultiPhotoRow — PASS
- [x] table-night.tsx uses MultiPhotoRow — PASS
- [x] Visual behavior identical — PASS

**Data Fetching**
- [x] fetchNightPhotoPool returns { photo_url, user_id, entry_id, display_name } — PASS
- [x] Query key ['night-photos-pool', nightId] — PASS
- [x] staleTime: 1000 * 60 * 5 — PASS

Correctness: PASS — sort_order fix uses MAX+1 query, values stay in INTEGER range
Edge Cases: PASS — zero-photos case handled (single() silently returns null data, fallback to sort_order=1 works)
Error Handling: PASS — upload errors surfaced, camera permission handled
Security: PASS — RLS-based inserts, no service-role escalation
Performance: PASS — one extra query per upload is negligible
Design Compliance: PASS — follows existing patterns

Notes on fixes:
1. sort_order (table-night-detail.tsx:467-474): Correctly replaced Date.now() with MAX(sort_order)+1 query. Uses .single() which returns an error when 0 rows match, but the error is harmlessly ignored and the ?? 0 fallback produces sort_order=1. Using .maybeSingle() would be cleaner but is not blocking.
2. palette prop (table-night-detail.tsx:634-639): Removed from both call site and function signature. PhotoLightbox never referenced palette internally — removal is clean. TypeScript passes with no new errors.
3. handleAddPhoto deps (table-night-detail.tsx:548): Fix commit also added missing `uploadPhoto` to the useCallback dependency array — this was a correctness fix that prevents stale closure bugs.
```

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-16
- Final verdict: APPROVE (22 PASS / 0 WARN / 0 FAIL on review 2)
- Notes: Required 1 revision cycle to fix sort_order INTEGER overflow (Date.now() → MAX+1 query) and remove unused palette prop from PhotoLightbox.
