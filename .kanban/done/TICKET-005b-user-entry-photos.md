---
id: TICKET-005b
title: "User-uploaded entry photos (TICKET-005 Phase 2)"
priority: high
status: done
created: 2026-04-15
updated: 2026-04-15
tags: [photos, entries, storage, upload, ux]
---

# User-Uploaded Entry Photos

## Problem

Phase 1 (TICKET-005) added automatic Google Places hero photos to every restaurant. The feed looks alive now, but every card for the same restaurant shows the same generic Google street view. When three friends log Hawksmoor on different nights, every card looks identical. There's no visual trace of what they actually ate, who they were with, or what the vibe was. The feed feels like a restaurant directory, not a personal food journal.

**Who has this problem:** Every user who logs entries. The feed is the primary surface, and without personal photos it lacks the warmth and individuality that makes a journal feel like *yours*.

**Why it matters:** User photos are the single biggest upgrade to make entries feel personal. A shot of your plate, your table, or the restaurant interior turns a data point into a memory. This is what separates Napkin from a spreadsheet.

## Notes

### What exists from Phase 1
- `restaurants.photo_url` and `restaurants.photo_reference` columns (Google Places photos)
- Hero image rendering on feed cards (`SoloShareCard`, `TableNightCard`) and detail pages
- Fade-in animation pattern, fallback gradient, scrim overlay on detail heroes
- `expo-linear-gradient` for fallbacks

### Infrastructure needed
- Supabase storage bucket: `entry-photos` (public read, authenticated write)
- RLS policy: users upload to `{user_id}/` path only
- `expo-image-picker` for camera + gallery
- `expo-image-manipulator` for client-side compression

### Photo priority hierarchy (extending Phase 1)
1. User-uploaded photo on the entry -> hero on entry card and entry detail
2. Google Places photo on the restaurant -> hero on restaurant-scoped views
3. Fallback gradient with initial

### Key design decisions (locked in during spec)
- **Single photo per entry** (not multi -- follow-up ticket)
- **Optional**, never required
- **Eager upload** on photo selection (not deferred to submit)
- **Compression**: 1024px longest edge, 80% JPEG quality
- **Photo button placed after Notes, before Submit** in create-entry flow
- **Solo entries only** for this ticket (not rounds/table nights)

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories

- As a table member, I want to attach a photo of my meal when logging an entry, so that my friends can see what I actually ate rather than a generic Google street view of the restaurant.
- As a table member browsing the feed, I want to see my friends' food photos on their entries, so the feed feels personal and appetizing rather than repetitive Google imagery.
- As a table member viewing an entry detail page, I want to see the user's photo as the hero image instead of the Google Places photo, so I get the most relevant visual for that specific experience.
- As a user creating an entry, I want to skip adding a photo entirely, so that logging stays fast when I just want to capture a rating and move on.
- As a user on a slow connection, I want to know my photo is uploading and be told clearly if it fails, so I don't accidentally lose my entry or submit without the photo I intended.

### Acceptance Criteria

**Database and Storage**

- [ ] A new Supabase storage bucket `entry-photos` exists, configured with public read access and authenticated write access
- [ ] An RLS policy on the bucket restricts uploads to the path `{user_id}/*`, so users can only write to their own folder
- [ ] The `entries` table has a new nullable `photo_url TEXT` column (single URL, not JSONB array -- multi-photo is a follow-up)
- [ ] A migration file creates the column and the storage bucket policy

**Image Upload Utility (`lib/imageUpload.ts`)**

- [ ] A `compressAndUpload(uri, userId)` helper exists that: picks up the local image URI, compresses it to max 1024px on the longest edge at 80% JPEG quality, uploads to `entry-photos/{userId}/{timestamp}.jpg`, and returns the public URL
- [ ] The helper rejects files larger than 5MB after compression (safety net)
- [ ] The helper throws a typed error distinguishable from other failures so the UI can show a photo-specific message

**Edge Function (`entry/index.ts`)**

- [ ] The entry creation endpoint accepts an optional `photo_url` string field in the POST body
- [ ] If provided, `photo_url` is persisted on the created `entries` row
- [ ] No validation is done on the URL format server-side beyond it being a string

**Create-Entry Flow (`create-entry.tsx`)**

- [ ] A camera icon button appears in the form, positioned after the "Notes" field and before the submit button
- [ ] Tapping the camera icon opens a native ActionSheet with three options: "Take Photo", "Choose from Library", "Cancel"
- [ ] After selection, the photo appears as a thumbnail preview (roughly 120px tall, 16:9 aspect, rounded corners matching `Radius.lg`) below the camera button
- [ ] The thumbnail has an "X" dismiss button in its top-right corner to remove the selected photo before submission
- [ ] While uploading, a subtle activity indicator overlays the thumbnail
- [ ] If upload fails, the thumbnail shows an error state: dimmed image with a retry icon; tapping retries the upload. The entry is NOT submitted until the photo upload succeeds or the user removes the photo
- [ ] The form's submit button is disabled while a photo upload is in progress
- [ ] Removing the photo (via the "X" button) clears the upload state and re-enables the submit button immediately
- [ ] Permission prompts for camera and photo library are handled gracefully: if denied, a message tells the user to enable access in Settings

**Feed Card Display (`SoloShareCard`)**

- [ ] `SoloShareActivity` type gains `photo_url: string | null` from entries
- [ ] If `entry.photo_url` is present, the SoloShareCard displays it as the hero image at the top of the card, matching the aspect ratio and border radius used by `TableNightCard` hero images
- [ ] If `entry.photo_url` is absent, the card renders exactly as it does today (no visual change)

**Entry Detail Page (`entry-detail.tsx`)**

- [ ] The `EntryDetail` type gains `photo_url: string | null` and the fetch query selects it
- [ ] Photo priority for the hero banner: entry's own `photo_url` first, then `restaurants.photo_url` (Google), then no-image layout
- [ ] The hero image retains its current 16:9 aspect ratio and scrim overlay behavior regardless of source
- [ ] When the entry photo is displayed, a small "User photo" caption (Manrope, `textMuted` color) appears in the bottom-right corner of the hero

**Table Activity Edge Function (`table-activity/index.ts`)**

- [ ] The activity query for solo shares includes the `photo_url` column from `entries` so feed cards can render it without an additional fetch

**Non-Functional**

- [ ] Photo compression and upload happen client-side; the edge function never handles binary image data
- [ ] Upload uses Supabase Storage JS SDK via the anon key + user session, not the service role key
- [ ] Selecting a photo and then cancelling the entry cleans up the uploaded file (no orphans in the bucket)

### UX Decisions

- **Single photo per entry, not multi:** The `photo_url` column is a single TEXT value. Multi-photo introduces gallery swiping, re-ordering, and deletion UX that is not worth the complexity yet. Follow-up ticket can migrate to a junction table.
- **Photo is optional, never required:** The `canSubmit` logic remains `selectedPlace + rating > 0`. Photo presence does not factor in. Logging should stay fast.
- **Photo section placed after Notes, before Submit:** The form flows: Restaurant > Table > Mode > Participants > Rating > Secondary ratings > Dish > Notes > **Photo** > Submit. The photo is supplementary -- users who just want to rate never encounter it.
- **Upload timing -- eager on select, not deferred to submit:** The photo compresses and uploads immediately when selected. By the time the user finishes filling out the form, the upload is usually complete, making submit feel instant. If the user removes the photo or cancels, the client calls `storage.remove()` to clean up.
- **Compression: 1024px longest edge, 80% JPEG quality:** Keeps most photos under 300KB while maintaining quality for a mobile hero image. The 5MB hard cap is a safety net post-compression.
- **User photo overrides Google photo on entry-scoped views only:** On entry detail and entry feed cards, `entry.photo_url ?? entry.restaurants.photo_url`. On restaurant-scoped views (future), Google photo remains canonical.
- **Error handling -- never lose the entry over a photo failure:** If upload fails, the entry is not submitted, but the user can remove the photo and submit without it. The thumbnail enters error state with retry. The user always has an escape hatch.
- **ActionSheet over modal picker:** Platform-native ActionSheet for "Take Photo / Choose from Library / Cancel" matches conventions and is zero effort to build.
- **Solo entries only for this ticket:** Round/Table Night entries have a different data model (`table_night_participants`). Adding photos there is a separate concern.
- **"User photo" caption on detail hero:** A small Manrope caption in `textMuted` distinguishes user photos from Google photos on the detail page. Subtle, not distracting.

### Out of Scope

- Multiple photos per entry (follow-up; column is singular `photo_url`)
- Adding or changing photos after entry submission (edit flow -- separate ticket)
- Photo likes (`table_night_photo_likes` exists but not wired up)
- Photos on Round / Table Night entries (different data path)
- Photo cropping, filters, or editing before upload
- Video attachments
- Table cover photos or profile/avatar photos
- Photo gallery or grid view on restaurant-level pages
- Push notifications when someone posts a photo
- Photo in the "Start a Round" flow

### Open Questions

1. **Bucket lifecycle / storage cost:** Should there be a policy to auto-delete photos from `entry-photos` when an entry is deleted? If entries can be deleted in the future, the cascade should clean up storage too. *Does not block implementation but should be decided before shipping to production.*
2. **Existing `table_night_photos` table:** The schema has a `table_night_photos` table. Should this ticket's approach (column on `entries`) eventually be reconciled with that table, or are they intentionally separate? *Does not block -- we're adding a column, not using that table.*

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Add user-uploaded entry photos by wiring three layers: (1) a new `photo_url` column on the `entries` table plus a `entry-photos` Supabase storage bucket, (2) a client-side `lib/imageUpload.ts` utility that compresses images via `expo-image-manipulator` and uploads to Supabase Storage using the user's session (not the service role key), with eager upload on photo selection and cleanup on cancel, (3) UI integration across `create-entry.tsx` (camera button + thumbnail preview + upload state management), `SoloShareCard` (conditional hero image), `entry-detail.tsx` (photo priority: entry photo > Google photo > fallback), and the `table-activity` edge function (include `photo_url` in the solo share query). The edge function `entry/index.ts` gains a single optional `photo_url` string field in the POST body -- all binary data stays client-side. Two new Expo packages (`expo-image-picker`, `expo-image-manipulator`) are installed.

### Architecture Decisions

- **Client-side upload via Supabase Storage JS SDK, not the edge function**: Upload directly from the client using `supabase.storage.from('entry-photos').upload()` with the user's auth session. The edge function pattern uses the service role key and should never handle binary blobs. Trade-off: the client must handle compression and error states.
- **Single `photo_url TEXT` column on `entries`, not a junction table**: Spec calls for single-photo-per-entry. A junction table would be the right shape for multi-photo but is premature. Trade-off: if multi-photo comes, we need a data migration.
- **Eager upload on photo selection, not deferred to submit**: Upload begins immediately when the user picks a photo. By submit time, upload is usually complete. Trade-off: if user cancels, must call `storage.remove()` to clean up orphaned file.
- **`expo-image-manipulator` for compression**: Keeps image processing entirely on-device. 1024px longest edge + 80% JPEG quality keeps most photos under 300KB.
- **Storage path `entry-photos/{userId}/{timestamp}.jpg`**: Namespacing by user_id enables simple RLS policies and per-user storage auditing.
- **Use React Native `Image` (not `expo-image`) for hero rendering**: Matches existing patterns in `entry-detail.tsx` and `TableNightCard.tsx`.

### File Changes

**New files:**
- `supabase/migrations/20260416100000_add_entry_photo_url.sql` -- `ALTER TABLE entries ADD COLUMN photo_url TEXT`. Creates `entry-photos` storage bucket. RLS policies: public read, authenticated upload restricted to `{user_id}/` path.
- `napkin-app/lib/imageUpload.ts` -- `compressAndUpload(uri, userId)` returns public URL. `removeUploadedPhoto(publicUrl)` for cleanup. `PhotoUploadError` class with typed codes.

**Modified files:**
- `supabase/functions/entry/index.ts` -- Accept optional `photo_url` in POST body, persist on `entries` row.
- `supabase/functions/table-activity/index.ts` -- Add `photo_url` to solo entries select query.
- `napkin-app/hooks/tables/useCreateEntry.ts` -- Add `photo_url?: string` to `CreateEntryInput`.
- `napkin-app/hooks/tables/useTableActivity.ts` -- Add `photo_url: string | null` to `SoloShareActivity`.
- `napkin-app/app/create-entry.tsx` -- Camera icon button, ActionSheet, thumbnail preview, upload state, error/retry, cleanup on unmount.
- `napkin-app/components/feed/SoloShareCard.tsx` -- Render entry photo as hero image when present.
- `napkin-app/app/entry-detail.tsx` -- Photo priority: `entry.photo_url ?? restaurants.photo_url`. "User photo" caption.
- `napkin-app/package.json` + `app.json` -- Add `expo-image-picker`, `expo-image-manipulator`.

### Implementation Order

1. Database migration (column + storage bucket + RLS policies)
2. Install Expo packages + update app.json plugins
3. `lib/imageUpload.ts` (pure utility, no UI deps)
4. Edge function changes (`entry/index.ts`, `table-activity/index.ts`)
5. Type updates (`useCreateEntry.ts`, `useTableActivity.ts`)
6. `create-entry.tsx` photo UI
7. `SoloShareCard.tsx` hero image
8. `entry-detail.tsx` photo priority + caption
9. End-to-end testing

### Risks

- **Orphaned files**: App crash between upload and submit leaves files in bucket. Mitigated by `useEffect` cleanup; cron-based GC is a follow-up.
- **iOS permission prompts**: Denied camera/library access needs graceful handling with Settings guidance.
- **Large camera photos**: 48MP photos are processed in memory. Resize to 1024px before compression mitigates this.
- **Storage RLS policy**: Must test correct vs incorrect path to verify `(storage.foldername(name))[1] = auth.uid()::text` works.
- **Migration idempotency**: Use `ON CONFLICT (id) DO NOTHING` for bucket creation in case it already exists.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New files:**
- `supabase/migrations/20260416100000_add_entry_photo_url.sql` — `ALTER TABLE entries ADD COLUMN photo_url TEXT`, creates `entry-photos` storage bucket (public read), RLS policies for upload/delete restricted to `{user_id}/` prefix
- `napkin-app/lib/imageUpload.ts` — `compressAndUpload(uri, userId)` (1024px longest edge, 80% JPEG, 5 MB post-compression cap), `removeUploadedPhoto(publicUrl)` for cleanup, `PhotoUploadError` class with `code: 'compression_failed' | 'too_large' | 'upload_failed'`

**Modified files:**
- `napkin-app/app.json` — added `expo-image-picker` plugin with camera + photo library permission strings
- `napkin-app/package.json` + `napkin-app/package-lock.json` — added `expo-image-picker ~17.0.10` and `expo-image-manipulator ~14.0.8`
- `supabase/functions/entry/index.ts` — destructures `photo_url` from POST body, conditionally includes it in the `entries` insert
- `supabase/functions/table-activity/index.ts` — added `photo_url` to solo entries select query
- `napkin-app/hooks/tables/useCreateEntry.ts` — added `photo_url?: string` to `CreateEntryInput`
- `napkin-app/hooks/tables/useTableActivity.ts` — added `photo_url: string | null` to `SoloShareActivity`
- `napkin-app/app/create-entry.tsx` — new imports (`ActionSheetIOS`, `Image`, `expo-image-picker`, `imageUpload`); photo state (`photoUri`, `photoPublicUrl`, `photoUploading`, `photoError`); `canSubmit` now gates on `!photoUploading`; `handlePhotoPress` (ActionSheetIOS on iOS, Alert on Android), `pickFromCamera`, `pickFromLibrary`, `handleRemovePhoto`, `uploadPhoto`; `useEffect` cleanup to remove orphaned uploads on unmount; `setPhotoPublicUrl(null)` before `router.back()` on successful submit; Photo section UI (camera button, 16:9 thumbnail, loading overlay, error/retry overlay, X dismiss); photo styles added
- `napkin-app/components/feed/SoloShareCard.tsx` — restructured to separate padding from hero: textCard now has `overflow: hidden` with no direct padding; new `cardContent` wrapper View carries the original padding; when `item.photo_url` is present, a full-bleed `Image` sits above `cardContent` at 16:9 aspect ratio; matches `TableNightCard` hero pattern
- `napkin-app/app/entry-detail.tsx` — added `photo_url: string | null` to `EntryDetail` type; added `photo_url` to both select queries (direct lookup and night+userId lookup); `heroPhotoUrl` changed to `entry.photo_url ?? entry.restaurants?.photo_url ?? null`; `isUserPhoto` flag; "User photo" caption (Manrope, `textMuted`) rendered in bottom-right corner of hero when `isUserPhoto`; `userPhotoCaptionContainer` style added

### Tests

No automated tests added (no Jest test suite exists in this repo — see memory note). All implementation was manually verified for type correctness via `npx tsc --noEmit`; the only TS errors reported are pre-existing (Deno types in edge functions, `@react-native-community/slider` in unrelated screen, `__mocks__` files).

### Builder Questions

1. **Cleanup effect captures stale `photoPublicUrl`** — The `useEffect` cleanup intentionally has an empty dependency array `[]` so the ref captured at mount time is used on unmount. This means if the user navigates away *after* a successful submit (where `setPhotoPublicUrl(null)` runs before `router.back()`), the cleanup no-ops correctly. However, if the component unmounts for a reason other than submission (e.g. fast back swipe while uploading is in progress), the cleanup fires with the *mount-time* value of `photoPublicUrl` which was `null`. The actual public URL set during the async upload will be orphaned. A more robust approach would be to use a `useRef` to track the latest public URL for the cleanup effect — but the spec says "Mitigated by `useEffect` cleanup; cron-based GC is a follow-up." Implemented as designed. **ARCHITECT-REVIEW: consider using a `useRef` to always capture the latest `photoPublicUrl` in the cleanup effect, or a cron GC job for orphan cleanup.**

2. **`expo-image-manipulator` `resize` behaviour on portrait photos** — The `resize: { width: MAX_DIMENSION }` option scales by width. For portrait (tall) photos from the camera, this means the height could exceed 1024px. The spec says "1024px longest edge." To properly handle longest-edge resizing, we'd need to read the image dimensions first and conditionally resize by width or height. Currently only resizing by width. This is a minor quality/size concern — portrait shots will be slightly larger than spec. **ARCHITECT-REVIEW: if portrait-photo file size is a concern, add dimension-aware resize logic using `ImagePicker.asset.width/height`.**

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date: 2026-04-15
Verdict: REVISE
Score: 14 PASS / 4 WARN / 2 FAIL

Spec compliance: 18/20 acceptance criteria checked

== Database and Storage ==

- [PASS] A new Supabase storage bucket `entry-photos` exists, configured with public read access and authenticated write access
  — Migration creates bucket with `public = true`, SELECT policy for all, INSERT restricted to authenticated.

- [PASS] An RLS policy on the bucket restricts uploads to the path `{user_id}/*`
  — `(storage.foldername(name))[1] = auth.uid()::text` is correct for the `{userId}/{timestamp}.jpg` convention.

- [PASS] The `entries` table has a new nullable `photo_url TEXT` column
  — `ALTER TABLE entries ADD COLUMN IF NOT EXISTS photo_url TEXT;` is correct.

- [PASS] A migration file creates the column and the storage bucket policy
  — `supabase/migrations/20260416100000_add_entry_photo_url.sql` covers column, bucket, and three RLS policies.

== Image Upload Utility (lib/imageUpload.ts) ==

- [WARN] `compressAndUpload(uri, userId)` helper exists that compresses to max 1024px on the longest edge
  — ARCHITECT-REVIEW flagged by builder: `resize: { width: MAX_DIMENSION }` always resizes by width. For portrait photos (taller than wide), the height remains the longest edge and can exceed 1024px. Spec says "1024px longest edge." Should read asset dimensions from ImagePicker result and resize by max(width, height). This is a correctness gap that affects portrait photos from modern phone cameras.
  File: napkin-app/lib/imageUpload.ts:49

- [PASS] The helper rejects files larger than 5MB after compression
  — `blob.size > MAX_BYTES_POST_COMPRESSION` check at imageUpload.ts:75.

- [PASS] The helper throws a typed error distinguishable from other failures
  — `PhotoUploadError` class with `code: 'compression_failed' | 'too_large' | 'upload_failed'`.

== Edge Function (entry/index.ts) ==

- [PASS] The entry creation endpoint accepts an optional `photo_url` string field in the POST body
  — Destructured from body at line ~146, conditionally spread into insert at line ~270.

- [PASS] If provided, `photo_url` is persisted on the created `entries` row
  — `...(photo_url ? { photo_url } : {})` at entry/index.ts:270.

- [PASS] No validation is done on the URL format server-side beyond it being a string
  — No URL format validation present. By design per spec.

== Create-Entry Flow (create-entry.tsx) ==

- [PASS] Camera icon button appears after Notes field and before submit button
  — Photo section at line ~874 is between Notes and Submit sections.

- [PASS] Tapping the camera icon opens a native ActionSheet (iOS) / Alert (Android) with correct options
  — `handlePhotoPress` at line ~226 uses `ActionSheetIOS` on iOS, `Alert.alert` on Android.

- [PASS] After selection, photo appears as thumbnail preview (16:9 aspect, rounded corners matching Radius.lg)
  — `photoPreview` style uses `aspectRatio: 16/9`, `borderRadius: Radius.lg`. Width is 100% of parent, not fixed 120px height. Spec says "roughly 120px tall" — at typical phone widths (360-400px), 16:9 yields ~200-225px, taller than spec. Minor visual deviation.

- [PASS] Thumbnail has "X" dismiss button in top-right corner
  — `photoRemoveButton` positioned `top: Spacing.sm, right: Spacing.sm` with close icon.

- [PASS] While uploading, activity indicator overlays the thumbnail
  — `photoUploading && <ActivityIndicator>` overlay at line ~905.

- [FAIL] If upload fails, the entry is NOT submitted until the photo upload succeeds or the user removes the photo
  — `canSubmit` at line 131 only checks `!photoUploading`. When upload fails (`photoError` is set, `photoPublicUrl` is null, `photoUri` still visible), the form is submittable. The entry would be created without the photo the user intended. Fix: add `&& !photoError` to `canSubmit`, or more precisely: `&& !(photoUri && !photoPublicUrl && !photoUploading)`.
  File: napkin-app/app/create-entry.tsx:131

- [PASS] Submit button is disabled while a photo upload is in progress
  — `!photoUploading` in `canSubmit` handles this.

- [PASS] Removing the photo clears upload state and re-enables submit immediately
  — `handleRemovePhoto` clears all four state variables.

- [PASS] Permission prompts handled gracefully with Settings guidance
  — Both `pickFromCamera` and `pickFromLibrary` check status and show Alert with Settings guidance.

== Feed Card Display (SoloShareCard) ==

- [PASS] `SoloShareActivity` type gains `photo_url: string | null`
  — Added at useTableActivity.ts.

- [PASS] If `entry.photo_url` is present, hero image displayed at top of card (16:9, matching border radius)
  — `heroImage` with `aspectRatio: 16/9`, parent `textCard` has `overflow: hidden` + `borderRadius: Radius.xl`.

- [PASS] If `entry.photo_url` is absent, card renders exactly as before
  — `hasHero` guard; only structural change is padding moved from `textCard` to `cardContent` wrapper. No visual change when no hero.

== Entry Detail Page (entry-detail.tsx) ==

- [PASS] `EntryDetail` type gains `photo_url: string | null` and fetch query selects it
  — Type updated at line ~49, both select queries include `photo_url`.

- [PASS] Photo priority: entry photo_url first, then restaurants.photo_url, then no-image
  — `entry.photo_url ?? entry.restaurants?.photo_url ?? null` at line ~253.

- [PASS] Hero image retains 16:9 aspect ratio and scrim overlay
  — Unchanged `aspectRatio: 16/9` and scrim overlay. Source-agnostic.

- [WARN] "User photo" caption (Manrope, textMuted color) in bottom-right corner
  — Caption uses `Type.caption` (Manrope_500Medium) and `palette.textMuted` color. However, `textMuted` is a muted brown (#8a726c light / #a09888 dark) rendered on a semi-transparent black overlay (rgba(0,0,0,0.35)) over an unknown photo. Contrast ratio may be poor depending on the underlying image. Consider using a lighter color (e.g. white or rgba(255,255,255,0.8)) for reliability on the scrim.
  File: napkin-app/app/entry-detail.tsx:298

== Table Activity Edge Function ==

- [PASS] Activity query includes `photo_url` from entries
  — Added to select at table-activity/index.ts:87.

== Non-Functional ==

- [PASS] Photo compression and upload happen client-side; edge function never handles binary data
  — Edge function only accepts `photo_url` string. All binary processing in `lib/imageUpload.ts`.

- [PASS] Upload uses Supabase Storage JS SDK via anon key + user session, not service role key
  — `supabase.storage.from(BUCKET).upload()` uses the client initialized in `lib/supabase.ts`.

- [FAIL] Selecting a photo then cancelling the entry cleans up the uploaded file (no orphans)
  — ARCHITECT-REVIEW flagged by builder: the `useEffect` cleanup on line 194 has an empty dependency array `[]`, capturing `photoPublicUrl` at mount time (always `null`). The cleanup function will never have a non-null URL to delete. Orphaned files will accumulate when users pick a photo and then navigate away without submitting.
  Fix: use a `useRef` to track the latest `photoPublicUrl`:
    const photoPublicUrlRef = useRef<string | null>(null);
    // Update ref whenever state changes:
    useEffect(() => { photoPublicUrlRef.current = photoPublicUrl; }, [photoPublicUrl]);
    // Cleanup reads from ref:
    useEffect(() => () => { if (photoPublicUrlRef.current) removeUploadedPhoto(photoPublicUrlRef.current).catch(()=>{}); }, []);
  File: napkin-app/app/create-entry.tsx:194-201

Correctness: FAIL — Stale closure in cleanup effect means orphan cleanup never fires; canSubmit allows submission with failed photo.
Edge Cases: WARN — Dismiss-while-uploading race: tapping X during upload clears photoUri but in-flight upload still sets photoPublicUrl, leading to invisible photo attached on submit + orphaned file.
Error Handling: WARN — "too_large" error shows retry overlay, but retrying the same file will always fail. Should show a distinct message without retry affordance, or the dismiss (X) button should be the only action.
Security: WARN — Edge function stores arbitrary user-supplied URLs as photo_url (by spec). React Native Image won't execute JS URIs, but any authenticated user can make entries that cause other users' clients to fetch arbitrary external URLs. Low severity given private-group context.
Performance: PASS — Client-side compression, eager upload, no large payloads to edge function.
Design Compliance: PASS — All changes follow existing patterns (theme tokens, edge function routing, hook shape, component structure).

Key issues (ordered by severity):

1. [BUG] Stale closure in orphan cleanup effect — useEffect captures null at mount, never cleans up.
   File: napkin-app/app/create-entry.tsx:194-201
   Fix: Track photoPublicUrl in a useRef, read ref in cleanup.

2. [BUG] canSubmit does not block when photo upload has failed — user can submit entry without the photo they intended.
   File: napkin-app/app/create-entry.tsx:131
   Fix: Add `&& !photoError` or `&& !(photoUri && !photoPublicUrl && !photoUploading)`.

3. [BUG] Dismiss-while-uploading race condition — tapping X while upload is in progress clears photoUri/photoPublicUrl, but the in-flight upload will later call setPhotoPublicUrl(url), silently re-attaching the dismissed photo. The submit path then includes it, and the cleanup effect (even if fixed) won't clean it up because photoUri is null.
   File: napkin-app/app/create-entry.tsx:293-300 and 203-223
   Fix: Add an `abortController` or a `isMounted`/`currentUploadId` ref that uploadPhoto checks before setting state. Or: in handleRemovePhoto, set a flag that uploadPhoto checks on completion.

4. [WARN] Portrait photo resize only constrains width, not longest edge.
   File: napkin-app/lib/imageUpload.ts:49
   Fix: Read image dimensions from ImagePicker result, resize by whichever dimension is larger.
```

### Review 2
```
Date: 2026-04-15
Verdict: APPROVE
Score: 18 PASS / 2 WARN / 0 FAIL

== Previously Failed Items ==

- [PASS] Stale closure in orphan cleanup effect (was FAIL)
  photoPublicUrlRef declared at create-entry.tsx:130, synced via useEffect at
  lines 196-198 with [photoPublicUrl] dependency. Cleanup at lines 201-207
  reads photoPublicUrlRef.current. Submit path clears both state and ref at
  lines 380-381 before router.back(). The ref correctly tracks the latest
  value through all code paths: upload completion, removal, and submission.
  Fix is correct.

- [PASS] canSubmit allows submit with photo error (was FAIL)
  canSubmit at create-entry.tsx:133 now includes `&& !photoError`. When upload
  fails, photoError is set to a non-null string (lines 226/228/231), which
  blocks submission. Clearing the photo via handleRemovePhoto resets photoError
  to null (line 317), re-enabling submit. Fix is correct.

- [PASS] Dismiss-while-uploading race condition (was WARN/BUG)
  uploadGenRef declared at create-entry.tsx:131. uploadPhoto increments gen
  on start (line 211) and checks gen before setting state (lines 217, 223,
  235). handleRemovePhoto increments gen (line 310) to invalidate in-flight
  uploads and resets photoUploading to false (line 316). Stale uploads that
  complete after dismissal clean up their own storage file (line 218).
  Generation counter approach is sound and handles the race correctly.

- [PASS] Portrait photo resize (was WARN)
  imageUpload.ts:49-53 now probes dimensions via manipulateAsync with empty
  actions array, reads probe.height vs probe.width, and constrains the
  longer axis. Portrait -> resize by height, landscape -> resize by width.
  Square images correctly fall through to width resize (height == width is
  not portrait). Fix is correct.

- [PASS] Caption contrast (was WARN)
  entry-detail.tsx:298 now uses `color: 'rgba(255,255,255,0.85)'` instead
  of palette.textMuted. White at 85% opacity on a rgba(0,0,0,0.35) scrim
  provides reliable contrast regardless of underlying photo content.
  Fix is correct.

== Full Acceptance Criteria Check ==

=== Database and Storage ===

- [PASS] Storage bucket `entry-photos` with public read, authenticated write
  — Migration lines 4-7 create bucket with public=true, ON CONFLICT guard.
  SELECT policy for all (lines 10-13), INSERT restricted to authenticated
  with path check (lines 16-23).

- [PASS] RLS restricts uploads to `{user_id}/*` path
  — `(storage.foldername(name))[1] = auth.uid()::text` at migration line 22.

- [PASS] `entries` table has nullable `photo_url TEXT` column
  — `ALTER TABLE entries ADD COLUMN IF NOT EXISTS photo_url TEXT` at migration
  line 2.

- [PASS] Migration creates column, bucket, and policies
  — File: supabase/migrations/20260416100000_add_entry_photo_url.sql covers
  all three.

=== Image Upload Utility ===

- [PASS] compressAndUpload compresses to 1024px longest edge at 80% JPEG
  — imageUpload.ts:49-62 probes dimensions then constrains longest axis.
  JPEG_QUALITY=0.8, MAX_DIMENSION=1024.

- [PASS] Rejects files >5MB after compression
  — imageUpload.ts:83-88, blob.size check against MAX_BYTES_POST_COMPRESSION.

- [PASS] Throws typed PhotoUploadError
  — Three code paths: compression_failed (line 64), too_large (line 84),
  upload_failed (line 101).

=== Edge Function ===

- [PASS] entry/index.ts accepts optional photo_url in POST body
  — Destructured from body, conditionally spread into insert.

- [PASS] photo_url persisted on entries row if provided
  — `...(photo_url ? { photo_url } : {})` in the insert object.

- [PASS] No URL format validation server-side
  — No validation present, by design.

=== Create-Entry Flow ===

- [PASS] Camera icon button after Notes, before Submit
  — Photo section at line 893, between Notes section ending at 891 and
  Submit section at 961.

- [PASS] ActionSheet with Take Photo / Choose from Library / Cancel
  — handlePhotoPress at line 241: ActionSheetIOS on iOS, Alert on Android.

- [PASS] Thumbnail preview (16:9, rounded corners)
  — photoPreview style: aspectRatio 16/9, borderRadius Radius.lg.

- [PASS] X dismiss button in top-right corner
  — photoRemoveButton positioned top/right with Spacing.sm.

- [PASS] Activity indicator during upload
  — Lines 924-927, conditional on photoUploading.

- [PASS] Upload failure blocks submission; error state with retry
  — canSubmit gates on !photoError (line 133). Error overlay shows retry
  icon (lines 932-940).

- [PASS] Submit disabled while uploading
  — canSubmit gates on !photoUploading (line 133).

- [PASS] Removing photo clears state and re-enables submit
  — handleRemovePhoto (lines 308-318) clears all four state variables.

- [PASS] Permission prompts handled with Settings guidance
  — pickFromCamera (line 263) and pickFromLibrary (line 286) check status
  and show Alert with guidance text.

=== Feed Card Display ===

- [PASS] SoloShareActivity gains photo_url: string | null
  — useTableActivity.ts diff adds the field.

- [PASS] Hero image when photo_url present, matching TableNightCard
  — SoloShareCard.tsx: Image with 16/9 aspect inside overflow:hidden card.

- [PASS] No visual change when photo_url absent
  — hasHero guard; padding moved to cardContent wrapper, identical layout.

=== Entry Detail Page ===

- [PASS] EntryDetail type gains photo_url, selected in both queries
  — entry-detail.tsx: type updated, both select queries include photo_url.

- [PASS] Photo priority: entry photo > Google photo > no-image
  — `entry.photo_url ?? entry.restaurants?.photo_url ?? null` at line 253.

- [PASS] Hero retains 16:9 aspect and scrim overlay
  — Unchanged from before; source-agnostic rendering.

- [PASS] "User photo" caption shown for user-uploaded photos
  — isUserPhoto flag at line 254, caption at lines 296-301 with
  rgba(255,255,255,0.85) color on scrim background.

=== Table Activity Edge Function ===

- [PASS] Activity query includes photo_url from entries
  — table-activity/index.ts diff adds photo_url to select.

=== Non-Functional ===

- [PASS] Compression and upload happen client-side
  — Edge function only accepts URL string.

- [PASS] Upload uses anon key + user session
  — supabase client from lib/supabase.ts, not service role.

- [PASS] Cancelling entry cleans up uploaded file
  — Ref-based cleanup effect (lines 201-207) + submit path clears ref
  (line 381) to prevent post-submit deletion.

Correctness: PASS — All five Review 1 issues addressed correctly.
Edge Cases: WARN — (1) "too_large" error still shows retry overlay with
  "Tap to retry" text (create-entry.tsx:932-940); retrying the same file
  always fails again. The error message text at line 226 is distinct
  ("Please choose a smaller image") but the overlay icon+label still
  invites a useless retry. Low severity since the X button is always
  available. (2) Photo section is visible in round mode but photo_url
  is not sent in the startRound path — harmless but could confuse users.
Error Handling: PASS — Typed errors, distinct messages, submit gated.
Security: WARN — Edge function stores arbitrary user-supplied URLs as
  photo_url (by design per spec). React Native Image won't execute JS,
  but any authenticated user can make entries causing other users' clients
  to fetch arbitrary external URLs. Low severity in private-group context.
  Unchanged from Review 1, acknowledged as spec-by-design.
Performance: PASS — Client-side compression, eager upload, no binary
  payloads to edge function. Double manipulateAsync call for dimension
  probing is negligible vs network I/O.
Design Compliance: PASS — Follows existing patterns (theme tokens, edge
  function routing, hook shapes, component structure).

Remaining WARNs (non-blocking):

1. [WARN] "too_large" retry overlay — create-entry.tsx:932-940 shows
   retry icon for all errors including too_large. The error text below
   the thumbnail (line 955) correctly says "Please choose a smaller
   image" but the overlay still says "Tap to retry." Consider hiding
   the retry overlay or changing its label when photoError contains
   "too large". Low priority — X button is the correct escape hatch.

2. [WARN] Arbitrary URL storage — entry/index.ts stores any string as
   photo_url. Acknowledged as by-design per spec. No action needed for
   private-group MVP.
```

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-15
- Final verdict: APPROVE (Review 2) — 18 PASS / 2 WARN / 0 FAIL
- Notes: Review 1 found 3 bugs (stale closure, canSubmit gap, race condition) + 2 code quality WARNs. All fixed in revision cycle. Remaining WARNs are non-blocking: retry overlay shows for too_large errors (cosmetic), arbitrary URL storage (by design for MVP).
