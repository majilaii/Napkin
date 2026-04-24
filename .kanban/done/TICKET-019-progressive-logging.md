---
id: TICKET-019
title: "Progressive logging (rate now, flesh out later)"
priority: medium
status: done
created: 2026-04-17
updated: 2026-04-17
tags: [logging, ergonomics, composer]
---

# Progressive logging

## Problem

The current entry composer asks for a rating plus category breakdowns, a note, optional photos. TICKET-011 (now deleted) would have made it even heavier (occasion, price, companions, craving). The direction was wrong — more fields in the composer means fewer logs.

Letterboxd's model is better: you can **mark a movie watched in one tap** (rating only) and return later to write a review if the mood strikes. Most films get silent ratings; a small fraction get prose. Both paths produce value.

Napkin should do the same. Let the user tap a rating and move on. Let them come back when they want to flesh it out with notes, photos, category breakdowns. The journal gets more entries; the entries that *should* be reviews get real attention.

## Notes

### Locked decisions (from brainstorm, 2026-04-17)

- **Supersedes TICKET-011** — that ticket's pile-more-fields-into-composer direction is explicitly rejected.
- **Two-step logging:**
  1. **Fast log:** rating (0.5–5.0) + restaurant + Table. Optional one-tap "liked it / didn't" if we want a Letterboxd-style thumbs toggle. That's it.
  2. **Flesh out:** from the entry detail screen, edit-in-place to add note, photos, category breakdowns, any of the current fields.
- Current composer becomes the "flesh out" surface by default, with an abbreviated quick-log mode as the primary entry.
- Quick log should be reachable from multiple surfaces: the `+` tab, restaurant page ("Log a visit"), Round flow.
- Fleshing out an entry later should feel zero-friction — entry detail has a prominent "Add note," "Add photos," etc. affordance.

### Open questions for product-designer

- Is the quick log a single screen or a bottom-sheet over the current surface?
- Do we preserve the current composer for users who *want* to write full reviews on first log, or force everyone through quick-first?
- When a user returns to edit, should the entry's `updated_at` or similar change? Does it re-surface in Table feeds? (Instinct: no, feeds are creation-ordered, not edit-ordered.)
- Does "flesh out later" include changing the rating, or only additive fields? (Instinct: rating is editable; this is a personal journal.)
- Letterboxd-style "liked it" thumb alongside the rating — include or skip?

### Dependencies

- None. Can be built any time after current composer is stable.

### Relationship to other tickets

- Companion to TICKET-018 (Lists): progressive logging makes logs cheap, which makes lists richer (more data to curate from).
- Unblocks TICKET-021 (Public reviews on restaurant pages) by distinguishing casual ratings from crafted reviews — the public layer surfaces the latter, not the former.

---

## Product Spec

### User Stories

- As a **solo logger remembering a meal from earlier**, I want to tap the `+` tab, pick the restaurant, drag a rating, and be done in under 10 seconds, so that logging doesn't feel like homework.
- As a **user on a restaurant page who just left the place**, I want to rate it without leaving the page, so that the hero number updates in front of me and I'm not kicked into a multi-step composer.
- As a **user reviewing my journal later that evening**, I want the entries I fast-logged to surface affordances to add notes, photos, a dish, or category ratings inline on the entry detail, so that I can come back to the ones that deserve prose without re-navigating a composer.
- As a **user who changed my mind about a meal**, I want to edit the overall rating on an existing entry, so that my journal reflects how I actually feel now — this is a personal record, not a published review.
- As a **user who fast-logged a ghost restaurant**, I want the entry to persist the restaurant silently so I never see a "creating restaurant..." state, and my later flesh-out flow should behave identically to a fleshed-out log against a known restaurant.
- As a **Table member starting dinner together**, I want kicking off a Round to still collect the restaurant and the group's attendees up-front (that's the point of a Round), so that the Round experience isn't degraded by this change — fast log applies to solo-first surfaces.
- As a **first-time user landing on the `+` tab**, I want the minimum needed to log to be visually obvious (rating + restaurant + Table), so that I don't abandon before submitting.
- As a **user adding a photo a day later**, I want photo upload and note-adding to feel like editing my own page — not opening a composer — so that the act of fleshing out feels low-stakes.

### Acceptance Criteria

**Fast-log surface (the primary flow)**

- [ ] Tapping the `+` tab opens the **fast-log screen** (full-screen modal), not the current heavy composer. This is a rewrite of what `/create-entry` renders by default.
- [ ] The fast-log screen collects only three things, stacked vertically: **restaurant**, **rating** (0.5–5.0 half-step), **Table** (post-to target). Nothing else is visible above the fold.
- [ ] Restaurant field behaves as the existing Places-backed search: debounced autocomplete, tap to select, tap X to clear. Prefill via `restaurantId` / `placePayload` / ghost payload params is preserved from the current composer.
- [ ] Rating control is the existing `StarRating` at size 36 with `showValue`. No rating = can't submit.
- [ ] Table picker is a horizontal chip row matching the current composer; defaults to the user's **personal Table** unless `tableId` is passed as a route param or only one Table is applicable.
- [ ] A primary CTA labeled **"Log it"** (uppercase, Manrope, existing pill style) sits above the keyboard when rating is set. Disabled state when restaurant or rating is missing.
- [ ] On submit, the entry is created with `rating`, `restaurant_id` (or ghost upsert), `table_id`, and no other fields. `content`, `dish_description`, `photo_urls`, and all secondary ratings are omitted — the existing `useCreateEntry` mutation already accepts absent fields.
- [ ] After successful submit, the modal dismisses. No toast, no intermediate confirmation screen. The feed/journal reflects the new entry on next foreground.
- [ ] An **"Add details"** secondary affordance sits below the primary CTA. Tapping it pushes (not replaces) into the existing full composer with the restaurant / Table / rating already set and the same submission target, so a power user who wants to write prose-first can still do it in one session.

**Restaurant page entry point**

- [ ] On the restaurant page, tapping **"Log a visit" → "Solo log"** opens the fast-log screen in-context, with the restaurant prefilled and locked (no restaurant search field shown). The user cannot change the restaurant from this entry point.
- [ ] When launched from the restaurant page, the fast-log screen is presented as a **bottom sheet** over the restaurant page (not a full-screen modal), so the user sees the page's hero numbers update after submit. Height: tall enough for rating + Table picker + CTA + "Add details" affordance; ≥60% of viewport.
- [ ] On submit from the bottom sheet, the sheet dismisses and the restaurant page's `useRestaurantPage` query invalidates so the personal average and visit count refresh in place.
- [ ] "Start a Round here" from `LogVisitSheet` is unchanged by this ticket — it still routes to the full composer with `mode=round` prefilled. (Rounds are a group event; they are not fast-logged.)

**Flesh-out surface (entry detail)**

- [ ] On `entry-detail` for an entry authored by the viewing user, the screen exposes edit affordances for every field that the fast-log omits. Other users' entries remain read-only.
- [ ] The rating bubble is tappable for own entries, opening an inline rating picker (reuses `StarRating` editable). Save on blur/confirm; optimistic update.
- [ ] When the entry has **no notes**, a muted "Add a note" row appears in the Notes section slot. Tapping expands into a multi-line text input inline (same styling as the composer's notes field); save on blur or explicit "Save" button.
- [ ] When the entry has notes, tapping the notes card puts it into edit mode with the existing text seeded. Cancel discards; Save persists.
- [ ] When the entry has **no photos**, a muted "Add photos" row appears in place of the hero photo area. Tapping opens the existing `ActionSheetIOS` / Alert pattern (camera vs library) and the `MultiPhotoRow` inline. Uploads happen immediately, same code path as the composer.
- [ ] When the entry has photos, the carousel still renders; a small edit control (pencil icon, top-right of the hero area, below the back button's safe-area offset) opens the same photo management UI to add or remove photos.
- [ ] When the entry has **no dish**, a muted "Add a dish" row appears in the Dish section slot. Tapping opens a single-line text input inline. Save on blur.
- [ ] When the entry has **no category breakdowns** (all four of `vibe/flavor/service/value` are null), a muted "Rate the details" row appears in the Breakdown slot. Tapping expands the four-row `StarRating` grid inline (reusing the composer's secondary-ratings UI). Each row saves optimistically on change.
- [ ] When some category breakdowns are set, the existing Breakdown grid still renders but each `StarRating` becomes editable for own entries. Changes save optimistically per-cell.
- [ ] All inline edits call an existing or new `useUpdateEntry(entryId)` mutation that does a single `PATCH` against the `entries` table (or an edge-function action, per the technical call). On error, the UI reverts and shows an inline error state on the affected field only — the whole page does not re-render with an error banner.
- [ ] Any successful edit invalidates `queryKeys.entries.detail(entryId)` and the Table/journal feed that surfaces this entry, but **does not change `created_at`** or the feed sort order (see UX Decisions).

**Rounds are unaffected**

- [ ] Starting a Round from `LogVisitSheet`, from the `+` tab's "Add details → Round" path, or from any Table activity surface still opens the full composer with mode=round, because Rounds require restaurant + attendees + rating up-front. No fast-log entry point for Rounds exists in v1.
- [ ] A Round participant's individual take (the `entries` row with `table_night_id` set) can still be fleshed out from its entry detail using the same rules as solo entries.

**State handling**

- [ ] Fast-log screen shows the submit button in a loading state during the create mutation; disabled until rating is set.
- [ ] If the ghost upsert fails on submit, an inline error appears above the CTA with a retry button; the partially-entered rating and restaurant are preserved.
- [ ] On entry-detail, inline edits show a compact inline spinner on the affected field while in flight (not a screen-wide indicator).
- [ ] Each inline edit field has a single error state: revert + red inline helper text ("Couldn't save. Try again."). No modals.

### UX Decisions

- **Surface shape is entry-point-dependent**: the `+` tab opens fast-log as a **full-screen modal** (it's the user's declared intent; they expect to go somewhere); the restaurant page opens fast-log as a **bottom sheet** (the user is still reading the page and wants to see it update in-place). Same component, two presentation modes via a `presentation` prop. This resolves the open question without adding a separate screen for each entry point.
- **Force quick-first for everyone; full composer becomes the flesh-out path**: no preference, no toggle, no "always show me the full composer" setting. Rationale: the whole point of this ticket is that more fields → fewer logs. An opt-in power-user path exists via the "Add details" link at the bottom of fast-log, which pushes into the current composer. This keeps the full composer available without asking the common case to pay for it.
- **Rating is editable during flesh-out**: the journal is personal, not a published review. Edits do not timestamp or re-surface the entry. Rationale: Letterboxd treats ratings as updatable; our model is stricter about feed ordering but looser about journal truth.
- **Edits do not change feed order**: `created_at` is the sort key; `updated_at` exists on the row but the feed does not read it. An entry fleshed out a week later stays where it was in the Table timeline. Rationale: feeds are a record of the *meal*, not the *writing*; resurfacing would spam Tablemates and reward retouching for attention.
- **No Letterboxd-style thumbs in v1**: skip. Rationale: scope is already meaningful; a redundant affordance alongside the 5-star rating confuses data model and UI. Revisit if users ask.
- **Inline edit, not edit-mode screen**: every flesh-out action happens in place on the entry detail. No "Edit entry" toggle. Rationale: the journal metaphor — you write in the margins, you don't open a separate editor.
- **Fast-log does not show secondary fields collapsed**: they are fully absent from the fast-log screen, not hidden behind a chevron. Rationale: presence implies expectation. "Add details" as a single secondary affordance is clearer than five collapsible sections the user has to mentally dismiss.
- **Rounds keep the heavy composer**: a Round requires restaurant + attendee selection + a rating per participant — fast-log cannot collapse that. The new flow applies to solo logs only.
- **Ghost restaurant behavior is unchanged**: the silent upsert from TICKET-014 / TICKET-016 is invoked identically from fast-log and from flesh-out. No new ghost surface area.
- **Default Table is personal unless overridden**: the fast-log Table picker defaults to the user's personal Table (consistent with current composer behavior when `tableId` is absent). Users with only a personal Table see the chip as non-interactive.
- **Edit affordances only render for own entries**: a Tablemate viewing someone else's entry detail sees the existing read-only layout, not muted "Add a note" rows. Check is `entry.user_id === viewer.id`.

### Out of Scope

- Any public-facing layer: profile, lists, world-browsable reviews. (TICKET-021 / future.)
- Changing the Round flow. Rounds remain on the full composer path.
- Editing someone else's entry. Edits are own-entry only.
- Editing the restaurant or Table of an existing entry (these are identity, not content). A fast-logged entry is stuck to the restaurant and Table it was created against; moving it between Tables or re-pointing to a different restaurant is explicitly out of scope.
- Deleting an entry from entry-detail (existing behavior stays; no new delete surface here).
- Letterboxd-style "liked it" toggle (thumbs).
- Push notifications to remind users to flesh out their recent fast-logs.
- Occasion / price / companions / craving fields (TICKET-011's rejected direction — do not re-introduce).
- Any change to how entries surface in the feed. Feed order, card shape, and reactions/replies are untouched.
- Undo for inline edits. A mis-tap on the rating bubble saves the new value; there's no inline "undo" affordance in v1.
- Offline/queued logging. Fast-log still requires network at submit; a failed submit shows the retry path described in Acceptance Criteria.

### Open Questions

- **Resolved — ready to build.** All five brainstorm questions have locked decisions above. One flag for the builder: the inline edit mutation surface (`useUpdateEntry`) does not exist yet and is the only new hook in this ticket; the builder should confirm during tech design whether it's a thin `entries` PATCH via supabase-js (likely fine given RLS on `entries`) or a new `entry` edge-function action for parity with `useCreateEntry`. Either is acceptable to product; flag is for engineering ergonomics, not UX.

---

## Technical Design

### Approach

Introduce one new screen, `FastLogScreen`, that collects exactly three fields (restaurant, rating, Table) and submits through the existing `useCreateEntry` mutation. The screen renders in two presentation modes via a `presentation: 'modal' | 'sheet'` prop: the `+` tab routes to it full-screen (replacing today's direct push to `/create-entry`); the restaurant page's `LogVisitSheet` → "Solo log" action mounts the same component inside a bottom sheet inline on the page. The current heavy composer at `/create-entry` is untouched — it keeps serving Rounds and becomes the "Add details" escape hatch (fast-log pushes to it with all already-set fields passed as params). Entry detail gains in-place edit affordances for own entries (rating tappable, "Add note / photos / dish / breakdown" rows when missing, editable when present) backed by a new `useUpdateEntry` hook that does a direct supabase-js PATCH on `entries` (own-row UPDATE is already permitted by RLS) and, for photos, delegates add/remove to the existing `entry_photos` insert/delete paths. All inline edits are optimistic, bump `updated_at` silently, and explicitly do not re-sort feeds.

### Architecture Decisions

1. **One `FastLogScreen` component, two presentations (`modal` vs `sheet`) via prop.** Rationale: the spec locks "two surface modes, one component"; doing it with a single component and a `presentation` prop keeps field layout, validation, and submit logic in one place. The modal mode is hosted by a new route `app/fast-log.tsx`; the sheet mode is rendered inside a React Native `Modal` (same bottom-sheet pattern as `LogVisitSheet.tsx`) directly from the restaurant page. Trade-off: the component must avoid assuming navigation context (it takes `onSubmitted` / `onAddDetails` / `onClose` callbacks from the host instead of calling `router.back()` itself).

2. **`useUpdateEntry` is a direct supabase-js PATCH against `entries`, not a new edge-function action.** Rationale: RLS policy `entries_update_own` (`auth.uid() = user_id`) is already in place on the `entries` table — the client session can UPDATE its own rows safely with no edge trip. The edits this ticket cares about (`rating`, `content`, `dish_description`, `vibe/flavor/service/value_rating`) are all scalar columns with no side effects on join tables, unlike the create path (which upserts restaurants, inserts participants, toggles `user_restaurant_status`). Going through the edge function just to PATCH four columns would add a cold-start round trip with zero payoff. Trade-off: the mutation logic lives in two places (create in edge function, update in client) — acceptable because the shapes barely overlap; the only cross-cut is the rating validation, which the DB `CHECK` constraint already enforces.

3. **Photo edits use the existing compress+upload pipeline + a thin pair of `entry_photos` insert/delete calls; no reorder in v1.** Rationale: `entry_photos` RLS already permits insert and delete for own entries; `sort_order` changes can't be done via UPDATE (no policy, by design — the v0 migration comment says "photos are immutable"). Add = `compressAndUpload` → insert row with `sort_order = max + 1`; remove = delete row + `removeUploadedPhoto(url)`. Client also updates the entry's denormalised `photo_url` hero field via the same `useUpdateEntry` PATCH so the hero stays in sync. Trade-off: no drag-to-reorder yet — out of scope for this ticket; if a user wants a specific photo as hero they can delete and re-add, same as today's composer flow.

4. **"Add details" pushes to the existing `/create-entry` composer with the already-entered fields as params.** Rationale: the composer already accepts `restaurantId`, `placePayload`, `mode`, and `tableId` params (added in TICKET-016). Extend it to additionally seed `rating` (pre-populate the `StarRating`) so the user can keep what they dragged. The composer is not rewritten, not conditionally rendered, not two-things-at-once — it just gets two more optional params. Trade-off: the composer's initial `rating=0` default becomes `rating = Number(ratingParam) || 0` — a three-line change.

5. **Inline edits never invalidate feed queries that would cause re-sort.** Rationale: `created_at` is the canonical feed sort key; `queryKeys.tables.activity` and `queryKeys.entries.list` are fetched ordered by `created_at`. `useUpdateEntry.onSuccess` invalidates only `queryKeys.entries.detail(entryId)` (and optimistically patches the list cache row in place to update rating/content without a refetch). Trade-off: a stale list cache can briefly show old rating/text on another device until the list is refetched for other reasons — acceptable since the detail screen is always the source of truth and journal views re-read on focus.

6. **`+` tab now points at `/fast-log`, not `/create-entry`.** Rationale: TICKET-016's "Add details" affordance needs a destination distinct from the primary log surface, and swapping the default preserves the ability to deep-link into the composer (`/create-entry?mode=round`) without ambiguity. Trade-off: one-line change in `app/(tabs)/_layout.tsx`; no behavior change for Rounds which already push to `/create-entry` explicitly.

### New files

- `napkin-app/app/fast-log.tsx` — Route file. Thin shell: reads params, renders `<FastLogForm presentation="modal" onSubmitted={router.back} onAddDetails={pushToCreateEntry} />`.
- `napkin-app/components/logging/FastLogForm.tsx` — The shared form component. Renders restaurant field + `StarRating` size 36 + Table chip row + "Log it" CTA + "Add details" link. Accepts `{ presentation, lockedRestaurant?, initialTableId?, onSubmitted, onAddDetails, onClose }`.
- `napkin-app/components/logging/FastLogSheet.tsx` — Bottom-sheet wrapper around `FastLogForm` for restaurant-page usage. Mirrors the `Modal`+backdrop pattern used by `LogVisitSheet`. Accepts `{ visible, onClose, restaurant, onSubmitted }`.
- `napkin-app/components/logging/index.ts` — Barrel export.
- `napkin-app/hooks/entries/useUpdateEntry.ts` — `useUpdateEntry(entryId)` mutation hook: direct supabase-js `.update({...}).eq('id', entryId)` against `entries`, with optimistic cache patching and targeted invalidation.
- `napkin-app/hooks/entries/useEntryPhotoMutations.ts` — Two mutations (`useAddEntryPhoto`, `useRemoveEntryPhoto`) that wrap `compressAndUpload` + `entry_photos` insert/delete + `removeUploadedPhoto` on delete.

Five new files; no sixth needed (the entry-detail edit UI lives inline in `entry-detail.tsx` itself — cheaper than extracting).

### Modified files

- `napkin-app/app/(tabs)/_layout.tsx` — Change `+` tab `onPress` from `router.push('/create-entry')` to `router.push('/fast-log')`.
- `napkin-app/app/create-entry.tsx` — Accept a new `rating?: string` param; seed `useState(ratingFromParam ?? 0)` for the overall rating so "Add details" carries the user's rating through.
- `napkin-app/app/restaurant/[id].tsx` — Replace `handleSoloLog`'s `router.push('/create-entry', …)` with opening a local `FastLogSheet` (add `showFastLogSheet` state, keep `LogVisitSheet` as the first step). On submit, invalidate `queryKeys.restaurants.page(...)` so hero numbers refresh. `handleStartRound` stays untouched (still pushes to `/create-entry?mode=round`).
- `napkin-app/app/entry-detail.tsx` — Add edit affordances for own entries: tappable rating bubble → inline `StarRating editable`; muted "Add a note" / "Add a dish" / "Add photos" / "Rate the details" rows when fields are absent; edit-in-place when present. Gate all edit UI on `viewer?.id === entry.user_id`. Wire through `useUpdateEntry`, `useAddEntryPhoto`, `useRemoveEntryPhoto`. Per-field inline spinner + error text; no screen-wide error banner.
- `napkin-app/lib/queryKeys.ts` — No change needed (`entries.detail` already exists).

### Data contracts

```ts
// hooks/entries/useUpdateEntry.ts
export interface UpdateEntryInput {
  rating?: number | null;
  content?: string | null;
  dish_description?: string | null;
  vibe_rating?: number | null;
  flavor_rating?: number | null;
  service_rating?: number | null;
  value_rating?: number | null;
  photo_url?: string | null; // denorm hero after photo add/remove
}

export function useUpdateEntry(entryId: string) {
  // supabase.from('entries').update(input).eq('id', entryId).select().single()
  // onMutate: patch queryKeys.entries.detail(entryId) optimistically
  // onError:  rollback the detail-cache patch; surface error to caller
  // onSuccess: invalidate queryKeys.entries.detail(entryId) only — NOT
  //            queryKeys.tables.activity or queryKeys.entries.list (feed order locked).
}

// hooks/entries/useEntryPhotoMutations.ts
export function useAddEntryPhoto(entryId: string) {
  // 1. compressAndUpload(uri, userId) -> publicUrl
  // 2. select max(sort_order) for entry_id; insert { entry_id, photo_url, sort_order: max+1 }
  // 3. if this is the first photo, patch entries.photo_url via useUpdateEntry
  // invalidates ['entry-photos', entryId] (local key used by entry-detail today)
}
export function useRemoveEntryPhoto(entryId: string) {
  // 1. delete from entry_photos where id = photoId
  // 2. removeUploadedPhoto(publicUrl) (storage cleanup; ignore errors)
  // 3. if removed was hero (entries.photo_url), patch entries.photo_url to next photo or null
}

// components/logging/FastLogForm.tsx
interface FastLogFormProps {
  presentation: 'modal' | 'sheet';
  // When set, restaurant field is non-interactive and shows the locked name.
  lockedRestaurant?: { id?: string; external_id?: string; name: string; placePayload?: any };
  initialTableId?: string; // defaults to personal Table
  onSubmitted: (entryId: string) => void;
  onAddDetails: (prefill: { rating: number; restaurant: ...; tableId: string }) => void;
  onClose?: () => void; // sheet presentation only
}
```

The fast-log submit path reuses `useCreateEntry` verbatim — no mutation changes. It passes `{ rating, restaurant | restaurant_id, table_id }` and omits every other field. The `entry` edge function already tolerates this (all secondary fields are `?` checks).

### Routing

- `+` tab press → `router.push('/fast-log')` (modal presentation). No params.
- Restaurant page → `LogVisitSheet` → "Solo log" → local state `setShowFastLogSheet(true)` → `<FastLogSheet restaurant={...} onSubmitted={...} />`. No navigation. The `LogVisitSheet` dismisses on option tap (existing behavior); `FastLogSheet` mounts on the same screen.
- Restaurant page → `LogVisitSheet` → "Start a Round here" → unchanged: `router.push('/create-entry?mode=round&...')`.
- `FastLogForm` "Add details" → `router.push({ pathname: '/create-entry', params: { rating, restaurantId|placePayload, tableId, mode: 'solo' } })`. The composer seeds from these and opens at the impression form with the restaurant chip + Table chip + rating already populated.
- Entry detail edits → no navigation; in-place only.

### Migration / backend changes

**None.** Everything needed is already in place:

- `entries_update_own` RLS policy permits own-row UPDATE via client session — `useUpdateEntry` works out of the box.
- `entry_photos` has insert and delete policies for own entries — photo add/remove works out of the box.
- `updated_at` column already exists on `entries`; Postgres sets it via existing trigger or we pass `updated_at: new Date().toISOString()` explicitly in the PATCH. Feed queries do not sort on `updated_at`, so no feed-order risk.
- `entry` edge function already accepts absent optional fields — fast-log submit needs zero server changes.

### Risks

- **`LogVisitSheet` → `FastLogSheet` stacking glitches.** Two React Native `Modal`s in sequence on the same screen can flicker if the first hasn't finished dismissing before the second mounts. Mitigation: set `showLogSheet=false` and `showFastLogSheet=true` in the same setState tick, and use `onDismiss`/timing guard if iOS animation collides (there's precedent for this pattern elsewhere; verify in the first test pass).
- **Optimistic rating edit race with post-interactions realtime.** `usePostInteractionsRealtime` subscribes on entry-detail and will refresh `interactions` but not the entry row; our optimistic rating PATCH should not trigger any realtime channel on `entries` (none subscribed), so no conflict. Verify no one has added an `entries` realtime subscription recently.
- **Feed cache staleness after inline edit.** Intentional per architectural decision #5, but a Tablemate on another device may see an old rating until they refetch. Acceptable; documented in the decision.
- **Photo hero denormalisation drift.** `entries.photo_url` is a hero snapshot that can diverge from `entry_photos[0]` if a PATCH fails midway. Mitigation: do the `entry_photos` write first, then patch `entries.photo_url`; if the second fails the hero is momentarily stale but queries that read `entry_photos` (entry-detail carousel) remain correct.
- **"Add details" with a non-saved entry.** Fast-log's "Add details" button is designed to push to the composer *without* having saved the fast-log entry — it's a pre-submit route change, not a post-submit edit. The composer then owns the submit. Risk: users may tap "Add details" after already tapping "Log it"; guard by disabling "Add details" once `useCreateEntry.isPending || isSuccess`.
- **RLS session vs service-role inconsistency.** The rest of the codebase submits via edge functions (service-role). Going direct for UPDATE means the session must be valid in the client; already the case for every screen. If the session has silently expired the PATCH 401s — surface as the per-field error state.

### Test surface (manual)

1. Tap `+` tab → fast-log modal opens with restaurant search empty, rating at 0, Table chip defaulted to personal Table. "Log it" disabled.
2. Search + pick a restaurant, drag rating to 4.5, tap "Log it" → modal dismisses, journal reflects new entry with rating 4.5 and no note/dish/photos/breakdown.
3. Tap `+` tab → pick restaurant, rating 4.0, tap "Add details" → composer opens with that restaurant chip and rating 4.0 pre-set; submit goes through the normal composer path.
4. Restaurant page → "Log a visit" → "Solo log" → bottom sheet appears with restaurant locked (no search field); drag rating → "Log it" → sheet dismisses, hero "You · X.X · N visits" updates without page reload.
5. Restaurant page → "Log a visit" → "Start a Round here" → existing composer opens with `mode=round`; unchanged behavior.
6. Own entry-detail: rating bubble is tappable → opens editable StarRating; change → value persists, feed position unchanged.
7. Own entry-detail with no note: tap "Add a note" → inline text input; save on blur → note renders in Notes card.
8. Own entry-detail with no photos: tap "Add photos" → ActionSheet → pick image → upload spinner on the row only → hero photo renders when done; `entry_photos` row present in DB; `entries.photo_url` updated.
9. Own entry-detail with photos: pencil icon adds or removes a photo; removing the hero photo makes the next photo the new hero.
10. Own entry-detail with no breakdown: tap "Rate the details" → four StarRatings expand inline; set Flavor to 4.0 → persists independently.
11. Viewing another member's entry-detail: no "Add X" affordances visible; rating bubble non-tappable; layout identical to current read-only.
12. Ghost restaurant path: search → pick unpersisted result → fast-log modal → submit → entry created, restaurant silently persisted (first write wins), hero numbers reflect on next view.
13. Network drop on rating inline edit: PATCH errors → rating reverts to prior value → red helper text "Couldn't save. Try again." below the bubble only; rest of page intact.
14. Confirm feed sort unchanged after a week-old entry's rating is edited (spot-check by editing an entry, then scrolling journal).

---

## Build Log

### Files Changed

**New files (6):**
- `napkin-app/app/fast-log.tsx` — full-screen modal host for FastLogForm; routes + tab here instead of /create-entry
- `napkin-app/components/logging/FastLogForm.tsx` — shared form component (modal + sheet presentations via prop); restaurant search, StarRating size 36, Table chips, "Log it" CTA, "Add details" link
- `napkin-app/components/logging/FastLogSheet.tsx` — bottom-sheet wrapper around FastLogForm; mirrors LogVisitSheet Modal+backdrop pattern; used from restaurant page
- `napkin-app/components/logging/index.ts` — barrel export
- `napkin-app/hooks/entries/useUpdateEntry.ts` — direct supabase-js PATCH on entries; optimistic cache patch; invalidates entries.detail only (not feed queries)
- `napkin-app/hooks/entries/useEntryPhotoMutations.ts` — useAddEntryPhoto + useRemoveEntryPhoto; wraps compressAndUpload + entry_photos insert/delete + hero denorm sync
- `napkin-app/hooks/entries/index.ts` — barrel export

**Modified files (4):**
- `napkin-app/app/(tabs)/_layout.tsx` — one-line swap: + tab now pushes to /fast-log instead of /create-entry
- `napkin-app/app/create-entry.tsx` — added `rating?: string` param; seeds `useState(Number(ratingParam) || 0)` for the overall rating
- `napkin-app/app/restaurant/[id].tsx` — replaced handleSoloLog navigation with local FastLogSheet state; added useQueryClient + handleFastLogSubmitted to invalidate restaurant page on submit; FastLogSheet rendered conditionally alongside LogVisitSheet
- `napkin-app/app/entry-detail.tsx` — full inline edit surface for own entries: tappable rating bubble, "Add a note/dish/photos/breakdown" muted rows when absent, edit-in-place when present; all guarded by `isOwnEntry` (viewer.id === entry.user_id); photo rows now fetch id+photo_url+sort_order; per-field error states

**Incidental fixes (2, from TICKET-018 — unescaped entity lint errors blocking commit):**
- `napkin-app/components/lists/EmptyListsState.tsx` — escaped quotes with &ldquo;/&rdquo;
- `napkin-app/components/lists/AddToListSheet.tsx` — escaped quotes with &ldquo;/&rdquo;

### Tests

- `npx tsc --noEmit`: 1 error remains — `app/list/[id].tsx(173,54)` pre-existing from TICKET-018 (not in our files). Zero errors in all TICKET-019 files.
- `npm run test:functions` (Deno): 6 suites, 31 steps, 0 failed — all pass.
- `npm run test:app` (Jest): no tests exist (passWithNoTests).
- `expo lint`: 0 errors, 5 warnings (all pre-existing in unrelated files).

### Deviations from Technical Design

1. **`entryPhotoRows` now fetches id + sort_order in addition to photo_url.** The tech design referenced `useEntryPhotos` returning `string[]`; for the remove-photo path we need the row `id` to delete by. Changed the return type to `{ id, photo_url, sort_order }[]`. The original query only fetched `photo_url` — a minimal extension.

2. **Photo management in entry-detail shows existing photos as a separate tap-to-remove grid** rather than integrating with `MultiPhotoRow`. `MultiPhotoRow` is designed for upload slots (with localUri). Existing photos are remote URLs with no localUri. A dedicated grid with trash-icon overlay is cleaner and keeps `MultiPhotoRow` unchanged.

3. **`noteSaving` approximation.** `useUpdateEntry` is a single mutation hook shared across all field edits. The `noteSaving` derived value (`updateEntry.isPending && !isEditingRating`) is a heuristic — if two fields save simultaneously the spinner may appear on both. This is an acceptable UX trade-off vs. creating one mutation hook per field. A future refactor could use separate mutation instances per field if needed.

4. **`useEntryPhotos` query key in `entry-detail.tsx` stays as `['entry-photos', entryId]`** rather than importing `entryPhotosKey` from the hook barrel. This matches the pre-existing local `useEntryPhotos` function already in the file, which was kept intact to avoid breaking the existing detail query structure. The `entryPhotosKey` export from the barrel is available for other callers.

### Builder Questions

None — all design decisions in the spec were unambiguous. One potential concern documented here for architect review:

**Photo edit UX: pencil icon vs per-photo tappable grid.** The spec says "a small edit control (pencil icon, top-right of the hero area) opens the same photo management UI to add or remove photos." I've implemented this as: pencil in the top-right overlaid on the hero opens the ActionSheet (to add), PLUS a separate grid below the carousel where each existing photo is tappable to remove. This is slightly different from the spec's "same photo management UI" framing, which might imply a unified modal. My implementation avoids adding another modal layer and keeps things in-page, consistent with the "write in the margins" journal metaphor. If the architect wants a dedicated photo management modal, that's a follow-on change.

**ARCHITECT-REVIEW:** Entry-detail photo management combines "add via pencil/top-bar" with "remove via tappable grid" rather than a unified sheet. Is this the intended UX or should both actions live behind one modal?

---

## Review History

### Review 1 — 2026-04-17

**Reviewer**: code-reviewer (cold)

**Verdict**: REVISE

**AC Scorecard**:

- Fast-log surface
  - [PASS] `+` tab opens fast-log modal — `app/(tabs)/_layout.tsx:83` swaps to `/fast-log`.
  - [PASS] Three fields collected (restaurant, rating, Table) — `FastLogForm.tsx:288-502`.
  - [PASS] Places-backed debounced search, prefill via params preserved — `FastLogForm.tsx:127-171`, `fast-log.tsx:37-62`.
  - [PASS] StarRating size 36, `showValue` — `FastLogForm.tsx:449-454`.
  - [PASS] Table picker is horizontal chip row, defaults to personal Table — `FastLogForm.tsx:92-106, 460-502`.
  - [PASS] "LOG IT" primary CTA (uppercase, letterSpacing 2); disabled when rating/restaurant missing — `FastLogForm.tsx:518-548`.
  - [PASS] Submit omits content/dish/secondary ratings/photos — `FastLogForm.tsx:236-241` only sends `{ restaurant, rating, table_id, visibility }`.
  - [PASS] Dismisses on success; no toast — `fast-log.tsx:64-66`, `handleSubmitted` calls `router.back()`.
  - [PASS] "Add details" link pushes (not replaces) to `/create-entry` with prefill including rating — `fast-log.tsx:68-100`, create-entry accepts `rating?: string` param (`create-entry.tsx:78, 84, 210`).

- Restaurant page entry point
  - [PASS] "Log a visit → Solo log" opens fast-log with restaurant locked — `restaurant/[id].tsx:210-214`, `FastLogSheet.tsx:100-122`, locked chip rendered when `lockedRestaurant` truthy.
  - [WARN] Presented as bottom sheet but the `maxHeight: 0.75 * SCREEN_HEIGHT` is a ceiling, not a floor — the spec says "≥60% of viewport" (FastLogSheet.tsx:108). Actual height collapses to content; visually fine for short content but the spec clearly asks for a tall surface.
  - [PASS] Submit invalidates `queryKeys.restaurants.page(...)` — `restaurant/[id].tsx:170-174`.
  - [PASS] "Start a Round here" unchanged — `restaurant/[id].tsx:215-222` still pushes `/create-entry?mode=round`.

- Flesh-out (entry detail)
  - [PASS] Edit affordances only for own entries — `isOwnEntry = viewer.id === entry.user_id` gate at `entry-detail.tsx:299` applied throughout.
  - [FAIL] Inline rating edit persists server-side but **does not update the UI**. `useUpdateEntry.onMutate` writes optimistic patch to `queryKeys.entries.detail(entryId) = ['entry', entryId]`; `onSuccess` invalidates same key. But the screen's `useEntryDetail` uses queryKey `['entry-detail', ...]` (entry-detail.tsx:233). Keys never match → optimistic update is a no-op, invalidation is a no-op, `entry.rating` remains stale, after `setIsEditingRating(false)` user sees the OLD rating until screen refocus/remount. Same applies to note, dish, breakdown fields — ALL inline edits exhibit this bug.
  - [FAIL] Same root cause breaks the "Add a note" / "Add a dish" / "Rate the details" flows — server persists, UI does not reflect. Users will hit Save and see their input discarded visually, will re-type, may end up with duplicate writes or abandon.
  - [WARN] "Add photos" affordance when no photos present is rendered as `+ Photos` in the top bar (entry-detail.tsx:703-710), not as a "muted row in place of the hero photo area" per AC. Behavior works; UX matches spec only in spirit.
  - [PASS] Photos carousel with pencil edit control at top-right for own entries — `entry-detail.tsx:680-687`.
  - [WARN] Pencil add + separate tap-grid remove is two surfaces instead of one management UI (see "Photo UX" below).
  - [PASS] Breakdown editable on per-cell basis; `handleBreakdownCategoryChange` saves on change — `entry-detail.tsx:542-551`.
  - [WARN] Error UI shows red inline helper text but does NOT revert the editor value on failure — `handleRatingSave` sets `ratingError` but leaves `localRating` at the failed value; spec implies "revert + red inline helper text". User must manually Cancel.
  - [PASS/NOOP] "Does not change feed sort order" — the invalidation is correctly scoped to `entries.detail`, never touches `tables.activity` or `entries.list`. (This is a correct intent that also happens to be non-functional due to the key mismatch — but the mechanism would be feed-safe if keys were fixed.)

- Rounds are unaffected
  - [PASS] `handleStartRound` still pushes `/create-entry?mode=round` (restaurant/[id].tsx:215-222).
  - [PASS] Round participant entries flesh out via the same `isOwnEntry` gate.

- State handling
  - [PASS] Submit loading state on CTA — `FastLogForm.tsx:533`.
  - [PASS] Inline error with Retry above CTA — `FastLogForm.tsx:504-516`.
  - [PASS] Per-field spinner on inline edits — rating save uses `updateEntry.isPending` in its Save button; dish/note/breakdown use a small `ActivityIndicator` next to the field.
  - [WARN] `noteSaving = updateEntry.isPending && !isEditingRating` heuristic bleeds between concurrent edits (builder-flagged). Spec wants a single error state per field; with a shared mutation hook the spinner is ambiguous when two fields are saving.

**Cross-cutting findings**:

- **Feed-order invariant**: HOLDS. `useUpdateEntry.onSuccess` invalidates only `queryKeys.entries.detail(entryId)`; it does NOT touch `queryKeys.tables.activity` or `queryKeys.entries.list`. `useEntryPhotoMutations` similarly limits scope to `entryPhotosKey`. Edits will not resurface entries in Tablemate feeds, per spec. (Tech-design architectural decision #5 is honored.)

- **RLS/security**: `entries_update_own` policy with `auth.uid() = user_id` exists (`supabase/migrations/20251215145100_create_entries_table.sql:64-65`). The client-side PATCH in `useUpdateEntry` scopes only on `.eq('id', entryId)` — no defensive `.eq('user_id', viewer.id)`. RLS will reject an UPDATE against another user's entry; this is acceptable per the review rubric (WARN, not FAIL). Same for `entry_photos` insert/delete (entry_photos_insert/delete policies in 20260417000000_create_entry_photos.sql).

- **Photo denorm correctness**: Add path (`useEntryPhotoMutations.ts:61-70`) syncs `entries.photo_url` only when `sortOrder === 0` — correct for first photo on an empty entry. Remove path (`useEntryPhotoMutations.ts:102-117`) fetches the next sort-ordered photo when `isHero` and patches `photo_url` to the new URL or null. Both paths call `useUpdateEntry.mutate` internally, which inherits the same broken invalidation — the DB column is correct, but any cache reading `entries.photo_url` via `useEntryDetail` stays stale (again due to the key mismatch). Hero carousel is fine because it reads from `entryPhotoRows` (which IS invalidated correctly).

- **Optimistic rollback**: Mechanically present (`onMutate` snapshots, `onError` restores via `qc.setQueryData`) but useless due to the wrong cache key. On failure, the UI displays a red error but does not revert the in-editor value (Cancel/manual revert required).

- **Two-sheet stacking**: `handleSoloLog` sets `setShowLogSheet(false)` + `setShowFastLogSheet(true)` in the same tick (restaurant/[id].tsx:210-214), but no `onDismiss` gate before mounting the FastLogSheet. The architect called this out in the tech-design risks section. On iOS, two overlapping `Modal`s with `animationType="slide"` can flicker. Not a blocker but warrants QA. WARN.

- **Photo UX (pencil + tap-grid)**: WARN. The spec explicitly states: "a small edit control (pencil icon, top-right of the hero area) opens the same photo management UI to add or remove photos" — one control, one UI. Builder implemented: pencil opens ActionSheet (add-only), plus a separate full-width grid below the carousel with per-photo tap-to-remove (entry-detail.tsx:734-758). The split-surface is functional but the "Tap a photo to remove it" grid is visible whenever the user has photos and is always rendered below the carousel — it clutters read-only viewing of own entries (the grid renders for `isOwnEntry` regardless of whether the user intended to edit). The spec's single pencil-control unified-UI is cleaner; the builder's approach bleeds editing into every own-entry view.

- **Scope / dead code**: Mostly tight. `LockedRestaurant.id` field is used as a fallback `external_id` which isn't quite right for persisted-UUID restaurants (FastLogForm.tsx:207) — if a locked restaurant has no `placePayload` and no `external_id` (legacy restaurant without Places data), the submit path falls through to a synthetic `manual-<UUID>-<ts>` external_id rather than using the persisted restaurant_id directly. The entry edge function supports `restaurant_id` as an alternate path (entry/index.ts:166, 207) but `FastLogForm` never uses it. Edge case; no spec violation. `fast-log.tsx` is not declared in the root `_layout.tsx` Stack (unlike `create-entry.tsx` at `app/_layout.tsx:145`) — the inline `<Stack.Screen options={{ presentation: 'modal' }} />` relies on Expo Router's auto-registration, which works but may briefly flash non-modal on first mount. Minor.

**Key issues (blocking)**:

1. **FAIL — broken invalidation key mismatch (entry-detail.tsx:233 vs useUpdateEntry.ts:49-73).** The screen's `useEntryDetail` query uses queryKey `['entry-detail', entryId ?? ...]`, but `useUpdateEntry` optimistic-patches and invalidates `queryKeys.entries.detail(entryId)` which evaluates to `['entry', entryId]` per `lib/queryKeys.ts:23`. The two keys never overlap. Consequence: every inline edit (rating, note, dish, breakdown, photo hero) succeeds on the server but the UI shows the PREVIOUS value until the screen is remounted. This is the core user-visible feature of the ticket and it is broken. **Fix**: either (a) change `useEntryDetail` to use `queryKeys.entries.detail(entryId)`, or (b) have `useUpdateEntry` additionally invalidate `['entry-detail', entryId]`. Option (a) is cleaner since `queryKeys.entries.detail` exists precisely for this.

2. **WARN (near-FAIL) — "Add photos" placement diverges from spec.** AC says the muted "Add photos" row should appear "in place of the hero photo area" when no photos exist; builder put it as a tiny "+ Photos" link in the top bar (entry-detail.tsx:703-710). The hero-placement affordance is the visual hook the spec asks for; the top-bar link is easy to miss.

3. **WARN — Photo management UI is two surfaces.** Spec asks for one pencil-driven UI for add+remove; builder split into pencil-for-add and tap-grid-for-remove, and the remove grid renders any time the user has photos and is the owner (entry-detail.tsx:734-758), cluttering non-editing view. Consider either: make pencil open a sheet containing both add and existing-photo remove grid, OR gate the remove grid behind an explicit "manage photos" toggle.

4. **WARN — FastLogSheet height.** `maxHeight: SCREEN_HEIGHT * 0.75` is a ceiling; spec wants `≥60%` as a floor (FastLogSheet.tsx:108). Set a min-height or explicit height matching the ≥60% contract.

5. **WARN — Two-modal stacking flicker.** `handleSoloLog` swaps two RN Modals in a single tick without `onDismiss` sync (restaurant/[id].tsx:210-214). Architect's own tech-design risks section flagged this as needing QA. No fix deployed.

6. **WARN — Failed edit does not revert editor value.** `handleRatingSave` / `handleNoteSave` / `handleDishSave` set an error string on catch but leave the `localRating` / `localNote` / `localDish` at the failed value. Spec's "revert + red inline helper text" semantics would put the editor back to the last-known-good and show red text; current UX makes the user manually Cancel.

**Non-blocking notes**:

- `handleSoloLog` and `FastLogSheet` derive `placePayload.id = r.external_id ?? ''` (restaurant/[id].tsx:399); for truly-legacy restaurants with no external_id this produces an empty external_id which the entry edge function rejects with a 400. Rare in practice post-TICKET-014.
- `app/_layout.tsx:63` still routes the root `BottomNavBar`'s `+` to `/create-entry`, while `app/(tabs)/_layout.tsx:83` routes the tab-bar `+` to `/fast-log`. Inconsistent; pre-existing dual-bar situation so not a TICKET-019 regression, but worth reconciling.
- `useAddEntryPhoto`'s error path cleans up orphaned storage via `removeUploadedPhoto(...).catch(() => {})` — correct, matches the create path.

**Final verdict**: **REVISE**

The ticket's flagship feature (inline edit with optimistic feedback) is functionally broken by a cache-key mismatch that makes every successful server write appear as a failed or ignored client edit. That alone blocks ship. The other items above are incremental fixes.

### Review 2 — 2026-04-17

**Reviewer**: code-reviewer (delta on commit 65b03cd)

**Verdict**: REVISE

**Per-fix verification (Review 1 items)**:

1. **[FAIL → PASS]** Cache key mismatch resolved. `useEntryDetail` now keys on `queryKeys.entries.detail(effectiveId)` (entry-detail.tsx:258), matching what `useUpdateEntry` patches/invalidates (useUpdateEntry.ts:49,55,73 → `['entry', entryId]`). New resolver query (`['resolve-entry-by-night', nightId, userId]`, entry-detail.tsx:249-254) cleanly handles the Round-participant `nightId+userId` entry-point: enabled only while `entryId` is absent, `staleTime: Infinity`, then `effectiveId = entryId ?? resolvedId` feeds the canonical detail query. Optimistic patches and invalidations now land on the screen's read query.

2. **[WARN → PASS]** "Add photos" hero placement. Top-bar `+ Photos` link is gone. New `addPhotosHero` muted row (entry-detail.tsx:751-773 + style at :1504) renders in the hero slot when `isOwnEntry && !hasHeroDisplay`, with camera icon + "Add photos" caption, tappable into the existing ActionSheet. Matches the spec's "in place of the hero photo area" framing.

3. **[WARN → PASS]** Photo management unified. New `photoManageMode` state (entry-detail.tsx:366) toggled by the pencil icon (entry-detail.tsx:721); icon swaps between `pencil-outline` and `checkmark` (entry-detail.tsx:726). Remove-grid + "Add a photo" button only render when `photoManageMode && hasHeroDisplay` (entry-detail.tsx:797). Non-editing view is now clean — just the carousel and pencil. Minor nit: `photoManageMode` isn't reset when the user removes the last photo (the panel disappears with `hasHeroDisplay` going false, but if they later add another the pencil shows the checkmark on a fresh photo). Cosmetic; not blocking.

4. **[WARN → PASS]** FastLogSheet height. `minHeight: SCREEN_HEIGHT * 0.6` and `maxHeight: SCREEN_HEIGHT * 0.9` are now both set (FastLogSheet.tsx:108-109). Sheet is tall by default; matches the ≥60% spec.

5. **[WARN → FAIL — new regression]** Two-modal stacking. The fix wires through `Modal.onDismiss` to chain FastLogSheet open after LogVisitSheet finishes dismissing. This works on iOS but **`Modal.onDismiss` is implemented on iOS only** (verified at `node_modules/react-native/Libraries/Modal/Modal.js`: `// OnDismiss is implemented on iOS only.`). On Android, `handleSoloLog` fires `setPendingFastLog(true) + setShowLogSheet(false)` (restaurant/[id].tsx:212-217), then `handleLogSheetDismiss` is never invoked because `onDismiss` never fires → `setShowFastLogSheet(true)` never runs → tapping "Solo log" silently does nothing on Android. Android is a configured target (app.json declares android section). Either:
    - Guard the new chain with `Platform.OS === 'ios'` and fall back to the tick-swap `setShowLogSheet(false); setShowFastLogSheet(true);` on Android, or
    - Use `setTimeout(() => setShowFastLogSheet(true), 250)` (cross-platform; matches the slide animation duration).
   The Review 1 grade was WARN ("warrants QA"); the new code traded an iOS-only flicker risk for a complete Android break — net worse.

6. **[WARN → PASS]** Revert-on-error. All four save handlers now reset local state to `entry.*` on catch before showing red helper text:
    - `handleRatingSave` (entry-detail.tsx:502): `setLocalRating(entry.rating ?? 0)`
    - `handleNoteSave` (entry-detail.tsx:528): `setLocalNote(entry.content ?? '')`
    - `handleDishSave` (entry-detail.tsx:554): `setLocalDish(entry.dish_description ?? '')`
    - `handleBreakdownCategoryChange` (entry-detail.tsx:585-586): resets the touched key only, from `(entry as any)?.[key]`
   Spec semantics ("revert + red inline helper text") are now honored.

**Recheck cross-cutting**:

- **Feed-order invariant**: HOLDS. `useUpdateEntry.onSuccess` still invalidates only `queryKeys.entries.detail(entryId)` (useUpdateEntry.ts:73) — never `queryKeys.tables.activity` or `queryKeys.entries.list`. No regression.
- **RLS scoping**: UNCHANGED. `useUpdateEntry` still scopes `.eq('id', entryId)` (useUpdateEntry.ts:39); RLS policy `entries_update_own` still primary defense.
- **No new regressions in the photoManageMode refactor**: pencil icon position (`top-right of hero, below safe-area`) is preserved (entry-detail.tsx:719-732, same `topBar` overlay slot). `newPhotoSlots` upload UI (`MultiPhotoRow`) is unchanged and still renders for in-progress uploads (entry-detail.tsx:778-793). Existing inline edits for rating/note/dish/breakdown unchanged in structure — only the catch blocks gained a revert line.
- **Resolver query side effect**: the legacy `nightId`-only branch of `fetchEntry` (entry-detail.tsx:139-176) is now unreachable code because the resolver always supplies `entryId`. Not a bug, just dead. Fine to leave as a defensive fallback.
- **Typecheck**: `npx tsc --noEmit` exits 0 — clean.

**Non-blocking notes (carried over from Review 1, unchanged)**:

- `noteSaving` heuristic still bleeds across concurrent edits (shared `updateEntry.isPending`). Builder-flagged trade-off; not addressed in this revision.
- `LockedRestaurant.id` fallback path in FastLogForm/FastLogSheet untouched; same edge case for legacy restaurants without external_id.
- `app/_layout.tsx`'s root `BottomNavBar` `+` still routes to `/create-entry` while tab-bar `+` goes to `/fast-log`. Pre-existing dual-bar inconsistency.

**Key issues**:

1. **FAIL — Solo log broken on Android (new regression).** `LogVisitSheet`'s `onDismiss` prop chain to open `FastLogSheet` is iOS-only; Android user taps "Solo log" → nothing happens (restaurant/[id].tsx:212-224, LogVisitSheet.tsx:56). Fix: guard with `Platform.OS` and tick-swap on Android, or use a `setTimeout`-based chain that works on both platforms.

**Final verdict**: **REVISE**

Five of six Review 1 findings are properly resolved (including the blocker cache-key bug — flagship feature now works as intended). The sixth (modal stacking) was re-implemented in a way that breaks Solo-log-from-restaurant entirely on Android — converting an iOS WARN into an Android FAIL. One small change (Platform.OS guard or setTimeout chain) gets this to APPROVE.

### Review 3 — 2026-04-17

**Reviewer**: code-reviewer (delta on commit dd7c90a)

**Verdict**: APPROVE

**Review 2 FAIL resolution**: **PASS**

`handleSoloLog` (restaurant/[id].tsx:213-224) now branches on `Platform.OS`:
- **iOS** path (line 217-219): `setPendingFastLog(true); setShowLogSheet(false)` — deferred chain via `handleLogSheetDismiss` still fires on iOS where `Modal.onDismiss` is supported.
- **Android** path (line 220-223): `setShowLogSheet(false); setShowFastLogSheet(true)` — same-tick batched state update; `pendingFastLog` never set so `handleLogSheetDismiss` is a safe no-op even if it fired.

`Platform` is imported from `react-native` at line 20 — verified. `LogVisitSheet` still forwards `onDismiss` to the RN Modal (LogVisitSheet.tsx:56), so iOS behavior unchanged. The iOS-only constraint on `Modal.onDismiss` is confirmed in `node_modules/react-native/Libraries/Modal/Modal.js:315` (`// OnDismiss is implemented on iOS only.`).

**Prior Review 1 fixes still hold**: confirmed in place — cache key (`queryKeys.entries.detail(effectiveId)` at entry-detail.tsx:258), add-photos hero row (`addPhotosHero` style + render at entry-detail.tsx:755, 1504), unified photo manage mode (`photoManageMode` at entry-detail.tsx:366/726/797), FastLogSheet `minHeight: SCREEN_HEIGHT * 0.6` (FastLogSheet.tsx:108), revert-on-error on all four save handlers (entry-detail.tsx:502/528/554/585-586).

**New regression check**: **PASS (none)**

- Diff scope is one file, +11/-4 lines (`git diff 65b03cd..dd7c90a --stat`). No scope creep.
- `npx tsc --noEmit` exits 0 — clean.
- No dead code introduced — `Platform` is referenced exactly at the import site and the branch. `pendingFastLog` / `handleLogSheetDismiss` retained as the iOS chain path; still needed.
- Feed-order invariant, RLS scoping, optimistic patch mechanics — untouched by this commit, still hold.

**Final verdict**: **APPROVE**

The targeted fix addresses the Review 2 FAIL cleanly with no collateral damage. All six Review 1 findings are now resolved. Ticket is ship-ready.
