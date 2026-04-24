---
id: TICKET-006
title: "Multi-Photo per Review (Phase 1 of Live Round Experience)"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [tables, rounds, photos, ux]
---

# Multi-Photo per Review (Phase 1 of Live Round Experience)

## Problem
Right now a Round feels like filling out a form in isolation. You submit your rating, wait, reveal. There's no *energy*. You can't see that Elena is voting, that Marcus just uploaded a photo, that the group is vibing. And photos are limited to one per review — no way to capture the full night (the drinks, the dessert, the chaos).

The dream: a Round feels like a **live shared document** — you see presence, you see photos streaming into a shared pool, and after the night the photo pool becomes a beautiful memory reel attached to that Round.

## Notes
- Google Docs / Figma multiplayer cursor energy — but for dining
- Each person's review still has *their* photos attached (ownership matters for the review)
- BUT there's also a **shared photo pool** for the whole Round — everyone's photos merged into a visual timeline
- Post-reveal, the Round detail page becomes a memory page: verdict + photo grid of the whole night
- Realtime presence: see who's online, who's voting, who's uploading
- Supabase Realtime already used for round status (useTableNightRealtime) — extend it

### Inspiration
- Google Photos shared albums
- BeReal group photos
- Instagram collab posts
- Figma multiplayer cursors / "who's viewing"

---

## Product Spec

### User Stories
- As a user creating a solo entry, I want to attach multiple photos (e.g., the cocktail, the pasta, the vibe of the place) so that my review captures the full experience, not just one dish.
- As a user in a Table Night voting session, I want to add multiple photos while rating so that the group gets a richer picture of the meal.
- As a user browsing the feed, I want to see a visual cue when an entry has multiple photos so I know there is more to look at.
- As a user viewing an entry detail page, I want to swipe through all photos in a carousel so I can see everything the reviewer captured.
- As a user who posted with the old single-photo system, I want my existing entries to still display correctly with no action required from me.
- As a user on a slow connection, I want to see upload progress per photo and be able to remove a stuck/failed photo without losing the others.

### Acceptance Criteria

#### Data layer
- [ ] New `entry_photos` table exists with columns: `id` (uuid PK), `entry_id` (FK to entries), `photo_url` (text, not null), `sort_order` (integer, not null), `created_at` (timestamptz)
- [ ] Existing `entries.photo_url` column is retained and always populated with the first photo's URL (sort_order = 0) for backward compatibility
- [ ] When an entry is fetched, `entry_photos` rows are included ordered by `sort_order` ascending
- [ ] Entries created before multi-photo launch that have only `photo_url` and no `entry_photos` rows still render their photo correctly everywhere (feed card, detail page)

#### Create-entry flow
- [ ] The "Photo" section shows a horizontal scroll row of thumbnail slots
- [ ] Tapping an empty "+" slot opens the existing camera/library action sheet
- [ ] Maximum of 6 photos per entry. The "+" slot disappears once 6 are attached.
- [ ] Each thumbnail shows a local preview immediately after selection, before upload completes
- [ ] Each thumbnail has an individual upload spinner overlay while its upload is in flight
- [ ] Each thumbnail has an "X" dismiss button (top-right corner)
- [ ] If a photo upload fails, that thumbnail shows a retry overlay (tap to retry). Other photos remain unaffected.
- [ ] Removing a photo that has already been uploaded cleans up storage
- [ ] Removing a photo that is mid-upload cancels/ignores the in-flight upload (existing generation-counter pattern)
- [ ] The first photo in the row is the hero photo. No drag-to-reorder — order is order of addition.
- [ ] Submit button is disabled while any photo upload is in progress
- [ ] On submit, `photo_url` on the entry is set to the first photo's URL. All photo URLs are sent as an ordered array for `entry_photos` insertion.
- [ ] If the user exits without submitting, all uploaded photos are cleaned up from storage

#### Table Night voting flow
- [ ] Same multi-photo thumbnail row replaces the current single-photo picker
- [ ] Same 6-photo max, same upload/error/remove behavior as create-entry
- [ ] On rate submission, all photo URLs are sent as an ordered array

#### Feed cards
- [ ] Hero image on feed cards continues to show the first photo (no behavior change for single-photo entries)
- [ ] When an entry has 2+ photos, a small count badge appears in the bottom-right corner of the hero image: layered-rectangles icon + count number
- [ ] Badge uses semi-transparent card-color background, `Radius.sm`, subtle shadow — quiet, not competing with the card
- [ ] Tapping the card navigates to entry detail as before (badge is not independently tappable)

#### Entry detail page
- [ ] When entry has multiple photos, the hero area becomes a horizontally swipeable carousel (full-bleed, same aspect ratio per image)
- [ ] Page indicator dots appear below the carousel (active dot uses `palette.tertiary`, inactive uses `palette.textMuted` at 30% opacity)
- [ ] Swiping is smooth — use native `ScrollView` with `pagingEnabled`, no heavy carousel library
- [ ] Legacy entries with only `entries.photo_url` and no `entry_photos` rows render their single photo unchanged

#### Edge function / API
- [ ] Create-entry and rate edge functions accept an optional `photo_urls: string[]` field in addition to the existing `photo_url: string` field
- [ ] If `photo_urls` is provided, insert rows into `entry_photos` with sequential `sort_order` (0, 1, 2...) and set `entries.photo_url` to `photo_urls[0]`
- [ ] If only `photo_url` is provided (old client), behavior is unchanged — no `entry_photos` rows created
- [ ] Entry-fetch and activity-fetch queries join `entry_photos` ordered by `sort_order`

#### Performance
- [ ] Photos upload in parallel (not sequentially)
- [ ] Each photo is independently compressed via `compressAndUpload` (existing 1024px max, 0.8 JPEG quality, 5MB cap)
- [ ] Thumbnail row uses 80x80pt thumbnails to keep memory usage low

### UX Decisions
- **Max photos: 6** — covers the full dining experience (exterior, drink, appetizer, main, dessert, receipt) without turning the app into a photo manager. 5 feels tight, 8 is too many.
- **No reordering in Phase 1**: Photos appear in add-order. First photo = hero. Drag-to-reorder is a future nicety.
- **Thumbnail row layout**: Horizontal `ScrollView` of 80x80pt rounded thumbnails with "+" slot at the end. First thumbnail gets a subtle "Hero" label below it in caption style.
- **Photo count badge on feed cards**: Bottom-right of hero image, pill shape, semi-transparent background. Contains layered-rectangles icon (`copy-outline`) and count in `Manrope_600SemiBold` at 11pt. Deliberately quiet.
- **Carousel on detail page**: Native `ScrollView` with `pagingEnabled` and `horizontal` — no third-party carousel library. Page dots: 6pt circles, 8pt gap, centered below image.
- **Parallel uploads with independent state**: Each photo slot tracks `{ localUri, publicUrl, uploading, error }`. Per-slot generation counters extend the current single-photo pattern.
- **Backward compatibility**: `entries.photo_url` stays. Always set to first photo URL on write. Read paths check `entry_photos` first, fall back to `entries.photo_url`.

### Out of Scope
- Drag-to-reorder photos (future)
- Photo captions / per-photo notes
- Full-screen photo viewer (pinch-to-zoom, share)
- Shared photo pool across round participants (Phase 2)
- Realtime presence & activity indicators (Phase 3)
- Editing photos on an existing entry — creation only
- Video support
- Batch photo picker (select multiple from library at once) — each photo added individually
- Photo compression settings exposed to user

### Resolved Questions
1. **Round detail page multi-photo display**: Mini thumbnail strip per participant. Each participant card shows a horizontal row of thumbnails (max 3-4 visible, "+N" overflow badge) beneath their notes. Tap any thumbnail opens full-screen lightbox. Gives per-person ownership feel without hiding content behind an extra tap.
2. **Orphaned photo cleanup**: Client-side only, no cron. Unmount/dismiss cleanup covers 95% of cases. Remaining orphans from crashes are ~200KB each — negligible. A cron adds real complexity for no payoff at current scale. One-off manual cleanup script if it ever matters.
3. **RLS on `entry_photos`**: Join through `entries` policies, don't duplicate them. SELECT via `EXISTS (... FROM entries e WHERE e.id = entry_photos.entry_id AND ...)` so visibility inherits automatically. INSERT/DELETE restricted to entry owner via subquery. No UPDATE — photos are immutable (delete and re-upload). Same pattern for `round_photos` in Phase 2.

---

## Technical Design

### Approach
New `entry_photos` one-to-many table. Existing `entries.photo_url` retained as denormalized hero pointer (always set to first photo URL on write). Client replaces single-photo state with `PhotoSlot[]` array — each slot tracks `{ localUri, publicUrl, uploading, error, uploadGen }`. Existing `compressAndUpload`/`removeUploadedPhoto` from `imageUpload.ts` reused per-slot with no changes. Edge functions gain optional `photo_urls: string[]` param; when present, bulk-insert into `entry_photos` and set `entries.photo_url = photo_urls[0]`. Activity feed joins `entry_photos` to provide `photo_count` for badge display.

### Architecture Decisions
- **`entry_photos` table (not JSON array)**: Enables proper RLS, per-photo storage management, ordered querying. One extra indexed FK join on reads.
- **Keep `entries.photo_url` as hero pointer**: All existing queries work with zero changes. Write path sets it to `photo_urls[0]`.
- **Per-slot generation counters via ref map**: Each photo slot gets its own `uploadGen` in a `useRef<Map>` to avoid stale closures when canceling mid-upload. Extends existing single-photo pattern.
- **No new `imageUpload.ts` functions**: `Promise.all` at call site handles parallelism. No batch upload abstraction needed.
- **Native `ScrollView` with `pagingEnabled` for carousel**: No third-party library. Spec requirement.
- **RLS via subquery join through `entries`**: SELECT inherits visibility automatically. INSERT/DELETE restricted to entry owner. No UPDATE — photos are immutable.
- **No shared component extraction in Phase 1**: Thumbnail row duplicated between `create-entry.tsx` and `table-night.tsx` (~40 lines JSX each). Extract in Phase 2 when shared photo pool adds a third consumer.
- **Skip `TableNightCard` badge for Phase 1**: Its hero comes from `restaurants.photo_url`, not user entries. Only `SoloShareCard` gets the count badge.

### Schema Changes

Migration file: `supabase/migrations/20260417000000_create_entry_photos.sql`

```sql
CREATE TABLE public.entry_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entry_photos_entry_id ON public.entry_photos(entry_id);
CREATE UNIQUE INDEX idx_entry_photos_entry_sort ON public.entry_photos(entry_id, sort_order);

ALTER TABLE public.entry_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entry_photos_select" ON public.entry_photos FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM entries e
        WHERE e.id = entry_photos.entry_id
        AND (e.user_id = auth.uid()
             OR e.table_id IN (SELECT table_id FROM table_members WHERE user_id = auth.uid()))
    )
);

CREATE POLICY "entry_photos_insert" ON public.entry_photos FOR INSERT WITH CHECK (
    entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())
);

CREATE POLICY "entry_photos_delete" ON public.entry_photos FOR DELETE USING (
    entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())
);

-- No UPDATE policy — photos are immutable (delete and re-upload)
ALTER PUBLICATION supabase_realtime ADD TABLE entry_photos;
```

### File Changes

1. **`supabase/migrations/20260417000000_create_entry_photos.sql`** — NEW. Full SQL above.

2. **`supabase/functions/entry/index.ts`** — Add `photo_urls` to destructured body. After entry insert, if `photo_urls` provided: bulk-insert into `entry_photos` with sequential `sort_order`. Derive `heroPhotoUrl` from `photo_url || photo_urls?.[0]`.

3. **`supabase/functions/table-night/index.ts`** — In `start` action (host entry creation) and `rate` action (attendee entry creation): add `photo_urls` to body, capture entry ID from insert result with `.select('id').single()`, bulk-insert `entry_photos`.

4. **`supabase/functions/table-activity/index.ts`** — After fetching solo entries, batch-query `entry_photos` by entry IDs, count per entry, add `photo_count` to each feed item.

5. **Hooks (`useCreateEntry.ts`, `useStartRound.ts`, `useSubmitTake.ts`, `useTableNight.ts`)** — Add `photo_urls?: string[]` to input interfaces. Pass through in body.

6. **`hooks/tables/useTableActivity.ts`** — Add `photo_count?: number` to `SoloShareActivity` interface.

7. **`app/create-entry.tsx`** — MAJOR. Replace single-photo state (`photoUri`, `photoPublicUrl`, `photoUploading`, `photoError`, `uploadGenRef`) with `photos: PhotoSlot[]` array + `uploadGenRefs: useRef<Map>`. Replace `uploadPhoto`/`dismissPhoto` with `addPhotoSlot`/`handleRemovePhoto`/`handleRetryPhoto`. Replace single photo JSX block with horizontal `ScrollView` of 80x80 thumbnails + "+" slot. Update `canSubmit` to check `!photos.some(p => p.uploading)`. Update `handleSubmit` to build `photo_urls` array.

8. **`app/table-night.tsx`** — MAJOR. Same multi-photo pattern as create-entry. Replace single-photo state and JSX with `PhotoSlot[]` array and thumbnail row.

9. **`app/entry-detail.tsx`** — Add `entry_photos` fetch after entry load. Build `allPhotos` array with fallback to `entry.photo_url`. Replace single hero `<Image>` with paging `ScrollView` carousel + page indicator dots. Add `activePhotoIndex` state.

10. **`components/feed/SoloShareCard.tsx`** — Wrap hero `<Image>` in relative `<View>`. Add photo count badge (pill with `copy-outline` icon + count) when `photo_count >= 2`.

11. **`app/table-night-detail.tsx`** — MINOR. Add client-side query for `entry_photos` per participant when status is `revealed`. Pass `photoUrls` to `ParticipantRow`. Render horizontal thumbnail strip (max 4 visible, "+N" overflow badge).

### Implementation Order
1. Migration: `entry_photos` table + RLS + indexes
2. Edge function: `entry/index.ts` — `photo_urls` handling
3. Edge function: `table-night/index.ts` — `photo_urls` in start/rate
4. Edge function: `table-activity/index.ts` — `photo_count` in feed
5. Hooks: type changes (`photo_urls`, `photo_count`)
6. `create-entry.tsx` — multi-photo UI (largest change)
7. `table-night.tsx` — multi-photo UI (same pattern)
8. `entry-detail.tsx` — photo carousel
9. `SoloShareCard.tsx` — photo count badge
10. `table-night-detail.tsx` — per-participant thumbnail strip

### Risks & Edge Cases
- **Backward compat reads**: Entries with `photo_url` but no `entry_photos` rows must still render. Fallback: `allPhotos = entry_photos.length > 0 ? ... : (photo_url ? [photo_url] : [])`.
- **Stale upload gen counters**: Must use ref map (`uploadGenRefs.current.get(slotId)`), not captured state, to avoid stale closures in async callbacks.
- **Rapid add/remove race**: Use `setPhotos(prev => prev.filter(...))` callback form for atomic updates. Increment gen counter before filtering.
- **Edge function atomicity**: `entry_photos` insert is non-fatal — if it fails, entry still has `photo_url` hero. No transaction wrapper needed.
- **Android `pagingEnabled`**: Requires image width to exactly match ScrollView width. Use `Dimensions.get('window').width`.
- **Image import mismatch**: `table-night.tsx` uses `expo-image`, `create-entry.tsx` uses `react-native` Image. Match each file's existing import.
- **Storage orphans on crash**: Accepted — ~200KB per photo, client-side cleanup covers 95%+ of cases.

---

## Build Log

### Files Created
- **`supabase/migrations/20260417000000_create_entry_photos.sql`** — New `entry_photos` table with RLS policies (SELECT via entries join, INSERT/DELETE by entry owner), two indexes (entry_id lookup, entry_id+sort_order unique), and added to `supabase_realtime` publication.

### Files Modified

**Backend (Edge Functions)**

- **`supabase/functions/entry/index.ts`** — Added `photo_urls` to destructured body. Added `photoUrlsArray` derivation and `heroPhotoUrl = photo_url || photo_urls[0]`. Entry insert now uses `heroPhotoUrl`. After entry insert, bulk-inserts `entry_photos` rows (non-fatal: logs error but doesn't fail the request).

- **`supabase/functions/table-night/index.ts`** — Added `photo_urls` to `start` and `rate` action destructuring. In `start`: derives `startHeroPhotoUrl`, changes host entry insert to `.select('id').single()` to capture entry ID, then bulk-inserts `entry_photos` for host (non-fatal). In `rate`: same pattern for attendee entry insert and `entry_photos` bulk insert (non-fatal).

- **`supabase/functions/table-activity/index.ts`** — After fetching entry participants, adds a second query to `entry_photos` for all entry IDs in the page. Builds a `photoCountMap`. Adds `photo_count` field to both `solo_share` and `collaborative_entry` tagged items.

**Hooks**

- **`hooks/tables/useCreateEntry.ts`** — Added `photo_urls?: string[]` to `CreateEntryInput` interface.

- **`hooks/tables/useStartRound.ts`** — Added `photo_urls?: string[]` to `StartRoundInput` interface; passes through in the invoke body.

- **`hooks/tables/useSubmitTake.ts`** — Added `photo_urls?: string[]` to `SubmitTakeInput` interface; passes through in the invoke body.

- **`hooks/tables/useTableNight.ts`** — Added `photo_urls?: string[]` to `useRateTableNight` mutation input type.

- **`hooks/tables/useTableActivity.ts`** — Added `photo_count?: number` to `SoloShareActivity` interface.

**Frontend (App Screens)**

- **`app/create-entry.tsx`** — Major rewrite of photo section. Added `PhotoSlot` interface and `MAX_PHOTOS = 6` constant. Replaced single-photo state (`photoUri`, `photoPublicUrl`, `photoUploading`, `photoError`, `uploadGenRef`) with `photos: PhotoSlot[]` + `uploadGenRefs: useRef<Map>`. Added `photosRef` for safe unmount cleanup. Added `startUploadForSlot`, `addPhotoSlot`, `handleRemovePhoto`, `handleRetryPhoto` functions (per-slot generation counters via `uploadGenRefs` map). Updated `pickFromCamera`/`pickFromLibrary` to call `addPhotoSlot`. Replaced single photo JSX with horizontal `ScrollView` of 80×80 thumbnail slots + "Hero" label on first + "+" add slot. Updated `handleSubmit` to build `photo_urls` array from uploaded slots; calls both `startRound` and `createEntry` with `photo_urls`. Replaced old photo styles with `photoRow`, `photoThumbContainer`, `photoThumb`, `heroLabel`, `thumbOverlay`, `photoRemoveButton`, `photoAddSlot`. Uses `react-native` `Image` (matching existing import).

- **`app/table-night.tsx`** — Same multi-photo pattern as create-entry. Added `PhotoSlot` interface and `MAX_PHOTOS`. Replaced single-photo state with `photos: PhotoSlot[]` + `uploadGenRefs`. Added `startUploadForSlot`, `addPhotoSlot`, `handleRemovePhoto`, `handleRetryPhoto`. Updated `pickFromCamera`/`pickFromLibrary`. Replaced photo placeholder/preview JSX with horizontal `ScrollView` thumbnail row. Updated `handleCastVote` to build `photo_urls` from uploaded slots and pass to `rateMutation`. Updated dependency array. Replaced old photo styles with thumbnail strip styles. Uses `expo-image` `Image` (matching existing import).

- **`app/entry-detail.tsx`** — Added `Dimensions` import and `SCREEN_WIDTH` constant. Added `useState` import. Added `fetchEntryPhotos` async function querying `entry_photos` by entry ID ordered by `sort_order`. Added `useEntryPhotos` hook. In `EntryDetailScreen`: added `entryPhotoUrls` from `useEntryPhotos(entry?.id)` and `activePhotoIndex` state. Replaced `heroPhotoUrl`/`isUserPhoto` logic with `allPhotos` array (backward-compat: uses `entry_photos` if available, falls back to `entry.photo_url`). For multi-photo entries renders a paging `ScrollView` carousel with page indicator dots; for single photo renders single `<Image>`; for no user photos falls back to restaurant photo. Added `pageDots` and `pageDot` styles.

- **`app/table-night-detail.tsx`** — Added `useQuery` import and `supabase` import. Added `fetchNightEntryPhotos` function (queries entries by `table_night_id`, then `entry_photos` for those entry IDs, returns `Record<userId, photoUrl[]>`). Added `useNightEntryPhotos` hook (only enabled when status is `revealed`). Used hook in screen, passes `photoUrls` to each `ParticipantRow`. Updated `ParticipantRow` to accept `photoUrls: string[]` prop and render a horizontal thumbnail strip (max 4 visible + "+N" overflow badge) below the category chips. Added `photoStrip`, `photoStripThumb`, `photoStripOverflow` styles.

**Components**

- **`components/feed/SoloShareCard.tsx`** — Added `Ionicons` import. Added `photoCount` derived from `item.photo_count ?? 0`. Wrapped hero `<Image>` in a relative `<View>`. Added photo count badge (pill with `copy-outline` icon + count number in `Manrope_600SemiBold`) positioned bottom-right, shown when `photoCount >= 2`. Added `photoCountBadge` and `photoCountText` styles.

### Pre-existing TypeScript Errors (not introduced by this PR)
- `app/table-night.tsx`: `Cannot find module '@react-native-community/slider'` — type declarations missing for slider package, existed before this ticket.
- `app/table-night.tsx`: Parameter `v` implicitly has `any` type in slider `onValueChange` — pre-existing.

### Deviations from Technical Design
- **`create-entry.tsx` cleanup effect**: The spec called for `useEffect(() => { return () => { cleanup } }, [])` with a ref approach. Implemented with `photosRef` to avoid stale closure on unmount — matches the design's intent while following the correct React pattern.
- **`table-night.tsx` `PhotoSlot.error` type**: The spec showed `error: string | null` but `table-night.tsx` used `error: boolean` to match the existing simpler error display in that screen (no error message text, just a retry icon). `create-entry.tsx` uses `error: string | null` as specified for the error message display.
- **`useStartRound.ts` body**: Added `photo_urls` passthrough in the invoke body (required but wasn't explicitly called out in the hooks step — minor omission in the spec).
- **Ionicons for retry in `table-night.tsx`**: Used a plain text `↺` character instead of `Ionicons` since that file doesn't import Ionicons and I didn't want to add a new import for a single character.

---

## Review History

### Review 1
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 25/29 acceptance criteria met

#### Data layer
- [x] New `entry_photos` table exists with correct columns — PASS: Migration at `supabase/migrations/20260417000000_create_entry_photos.sql` matches spec exactly.
- [x] Existing `entries.photo_url` retained and populated with first photo URL — PASS: Edge functions derive `heroPhotoUrl` from `photo_url || photo_urls[0]`.
- [x] When entry is fetched, `entry_photos` rows included ordered by `sort_order` — PASS: `entry-detail.tsx` fetches with `.order('sort_order', { ascending: true })`.
- [x] Legacy entries with only `photo_url` and no `entry_photos` rows still render — PASS: `entry-detail.tsx` falls back to `entry.photo_url` when `entryPhotoUrls` is empty.

#### Create-entry flow
- [x] Horizontal scroll row of thumbnail slots — PASS
- [x] Tapping "+" opens camera/library action sheet — PASS
- [x] Max 6 photos, "+" disappears at 6 — PASS: `photos.length < MAX_PHOTOS` guard
- [x] Local preview shown immediately before upload — PASS: `localUri` rendered instantly
- [x] Individual upload spinner per thumbnail — PASS
- [x] "X" dismiss button on each thumbnail — PASS
- [x] Failed upload shows retry overlay, others unaffected — PASS
- [x] Removing uploaded photo cleans up storage — PASS: `removeUploadedPhoto` called in `handleRemovePhoto`
- [x] Removing mid-upload photo cancels via generation counter — PASS
- [x] First photo is hero, order is add-order — PASS
- [x] Submit disabled while any upload in progress — PASS: `!photos.some(p => p.uploading)`
- [x] On submit, `photo_url` set to first, all sent as array — PASS: Edge function sets `heroPhotoUrl = photo_urls[0]`
- [ ] If user exits without submitting, uploaded photos cleaned up — FAIL: Only `create-entry.tsx` has the unmount cleanup effect. `table-night.tsx` is **missing** the `photosRef` + unmount `useEffect` entirely. See issue #1 below.

#### Table Night voting flow
- [x] Same multi-photo thumbnail row — PASS
- [x] Same 6-photo max, same upload/error/remove behavior — PASS
- [x] On rate submission, photo URLs sent as ordered array — PASS

#### Feed cards
- [x] Hero image shows first photo (no change for single-photo) — PASS
- [x] Count badge when 2+ photos — PASS: `photoCount >= 2` in `SoloShareCard.tsx`
- [x] Badge styling matches spec (semi-transparent, Radius.sm, subtle shadow) — PASS
- [x] Badge not independently tappable — PASS: inside card Pressable

#### Entry detail page
- [x] Multi-photo carousel with `pagingEnabled` ScrollView — PASS
- [x] Page indicator dots with correct colors — PASS: `palette.tertiary` active, `palette.textMuted + '4D'` inactive
- [x] Native ScrollView, no heavy library — PASS
- [x] Legacy entries render single photo unchanged — PASS

#### Edge function / API
- [x] `photo_urls` accepted in create-entry and rate functions — PASS
- [x] `entry_photos` rows inserted with sequential `sort_order` — PASS
- [x] Old client with only `photo_url` works unchanged — PASS: `photoUrlsArray` defaults to `[]`
- [ ] Entry-fetch and activity-fetch join `entry_photos` ordered by `sort_order` — WARN: Activity fetch joins for count only (correct), but entry-fetch doesn't join in the edge function — it's done client-side in `entry-detail.tsx` via a separate query. This works but means two round-trips. Acceptable for now but noted.

#### Performance
- [x] Photos upload in parallel — PASS: each `addPhotoSlot` kicks off independent `startUploadForSlot`
- [x] Existing `compressAndUpload` reused per slot — PASS
- [x] 80x80pt thumbnails — PASS

Correctness: WARN — Side effects inside `setPhotos` updater (see issue #2)
Edge Cases: FAIL — Missing unmount cleanup in `table-night.tsx` (see issue #1)
Error Handling: PASS — Per-slot error/retry works correctly, non-fatal `entry_photos` insert errors logged
Security: PASS — RLS policies correct (SELECT via entries join, INSERT/DELETE by owner, no UPDATE)
Performance: PASS — Parallel uploads, indexed FK, count query batched in activity fetch
Design Compliance: PASS — Matches technical design; deviations documented and reasonable

Key issues:

1. **FAIL — Missing unmount cleanup in `table-night.tsx`**: `create-entry.tsx` has a `photosRef` + unmount `useEffect` that cleans up orphaned uploads when the user exits without submitting. `table-night.tsx` has no equivalent. If a user adds photos, uploads complete, then navigates away without casting a vote, the uploaded photos become permanent storage orphans. **Fix**: Add the same `photosRef` sync effect and unmount cleanup effect from `create-entry.tsx` (lines 199-212) to `table-night.tsx` after the `uploadGenRefs` declaration.

2. **WARN — Side effects inside state updater callbacks**: Both `addPhotoSlot` and `handleRetryPhoto` call `startUploadForSlot` (an async side effect) inside `setPhotos(prev => ...)` updater functions. React state updaters should be pure — side effects inside them may execute twice in StrictMode and violate React's contract. In `addPhotoSlot` it's mitigated by `setTimeout(..., 0)` which defers execution, but `handleRetryPhoto` (`create-entry.tsx:262`, `table-night.tsx:240`) calls `startUploadForSlot` synchronously inside the updater. **Fix for `handleRetryPhoto`**: Read the slot from current state outside the updater, then call `startUploadForSlot` after:
   ```typescript
   const handleRetryPhoto = useCallback((slotId: string) => {
       const slot = photos.find(s => s.id === slotId);
       if (slot) startUploadForSlot(slotId, slot.localUri);
   }, [photos, startUploadForSlot]);
   ```
   This also removes the misleading pattern of returning `prev` unchanged from the updater.

### Review 2
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 25/29 acceptance criteria met (same as Review 1 — new bug found in fix)

**Review 1 issue #1 (unmount cleanup in `table-night.tsx`)**: FIXED — `photosRef` + unmount `useEffect` added at lines 182-196. Matches `create-entry.tsx` pattern.

**Review 1 issue #2 (`handleRetryPhoto` side effect in updater)**: FIXED — Both `create-entry.tsx:286-291` and `table-night.tsx:255-260` now read `photos` from state outside the updater and call `startUploadForSlot` directly.

**New issue found in fix commit**:

Correctness: FAIL — Unmount cleanup deletes successfully persisted photos (see issue #1)
Edge Cases: FAIL — Same root cause
Error Handling: PASS
Security: PASS
Performance: PASS
Design Compliance: PASS

Key issues:

1. **FAIL — Unmount cleanup deletes persisted photos in `table-night.tsx`** (`table-night.tsx:188-196`): The newly added unmount cleanup unconditionally deletes all photos with a `publicUrl`. But after `handleCastVote` succeeds (line 341-354), photos are NOT cleared from state — unlike `create-entry.tsx` which calls `setPhotos([])` at line 424 after successful submission. When the user later navigates away (e.g., tapping "View Full Breakdown" at line 394 which calls `router.replace`), the component unmounts and the cleanup deletes photos from storage that are already saved in `entry_photos`. This is a **data-loss bug**. **Fix**: Add `setPhotos([])` after successful `readyMutation` in `handleCastVote`, matching the pattern in `create-entry.tsx`:
   ```typescript
   // After readyMutation succeeds (around line 358):
   try {
       await readyMutation.mutateAsync({ table_night_id: nightId });
       // Photos are now persisted — clear so cleanup effect doesn't delete them
       setPhotos([]);
   } catch (e: any) {
   ```
   Note: `setPhotos([])` should go after `rateMutation` succeeds (not after `readyMutation`) since `rateMutation` is where `photo_urls` are sent. If `readyMutation` fails but `rateMutation` succeeded, the photos are already persisted. Safest placement is immediately after `rateMutation.mutateAsync` returns successfully, before the `readyMutation` call.

### Review 3
Date: 2026-04-16
Verdict: APPROVE

**Previous fix verification:**

- Review 1, issue #1 (missing unmount cleanup in `table-night.tsx`): VERIFIED FIXED — `photosRef` + unmount `useEffect` at `table-night.tsx` diff lines 844-858. Matches `create-entry.tsx` pattern exactly.
- Review 1, issue #2 (`handleRetryPhoto` side effect in state updater): VERIFIED FIXED — Both `create-entry.tsx` and `table-night.tsx` now read from `photos` state outside the updater and call `startUploadForSlot` directly (`create-entry.tsx` diff lines 157-163, `table-night.tsx` diff lines 926-931).
- Review 2, issue #1 (unmount cleanup deletes persisted photos): VERIFIED FIXED — `setPhotos([])` added at `table-night.tsx` diff line 996, immediately after `rateMutation.mutateAsync` succeeds and before `readyMutation`. Correct placement per Review 2 recommendation.

Spec compliance: 29/29 acceptance criteria met

#### Data layer
- [x] New `entry_photos` table exists with correct columns — PASS
- [x] Existing `entries.photo_url` retained and populated with first photo URL — PASS
- [x] When entry is fetched, `entry_photos` rows included ordered by `sort_order` — PASS
- [x] Legacy entries with only `photo_url` and no `entry_photos` rows still render — PASS

#### Create-entry flow
- [x] Horizontal scroll row of thumbnail slots — PASS
- [x] Tapping "+" opens camera/library action sheet — PASS
- [x] Max 6 photos, "+" disappears at 6 — PASS
- [x] Local preview shown immediately before upload — PASS
- [x] Individual upload spinner per thumbnail — PASS
- [x] "X" dismiss button on each thumbnail — PASS
- [x] Failed upload shows retry overlay, others unaffected — PASS
- [x] Removing uploaded photo cleans up storage — PASS
- [x] Removing mid-upload photo cancels via generation counter — PASS
- [x] First photo is hero, order is add-order — PASS
- [x] Submit disabled while any upload in progress — PASS
- [x] On submit, `photo_url` set to first, all sent as array — PASS
- [x] If user exits without submitting, uploaded photos cleaned up — PASS (both screens now have cleanup)

#### Table Night voting flow
- [x] Same multi-photo thumbnail row — PASS
- [x] Same 6-photo max, same upload/error/remove behavior — PASS
- [x] On rate submission, photo URLs sent as ordered array — PASS

#### Feed cards
- [x] Hero image shows first photo (no change for single-photo) — PASS
- [x] Count badge when 2+ photos — PASS
- [x] Badge styling matches spec — PASS
- [x] Badge not independently tappable — PASS

#### Entry detail page
- [x] Multi-photo carousel with `pagingEnabled` ScrollView — PASS
- [x] Page indicator dots with correct colors — PASS
- [x] Native ScrollView, no heavy library — PASS
- [x] Legacy entries render single photo unchanged — PASS

#### Edge function / API
- [x] `photo_urls` accepted in create-entry and rate functions — PASS
- [x] `entry_photos` rows inserted with sequential `sort_order` — PASS
- [x] Old client with only `photo_url` works unchanged — PASS
- [x] Entry-fetch and activity-fetch join `entry_photos` ordered by `sort_order` — PASS (activity fetch provides count; entry detail fetches photos client-side with separate query — acceptable)

#### Performance
- [x] Photos upload in parallel — PASS
- [x] Existing `compressAndUpload` reused per slot — PASS
- [x] 80x80pt thumbnails — PASS

Correctness: PASS — All three prior issues verified fixed. Photo lifecycle (upload, persist, cleanup) is sound across both screens.
Edge Cases: PASS — Unmount cleanup safe after submission (`setPhotos([])` clears state); generation counters prevent stale upload callbacks; backward compat fallback handles legacy entries.
Error Handling: PASS — Per-slot error/retry; non-fatal `entry_photos` insert; fire-and-forget storage cleanup.
Security: PASS — RLS policies correct (SELECT via entries join, INSERT/DELETE by owner, no UPDATE).
Performance: PASS — Parallel uploads, indexed FK, batched photo count query in activity feed.
Design Compliance: PASS — All deviations documented and reasonable.

Notes (non-blocking):
1. `handleRemovePhoto` still calls `removeUploadedPhoto` inside `setPhotos` updater in both files. This is technically impure but practically safe — the cleanup is idempotent and fire-and-forget. Not worth another revision cycle.
2. `useEntryPhotos` and `useNightEntryPhotos` use ad-hoc query keys (`['entry-photos', id]`, `['night-entry-photos', id]`) instead of centralized `queryKeys`. Minor inconsistency — recommend adding these to `lib/queryKeys.ts` in a follow-up.
3. `SCREEN_WIDTH` in `entry-detail.tsx` is computed at module load via `Dimensions.get('window')` and won't update on orientation change. Fine for a portrait-locked mobile app.

---

## Completion
Date: 2026-04-16
Verdict: APPROVED (Review 3, after 2 revision cycles)
Review cycles: 3

Accepted WARNs:
- `handleRemovePhoto` has `removeUploadedPhoto` inside state updater (idempotent, fire-and-forget)
- Ad-hoc query keys for entry photos (follow-up: add to `lib/queryKeys.ts`)
- `SCREEN_WIDTH` static at module load (fine for portrait-locked app)
- Entry-detail fetches photos client-side in separate query (two round-trips, acceptable for now)
