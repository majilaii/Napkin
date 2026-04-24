---
id: TICKET-036
title: "Optimistic updates & cache coherence — fix invalidation blast + stale patches"
priority: critical
status: ready
created: 2026-04-24
updated: 2026-04-24
tags: [client, react-query, correctness, ux]
---

# Optimistic updates & cache coherence

## Problem

The app's mutation story is uneven. Some mutations patch the cache optimistically; most just invalidate. Several that DO optimistically patch never reconcile properly, leaving stale ids, stale counts, or stale related caches. Several invalidation calls nuke every entry in a prefix and cause thundering-herd refetches.

Bug patrol (2026-04-24) identified 11 specific bugs. The underlying cause is that **no shared pattern exists**. Every hook improvises. This ticket establishes a canonical pattern, then applies it across the board.

### Findings covered

- **P0-5 — reactions optimistic reconciliation.** `napkin-app/hooks/posts/usePostInteractions.ts:169-265`. `onMutate` inserts `{ id: 'optimistic-<ts>' }` but `onSuccess` doesn't swap for the real server id. Cache holds a fake id until the invalidation refetch settles. Also, `top_emojis` is never updated locally — feed cards show stale reaction summaries until network lands.
- **P0-6 — `useCreateEntry`/`useStartRound`/`useSubmitTake`/`useAddTake`/`useLeaveTable`/`useAddMember` blast-radius invalidation.** `napkin-app/hooks/tables/useCreateEntry.ts:62-77` — logging an entry invalidates `entries.list`, `entries.mySolo`, `entriesForDay`, `feed.all`, `tables.activity`, `atlas.index`, AND the duplicate literal `['atlas', tableId]`. ~7 round-trips after one log; infinite scroll resets; empty-state flashes on slow networks. Same pattern in `useStartRound.ts:67-75`, `useSubmitTake.ts:56-63`, etc.
- **P0-7 — `top_emojis` type lies.** `hooks/feed/useFeed.ts:18` declares `string[]`; runtime is `EmojiCount[]` (shape: `{emoji, count, last_reacted_at}`). Consumers passing through `FeedActionRow` happen to work because they read `t.emoji`, but any TS-literal consumer breaks silently.
- **P0-8 — `useMarkSeen` can't roll back.** `napkin-app/hooks/tables/useLastSeenAt.ts:108-125`. `onMutate` doesn't snapshot the previous value; on error, cache is stuck at `now()`. Unseen-dot system breaks permanently until app restart.
- **P1-2 — wishlist invalidation thrashes.** `napkin-app/hooks/wishlist/useWishlistAdd.ts:63-84`. Toggling a heart refetches every cached Table wishlist plus every Atlas city. Heart button keeps its own component-local optimistic state so the cascade is "just for show" but very expensive.
- **P1-3 — list add/remove races.** `napkin-app/hooks/lists/useAddToList.ts:86-94` and `useRemoveFromList.ts:100-108`. `onSettled` invalidates even on success, racing with the `onMutate` patch. Rapid add→remove→add sequences flip-flop.
- **P1-4 — comment count drift.** `napkin-app/hooks/posts/usePostInteractions.ts:334-358`. `onError` decrements count but `useDiscardFailedComment` doesn't. Counts align only by coincidence of the two asymmetries.
- **P1-5 — `useUpdateEntry` scalar edits don't propagate to feed cache.** `napkin-app/hooks/entries/useUpdateEntry.ts:62-74`. Invalidates only `entries.detail(entryId)`; feed/tableActivity cards show stale `content` until their staleTime expires.
- **P1-8 — `useFollow`/`useUnfollow` wipe all cached profiles.** `napkin-app/hooks/users/useFollow.ts:98-107, 170-175`. `invalidateQueries({ queryKey: ['users', 'profile'] })` is a prefix match that nukes every cached profile. Thundering-herd if the user's browsed 30 strangers.
- **P1-10 — comment edit/delete doesn't update feed card count.** `napkin-app/hooks/posts/usePostInteractions.ts:398-482`. `useEditComment.onSuccess`/`useDeleteComment.onSuccess` only invalidate `postInteractions`; feed cards keep stale `comment_count`.
- **P1-14 — ghost wishlist key mismatch.** `napkin-app/hooks/wishlist/useIsWishlisted.ts:30-34`. Hero button keyed by Google Place `external_id` reads one key; `useWishlistAdd.onSuccess` writes a different key (the upserted UUID). Heart stays outline after save until refetch.
- **P2-11 — realtime subscription lifecycle not debounced.** `napkin-app/hooks/posts/usePostInteractionsRealtime.ts:30-76`. Fast navigation creates a flurry of channel connects/disconnects; 20 rapid switches can hit channel-limit issues.

## Notes

### Canonical mutation pattern

Every data-mutation hook follows this shape:

```ts
useMutation({
  mutationFn: async (input) => { /* server call, returns canonical result */ },
  onMutate: async (input) => {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) => patch(old, input, { optimistic: true }));
    return { previous };
  },
  onError: (_err, _input, ctx) => {
    if (ctx?.previous !== undefined) queryClient.setQueryData(queryKey, ctx.previous);
  },
  onSuccess: (result, input) => {
    // Reconcile: replace optimistic shape with server shape, by client_nonce or id match.
    queryClient.setQueryData(queryKey, (old) => reconcile(old, result, input));
  },
  onSettled: () => { /* only invalidate as a last-resort fallback, scoped narrowly */ },
});
```

Key rules:

1. **`onMutate` ALWAYS snapshots `previous` and returns it.** Non-negotiable.
2. **`onSuccess` reconciles, never invalidates by default.** Invalidation is a last resort when the server return shape doesn't carry enough to reconcile.
3. **Reconcile by `client_nonce`.** Every mutation that creates a new row sends a `client_nonce` (crypto UUID) with the request. The edge function round-trips it. Client uses the nonce to find the optimistic row and swap in the server row (or mark it `failed`). Already done for `post_comments` (`usePostInteractions.ts:360-379`) — follow that shape everywhere else.
4. **Never invalidate on a prefix wider than needed.** `['users', 'profile']` (all profiles) is wrong. `['users', 'profile', targetId]` is right. If you need to invalidate multiple specific ids, loop.
5. **Related caches get patched, not invalidated.** When the same logical datum appears in feed + detail + profile, optimistically patch all three. Yes, this means the mutation hook knows about the caches it affects.
6. **Invalidation (when it must happen) is scoped and queued via `onSettled`**, not `onSuccess`.

### Entries need a `client_nonce` column

Similar to `post_comments.client_nonce`. Migration: add nullable column, index not needed (scan within cached pages). Client generates a UUID on create, server stores it, roundtrips it. Nonce matching in `onSuccess` replaces the optimistic row in feed/tableActivity/entries caches.

### Query key registry cleanup (coordination with TICKET-039)

This ticket will uncover missing prefix keys like `queryKeys.users.profileAll`, `queryKeys.atlas.all`, etc. Those additions land here; the systemic drift cleanup is 039.

### Dependencies

- TICKET-034 (RLS) independent.
- TICKET-035 (pagination) touches `useTableActivity`, `useFeed`, `useUserDiary` — same hooks this ticket modifies. Coordinate: land 035 first so the cache shape is stable, then 036 adds optimistic logic on top.

### Risk

- Medium. Optimistic patches can hide bugs: a server-side failure that still shows `success: true` will silently corrupt the cache. Mitigate by asserting the server response shape in `onSuccess` and throwing if it doesn't match expectations (treats it as an error, triggers rollback).
- Realtime debounce (P2-11) may mask a legit channel teardown bug; test that a single subscription gets cleanly replaced when the target changes.

---

## Product Spec

### User Stories

- As a **user reacting to a post**, I want the reaction pill to update instantly and stay updated, never show a stale `optimistic-` id or regress after the network lands.
- As a **user logging a meal**, I want my journal/feed to patch in the new entry immediately without resetting scroll or flashing an empty state.
- As a **user following someone**, I want other cached profiles I've browsed to keep working — following Alice shouldn't wipe my view of Bob.
- As a **user whose network flaked mid-action**, I want the UI to roll back to the correct state, not get stuck claiming success.
- As a **user editing a log**, I want the edit to appear on the feed card immediately, not five minutes later when staleTime expires.
- As a **user hearting a ghost restaurant** (not yet persisted), I want the heart to fill in and stay filled.

### Acceptance Criteria

#### Canonical pattern + docs

- [ ] Add `napkin-app/lib/mutations.md` (or inline to `CLAUDE.md`) documenting the canonical mutation pattern above, with a working reference example. One hook becomes the canonical template — suggest `useToggleReaction` since it's the most touched.
- [ ] Add a lint-level check (eslint rule, or just a grep assertion in CI) that flags any `onSuccess` that calls `invalidateQueries` without a comment explaining why the reconcile path isn't sufficient. Optional stretch goal.

#### Schema — `client_nonce` on entries

- [ ] Migration: `ALTER TABLE public.entries ADD COLUMN client_nonce uuid;`. Nullable. No index.
- [ ] `supabase/functions/entry/index.ts` — accept `client_nonce` in POST body; store it on insert; return it in the response payload.
- [ ] `napkin-app/hooks/tables/useCreateEntry.ts` — generate `crypto.randomUUID()` on mutate, pass to server, store on optimistic row.

#### P0-5 — reactions reconciliation + `top_emojis` patching

- [ ] `usePostInteractions.ts::useToggleReaction.onSuccess` — match the optimistic reaction by `(user_id, emoji)` (or by the optimistic id prefix) in both `postInteractions.comments`-adjacent reaction arrays AND in the feed-card cache's `my_reactions`. Replace with the server row.
- [ ] Compute `top_emojis` updates locally in `onMutate` for both the detail cache (`counts.top_emojis`) and the feed card (`top_emojis`). Simplified algorithm: if adding, find existing `{emoji, count}` or insert; if removing, decrement or remove. Sort by count desc, tiebreak by `last_reacted_at`.
- [ ] Reconcile `top_emojis` from server response in `onSuccess` (server returns the authoritative sorted array; just swap it in).
- [ ] Delete the `invalidateQueries` calls in `onSuccess` of `useToggleReaction`.

#### P0-6 — entry/round mutation invalidation blast

- [ ] `useCreateEntry`: delete every `invalidateQueries`. Replace with `onMutate` patches to:
  - `queryKeys.entries.mySolo(userId)` — prepend.
  - `queryKeys.feed.all(userId)` — prepend.
  - `['entriesForDay', userId, <local date>]` — add to that day's bucket only.
  - `queryKeys.tables.activity(tableId)` if tableId — prepend.
  - Reconcile each in `onSuccess` by `client_nonce`.
- [ ] Delete the duplicate literal `['atlas', tableId]`; keep only `queryKeys.atlas.index(tableId)` (and see TICKET-039 for registry cleanup).
- [ ] Atlas cache: if `restaurant_id` is already in the atlas, don't invalidate — patch the last-visited timestamp. If it's new, optimistic-prepend to the index.
- [ ] `useStartRound`, `useSubmitTake`, `useAddTake`, `useLeaveTable`, `useAddMember` — same treatment. Each mutation onMutate patches the specific caches it affects; onSuccess reconciles by id or nonce; onError rolls back from snapshot.

#### P0-7 — `top_emojis` type fix

- [ ] Export `EmojiCount` from `usePostInteractions.ts` (if not already).
- [ ] `hooks/feed/useFeed.ts:18` — change `top_emojis: string[]` to `top_emojis: EmojiCount[]`.
- [ ] Audit every consumer of `FeedEntry.top_emojis`. Fix any type errors surfaced.
- [ ] Unify the FeedEntry shape across `useTableActivity`, `useFeed`, `usePostInteractions` — one shared type in `lib/types.ts` or `hooks/feed/types.ts`.

#### P0-8 — `useMarkSeen` snapshot + rollback

- [ ] `useLastSeenAt.ts::useMarkSeen.onMutate` — snapshot previous value, return in context.
- [ ] `onError` — restore from context.
- [ ] Update the misleading comment "extra dots next session" — it's "user sees stuck-on-seen state until next mount" without the fix.

#### P1-2 — wishlist add/remove

- [ ] Move optimism from the component into the hook. `useWishlistAdd.onMutate` flips `queryKeys.wishlist.check(userId, restaurantId)` and prepends to `queryKeys.wishlist.personal(userId)` page 0.
- [ ] Scope Table-wishlist invalidation: do not blanket `['wishlist', 'table']`. Either (a) invalidate only tables the restaurant actually appears in (requires server to return `affected_table_ids`), or (b) no invalidation; rely on staleTime.
- [ ] Scope Atlas invalidation to the city the restaurant is in, if known. Otherwise skip.
- [ ] Delete component-local `optimisticSaved` state in `WishlistHeartButton.tsx:50-56` and let the hook drive UI state via `useIsWishlisted`.

#### P1-3 — list add/remove race

- [ ] `useAddToList.onSettled` / `useRemoveFromList.onSettled` — do NOT invalidate. Reconcile by reading `result` and patching the cache.
- [ ] Add a `useIsMutating` guard on the UI so rapid taps are serialized (optional, defense-in-depth).

#### P1-4 — comment count drift

- [ ] `usePostInteractions.ts::useAddComment.onError` — stop manually decrementing `counts.comments`. Instead, let the counts be derived from `comments.filter(c => !c.failed).length` in the selector layer, or add a `useMemo` at the consumer. Single source of truth.
- [ ] `useDiscardFailedComment` — update if needed so the derived count stays right.

#### P1-5 — `useUpdateEntry` cache propagation

- [ ] `useUpdateEntry.onSuccess` — in addition to the detail invalidate, patch the same row in:
  - `queryKeys.feed.all(userId)` (all infinite pages, scan for entry id).
  - `queryKeys.tables.activity(tableId)` if entry has a table_id.
  - `queryKeys.entries.mySolo(userId)`.
  Update `content`, `rating`, `secondary_ratings`, and any other edited field in-place. Do not re-sort; preserve page position.

#### P1-8 — `useFollow`/`useUnfollow` scoping

- [ ] `useFollow.onSuccess` / `useUnfollow.onSuccess` — optimistically patch:
  - `queryKeys.users.profile(targetId)` — increment/decrement `followers_count`.
  - `queryKeys.users.profile(viewerId)` — increment/decrement `following_count`.
  - `queryKeys.users.followState(viewerId, targetId)` — flip.
- [ ] Do NOT invalidate `['users', 'profile']` wholesale. Delete that call.
- [ ] If any cached `followList` pages need refreshing, invalidate specifically `queryKeys.users.followList(viewerId, 'following')` (or followers) — narrow key.

#### P1-10 — comment edit/delete → feed card count

- [ ] `useEditComment.onSuccess` — patch feed-card `comment_count` if changed (it doesn't change for edit, so no-op for count; but patch `content` on any cached inline comment preview).
- [ ] `useDeleteComment.onMutate` — decrement `comment_count` on the matching feed-card row in `queryKeys.feed.all(userId)` and `queryKeys.tables.activity(tableId)`. Reconcile in onSuccess; rollback in onError.

#### P1-14 — ghost wishlist key

- [ ] `useWishlistAdd.onSuccess` — if the input was an external_id (ghost), write `queryKeys.wishlist.check(userId, external_id)` = true AND `queryKeys.wishlist.check(userId, server_restaurant_id)` = true. Both keys point at the same logical save.
- [ ] Alternative: resolve external_id → restaurant_id before the hook fires so there's only one key. Architect to decide.

#### P2-11 — realtime subscription debounce

- [ ] `usePostInteractionsRealtime.ts:30-76` — debounce the subscribe effect by 150ms via a timer + ref. Ensure teardown cancels the pending timer.
- [ ] Confirm via manual nav-spam test: rapid back-and-forth between two entry-details should produce at most 1 extra subscription per second, not 20.

#### Testing plan

- [ ] For each hook listed, write a small Jest test (or equivalent) with a mocked server that simulates:
  - (a) successful mutation → cache reflects server shape, no optimistic ids remain.
  - (b) failed mutation (500) → cache rolls back to pre-mutation snapshot.
  - (c) rapid double-mutation → no races that leave cache in an invalid state.
- [ ] Manual device test: log entry, react, comment, edit, delete, wishlist toggle, follow/unfollow. Confirm zero visible invalidation flashes, zero scroll resets, zero stuck loading spinners.
- [ ] Network throttle test: set device to "Slow 3G" in dev tools. All optimistic actions should feel instant; rollback should be immediate if the server errors.

### Non-goals

- Do not migrate mutations to a library like Zustand; React Query stays the source of truth.
- Do not add undo UI (that's a product ticket).
- Do not change server-side mutation behavior except adding `client_nonce` round-tripping.

### Definition of Done

- Canonical pattern documented.
- Every listed hook migrated and passes its test.
- Build log lists every cache key that was previously invalidated and is now patched.
- Manual-device script run on device, recorded or signed off.
