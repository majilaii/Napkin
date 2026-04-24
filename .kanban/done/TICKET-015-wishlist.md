---
id: TICKET-015
title: "Wishlist (personal Pinterest grid + emergent Table overlap)"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
completed: 2026-04-16
tags: [wishlist, restaurants, social, tables]
---

# Wishlist (personal Pinterest grid + emergent Table overlap)

## Problem

Users want to save restaurants they want to try — both privately ("Pinterest mode, save everything") and as a group signal ("our Table should go here"). There's currently no concept of a wishlist anywhere in Napkin.

A naive design (one button per restaurant = "add to Table wishlist") gets spammed, the Table list becomes noise, and the feature dies. A high-friction Table add doesn't get used.

The locked model (see `memory/project_wishlist_model.md`) is **emergent overlap**: everyone maintains a personal wishlist. A Table's wishlist is not directly editable — it's an algorithmic merge of its members' personal wishlists, ranked by how many members saved each restaurant. Group consensus surfaces automatically; no spam path exists because no "add to Table" action exists.

## Notes

### Locked product decisions (re-state for the designer)
- **Personal wishlist is primary.** One-tap save, Pinterest-style, cross-Table, private to the user.
- **Table wishlist is derived, not stored.** For a given Table, it's computed as: restaurants saved by ≥1 of its members, ranked by number of members who saved it ("3 of you want to try Kono" > "1 of you saved this"). No writes target a Table wishlist directly.
- **No "Nominate" / unilateral add-to-Table action in v1.** Deliberately omitted. Revisit only if real usage shows the gap.
- **Leaving a Table**: personal wishlist is untouched; that user's contributions simply drop out of the Table's overlap view. No orphan cleanup.

### Scope
1. **Schema**: `wishlist_items` table. Fields: `id`, `user_id`, `restaurant_id`, `created_at`, optional `note`. Personal-only — no `table_id` column. Unique on `(user_id, restaurant_id)`.
2. **Edge function / hooks**:
   - Add to wishlist (accepts either a `restaurant_id` or a Places `place_id` — if Places, calls the TICKET-014 upsert-from-place first, then inserts the wishlist item).
   - Remove from wishlist.
   - List personal wishlist (paginated).
   - List Table wishlist — derived query, takes `table_id`, returns restaurants ranked by overlap count with per-member attribution (avatars of who saved it).
3. **UI — Pinterest-style grid** (personal + Table views):
   - Masonry-ish grid of restaurant cards with photo, name, secondary info (city or cuisine)
   - Tap card → restaurant page (TICKET-016)
   - Long-press → remove (personal only — Table view is read-only)
   - Personal view: "My wishlist" grid
   - Table view: per-Table grid with overlap chips ("3 of you") on each card
4. **Wishlist button** — heart/bookmark icon on restaurant page (TICKET-016 wires the button; this ticket owns the icon component + the mutation hook it calls).
5. **Entry points**:
   - Tables tab: a "Wishlist" row/tab for each Table (Table overlap view)
   - Profile / account area: "My wishlist" (personal view)
   - Restaurant page (via TICKET-016): the heart button

### Technical sketch (non-binding)
- New migration: `wishlist_items` table + indexes (`user_id`, `restaurant_id`)
- New edge function `wishlist` with actions: `add`, `remove`, `list_personal`, `list_table`
- `list_table`: joins `wishlist_items` to `table_memberships` for the given Table, groups by `restaurant_id`, orders by count desc
- Hooks in `hooks/wishlist/`: `useWishlistAdd`, `useWishlistRemove`, `useMyWishlist`, `useTableWishlist(tableId)`
- Components in `components/wishlist/`: `WishlistGrid`, `WishlistCard`, `WishlistHeartButton` (the reusable heart for restaurant page)

### Depends on
- **TICKET-014** (restaurant entity + personal Table + Places upsert). Hard dependency — wishlist adds need a `restaurant_id`, and Places-result adds go through TICKET-014's upsert action.

### Things NOT in this ticket
- Any unilateral "add to Table wishlist" action (doctrine forbids)
- Wishlist comments / discussion threads
- "Recommendations" surfaced from wishlist overlap (future; just ranking for now)
- Cross-Table wishlist view ("restaurants everyone across all my Tables wants") — nice idea, defer
- Reordering / manual sort — personal view is reverse-chronological; Table view is ranked by overlap count then recency
- Push notifications when someone overlaps on your wishlist (future)

---

## Product Spec

### User Stories

- As a **personal saver**, I want to tap a heart on any restaurant (persisted or Places ghost) to add it to my wishlist in one tap, so that I can hoard ideas without friction.
- As a **personal saver**, I want my wishlist presented as a photo-forward Pinterest grid, so that scanning feels like browsing mood boards, not reading a list.
- As a **personal saver**, I want to remove a restaurant I no longer care about, so that the grid stays mine.
- As a **group-consensus reader**, I want to open a Table's Wishlist and see restaurants ranked by how many of us saved them, so that I immediately know what the group actually wants to try.
- As a **group-consensus reader**, I want to see avatars of which members saved each restaurant, so that the signal feels attributed, not anonymous.
- As a **member whose saves surface in a Table**, I want my personal wishlist to be the single source of truth across every Table I'm in, so that I never have to re-save the same place per Table.
- As a **member who leaves a Table**, I want my personal wishlist untouched, so that leaving a group doesn't delete my ideas.
- As a **developer of TICKET-016 (restaurant page)**, I need a reusable heart button component + a mutation hook that accepts either a `restaurant_id` or a Places `place_id`, so that the restaurant page can drop it in without knowing whether the restaurant is persisted.
- As a **developer of downstream Table UI**, I need a `useTableWishlist(tableId)` hook returning ranked restaurants with per-member attribution, so that I can render the Table view without reimplementing the aggregation.

### Acceptance Criteria

- [ ] Migration creates `wishlist_items` table: `id` (uuid pk), `user_id` (fk users), `restaurant_id` (fk restaurants), `note` (text, nullable), `created_at` (timestamptz). Unique index on `(user_id, restaurant_id)`. Secondary indexes on `user_id` and `restaurant_id`.
- [ ] New edge function `wishlist` with four actions routed by request body `action`:
  - `add` — accepts either `{ restaurant_id }` or `{ place_id, place_payload }`. If `place_id` provided, calls TICKET-014's upsert-from-place first, then inserts the wishlist row. Idempotent (re-adding returns existing row, no error).
  - `remove` — accepts `{ restaurant_id }`, deletes the row for the caller.
  - `list_personal` — paginated, reverse-chronological by `created_at`. Returns restaurant rows joined with wishlist metadata.
  - `list_table` — accepts `{ table_id }`. Validates caller is a member. Returns restaurants saved by any member of that Table, ranked by member-save-count desc then most-recent-save desc. Each row includes the count and an array of member `{ user_id, display_name, avatar_url }` who saved it.
- [ ] All actions require an authenticated user; `list_table` additionally rejects non-members.
- [ ] `WishlistHeartButton` component (in `components/wishlist/`) renders a heart icon with two visual states: unsaved (outline, neutral color) and saved (filled, warm accent from theme). Tap toggles state. Optimistically updates local state, rolls back on mutation error and shows a toast.
- [ ] `WishlistGrid` component renders a masonry-ish two-column grid of `WishlistCard`s. Card shows restaurant photo (primary), name, and one secondary line (city or cuisine). Variable card heights driven by photo aspect ratio. Matches Heirloom Journal palette.
- [ ] Personal view (`WishlistGrid` in personal mode): tap card → restaurant page. Long-press card → confirmation sheet with "Remove from wishlist" as the only destructive action.
- [ ] Table view (`WishlistGrid` in table mode): each card shows an overlap chip (e.g., "3 of you") and a small stack of member avatars. Tap card → restaurant page. Long-press is a no-op (read-only).
- [ ] Table view empty state: when a Table has zero members with zero wishlist items intersecting, show "Nothing saved yet — start hearting restaurants and they'll show up here for your Table."
- [ ] Entry point: Tables tab → a given Table's detail view has a "Wishlist" sub-tab alongside the activity feed. Selecting it renders `WishlistGrid` in table mode for that Table.
- [ ] Entry point: Profile / account area has a "My Wishlist" row that navigates to a full-screen `WishlistGrid` in personal mode.
- [ ] Hooks live in `hooks/wishlist/`: `useWishlistAdd`, `useWishlistRemove`, `useMyWishlist`, `useTableWishlist(tableId)`. Mutations invalidate `queryKeys.wishlist.personal(userId)` and any `queryKeys.wishlist.table(tableId)` for Tables the user belongs to.
- [ ] When `add` is called with a Places `place_id` for a ghost restaurant, the server persists the restaurant (via TICKET-014) and the wishlist row in a single round-trip from the client's perspective.
- [ ] Leaving a Table is a no-op for `wishlist_items`; the user's rows are untouched and simply drop out of that Table's `list_table` aggregation.

### UX Decisions

- **Pinterest-style masonry, not a uniform grid**: variable card heights driven by photo aspect ratio because the photo is the content; fixed-height tiles would flatten the visual hierarchy that makes the view feel like a wishlist and not a list.
- **One-tap add, long-press to remove on personal view**: matches the low-friction-save thesis. Long-press opens a confirmation sheet (not an inline menu) so the destructive action requires deliberate intent but stays one gesture away.
- **Overlap chip copy: "N of you"** (e.g., "3 of you") rather than "3 members" or "3/5". Reads as first-person-plural, reinforces Table intimacy, and avoids implying consensus-threshold math.
- **Member attribution via avatar stack** (up to 3 avatars + "+N" overflow) rendered beside the overlap chip. Tap-target on the stack is deferred to v2; v1 is informational.
- **Minimum overlap to appear in Table view: 1** (any member saving surfaces the restaurant). Ranking handles the noise — 1-save items naturally sink below higher-overlap ones. A minimum-2 cutoff would hide useful single-member signal for small Tables (2–3 people) where 1 save *is* meaningful.
- **Heart button: filled warm-accent when saved, outline when unsaved**. Saved state uses the same warm accent as other affirmative actions in the Heirloom palette for consistency; animation on tap is a subtle scale bounce (Reanimated `withSpring`), not a burst.
- **Optimistic heart toggle**: yes. Flip local state immediately, fire mutation, rollback + toast on failure. A wishlist save that feels slow kills the Pinterest-mode hoarding loop.
- **Empty state (personal)**: "Your wishlist is empty. Tap the heart on any restaurant to start saving." One-line, no illustration in v1.
- **Table Wishlist placement**: a sub-tab inside an individual Table's detail screen (alongside the activity feed), NOT a global tab at the top of the Tables tab. Wishlist is per-Table by design; a global tab would imply a cross-Table union view, which is explicitly deferred.

### Out of Scope

- Any unilateral "add directly to a Table's wishlist" action. Doctrine forbids.
- Comments, reactions, or discussion threads on wishlist items.
- Push or in-app notifications when a Table member's save overlaps with yours.
- Reordering or manual sort. Personal is reverse-chronological; Table is overlap-count-then-recency.
- Cross-Table union view ("restaurants everyone across all my Tables wants").
- Wishlist-based recommendations ("because 3 of you saved Kono, try..."). Future.
- Import from Google Maps lists, Beli, etc.
- Size caps / storage quotas per user.

### Open Questions — Resolved (2026-04-16)

- **Min member overlap for Table view**: **≥1 member.** Any save surfaces. Small Tables (2–3 members) would be empty otherwise.
- **Wishlist entry point**: **Sub-tab inside each Table's detail screen.** Table-scoped data belongs with the Table, not competing with the root tab bar.
- **Long-press on personal card**: **Confirmation sheet with "Remove" only (v1).** No Add Note / Share menu in v1.
- **Avatar-stack tap in Table view**: **Defer to v2.** The stack itself is the value; tap-to-expand is polish.
- **Heart rollback UX on mutation failure**: **Optimistic toggle + toast** ("Couldn't save — try again").
- **Wishlist size cap**: **No cap, rely on virtualization.** FlashList + paginated `list_personal` handles performance.

---

## Technical Design

### Approach

Ship wishlist as a thin layer over the TICKET-014 foundation: one new `wishlist_items` table (personal-only, no Table column), one new edge function `wishlist` with four actions (`add` / `remove` / `list_personal` / `list_table`), and a small `hooks/wishlist/` + `components/wishlist/` surface that renders a Pinterest-ish two-column masonry grid. The Table view is a derived query — it joins `wishlist_items` against `table_members` for a given Table and aggregates by `restaurant_id`. There is deliberately no `table_id` column on `wishlist_items`: the doctrine-locked "no unilateral add-to-Table" invariant is enforced by *schema*, not by convention. The `add` action folds the Places upsert path in transparently so callers (the heart button, downstream search) pass either a `restaurant_id` (persisted) or a full Places payload (ghost) and the server does the right thing in one round-trip.

### Architecture Decisions

- **No `table_id` column on `wishlist_items`, ever.** Personal-only schema is the enforcement mechanism for the doctrine decision ("no unilateral add to Table"). Table overlap is a read-time `GROUP BY restaurant_id` over `wishlist_items JOIN table_members ON user_id`. Trade-off: every Table-view render pays an aggregation cost; mitigated by the index on `wishlist_items(user_id)` and the typical Table size (5–15 members).

- **Single edge function (`wishlist`) with action routing via request body**, matching `entry`'s pattern — not a REST-ish `table-management`-style multi-verb function. Actions here are all POST-shaped (accept a body), so method routing adds no value. Trade-off: `list_personal` / `list_table` become POSTs instead of GETs, which is slightly non-idiomatic; acceptable because every other edge function that does domain work (e.g. `table-night`, `post-interactions`) already uses body-action routing.

- **`add` action folds in Places upsert rather than requiring two round-trips.** Body shape: `{ action: "add", restaurant_id?: string, restaurant?: PlacesPayload, note?: string }`. If `restaurant_id` is present, insert directly. If `restaurant` is present, call the existing `upsertRestaurant()` helper from `_shared/restaurant.ts` (same helper `entry/upsert_restaurant` uses), then insert. Trade-off: one action, two input shapes — documented with a clear "exactly one of restaurant_id or restaurant required" validator. Alternative (force client to always call `entry/upsert_restaurant` first) is strictly worse: doubles network latency on the ghost path and is what the heart button will do in its hottest moment.

- **`add` is idempotent via `ON CONFLICT DO NOTHING` on `(user_id, restaurant_id)`**. Re-adding returns the existing row. No error surface needed for "already saved" — the heart button's toggle semantics need add/remove to be cheap and boring. Trade-off: no "already exists" signal returned; acceptable because the client already has optimistic state and doesn't need a server-side confirmation for this case.

- **`list_table` shape: flat array of `{ restaurant, count, members: [...] }`, capped at a small avatar sample.** Server returns up to 5 members per restaurant (enough for the "3 avatars + overflow" UI pattern) plus the total count; client doesn't need the full member list to render the stack. Trade-off: if v2 wants tap-to-expand-who-saved-it, the endpoint needs to grow or a secondary fetch is required. Per the UX decision ("avatar-stack tap deferred to v2"), that's fine now.

- **`list_personal` is paginated cursor-style on `created_at`**, matching the existing `table-activity` pagination shape. Cursor: `before_created_at` query param or body field. `limit` defaults to 40 (enough to fill a two-column grid for a few scrolls). `list_table` is NOT paginated in v1 — overlap counts are small (sum of a Table's members' saves, typically <200 items) and the ranking wants the full set. If this bites, paginate later.

- **Heart button mutation hook is the sole public write path.** `useWishlistAdd` and `useWishlistRemove` are the only mutation hooks; the heart button component consumes both and exposes a single `saved: boolean` + `onToggle()` prop to callers. Trade-off: two queries/invalidations per toggle vs. one "toggle" action on the server; chose two because add/remove have genuinely different optimistic-update semantics (rollback direction) and the edge-function action count stays tight.

- **Optimistic toggle via React Query `onMutate` + context-based rollback**, the same pattern `useAddTake` already uses in this repo. Toast-on-error is handled by the component (not inside the hook), so the hook stays pure and reusable outside the `WishlistHeartButton` if a downstream screen wants it.

- **Masonry grid: two fixed columns, variable card heights driven by image aspect ratio, rendered via FlashList with `numColumns={2}`.** Not a true staggered masonry layout (two columns of independent item streams) — FlashList doesn't support that natively, and a third-party masonry lib (e.g. `@shopify/flash-list` experimental, `react-native-masonry-list`) adds a dependency for limited v1 value. Trade-off: rows align horizontally so cards in the shorter column have whitespace below them when paired with a taller neighbor — looks intentional within the Heirloom aesthetic (warm paper, negative space is part of the grammar). Escape hatch if users complain: swap in a staggered layout later without changing the data contract.

- **Wishlist sub-tab lives on the existing Tables tab, scoped to the active Table** — not a new route. The Tables tab already owns the active-Table selection (table picker + `selectedIndex` state). Add a `SegmentedControl` above the feed with two values (`Activity` | `Wishlist`) that toggles between the current feed and a `WishlistGrid` in table mode for `activeTable.id`. Trade-off: the `tables.tsx` screen grows; alternative is a child route `/table/[id]/wishlist` which requires a Table detail route that doesn't exist today and is out of scope. Personal "My Wishlist" is a standalone screen reached from Settings.

- **Entry point for personal view: Settings → "My Wishlist" row**, navigating to `/wishlist` (new route). Settings is the account-scoped surface that already exists; profile/account area doesn't exist as a separate screen. A dedicated Wishlist tab in the bottom bar would over-promote the feature.

### File Changes

**Migration (new)**
- `supabase/migrations/20260420000000_wishlist_items.sql` — NEW — creates `wishlist_items` (`id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`, `restaurant_id uuid not null references restaurants on delete cascade`, `note text`, `created_at timestamptz not null default now()`). Unique index on `(user_id, restaurant_id)`. Secondary indexes on `user_id` and `restaurant_id`. RLS: `select` where `auth.uid() = user_id` OR caller shares a Table with `user_id` (mirrors the pattern used by `entries`); `insert/update/delete` only where `auth.uid() = user_id`. Grants to `authenticated` and `service_role`.

**Edge functions (new + reuse)**
- `supabase/functions/wishlist/index.ts` — NEW — body-action routed: `add` / `remove` / `list_personal` / `list_table`. Auth gate mirrors `table-management`. For `add` with a `restaurant` payload, imports and calls `upsertRestaurant` from `../_shared/restaurant.ts`. For `list_table`, validates caller is a member of `table_id`, then runs the aggregation query.
- `supabase/functions/_shared/restaurant.ts` — REUSE — no changes needed; `upsertRestaurant()` already exposes the exact shape wishlist needs (takes `{ external_id, name, location, ... }`, returns `restaurantId`, idempotent).

**App — hooks**
- `napkin-app/hooks/wishlist/useWishlistAdd.ts` — NEW — `useMutation` that accepts either `{ restaurant_id }` or `{ restaurant: PlacesPayload }` plus optional `note`. On success invalidates `queryKeys.wishlist.personal(userId)` and any active `queryKeys.wishlist.table(tableId)` entries (cache-wide invalidation on the `['wishlist', 'table']` prefix is sufficient — callers don't need to enumerate Tables).
- `napkin-app/hooks/wishlist/useWishlistRemove.ts` — NEW — `useMutation` accepting `{ restaurant_id }`; same invalidations.
- `napkin-app/hooks/wishlist/useMyWishlist.ts` — NEW — `useInfiniteQuery` using cursor (`before_created_at`).
- `napkin-app/hooks/wishlist/useTableWishlist.ts` — NEW — `useQuery` keyed by `tableId`, returns the ranked list. `staleTime: 1000 * 60 * 5`.
- `napkin-app/hooks/wishlist/useIsWishlisted.ts` — NEW — derived selector over `useMyWishlist` data to answer `boolean` for a given `restaurant_id`. The heart button reads this to decide its visual state without a per-restaurant query. Trade-off: relies on personal wishlist being fully loaded; acceptable because the heart button is only rendered on the restaurant page, where the parent can ensure the query is warm.
- `napkin-app/hooks/wishlist/index.ts` — NEW — barrel.

**App — components**
- `napkin-app/components/wishlist/WishlistHeartButton.tsx` — NEW — reusable heart icon. Props: `restaurantId?: string`, `placesPayload?: PlacesPayload`, `size?: number`. Handles optimistic toggle + Reanimated scale-bounce on tap + error toast. Consumes both mutation hooks.
- `napkin-app/components/wishlist/WishlistCard.tsx` — NEW — single grid card. Two modes via prop: `'personal'` (long-press → confirmation sheet) and `'table'` (overlap chip + avatar stack, long-press no-op). Photo via `expo-image`; aspect ratio sourced from loaded image dimensions, with a sensible default while loading.
- `napkin-app/components/wishlist/WishlistGrid.tsx` — NEW — FlashList with `numColumns={2}`, `renderItem` → `WishlistCard`, handles empty state copy per mode, pull-to-refresh, and pagination on the personal variant.
- `napkin-app/components/wishlist/OverlapChip.tsx` — NEW — the "N of you" chip.
- `napkin-app/components/wishlist/AvatarStack.tsx` — NEW — up to 3 stacked avatars + "+N" bubble. Small, self-contained, reusable later.
- `napkin-app/components/wishlist/RemoveConfirmationSheet.tsx` — NEW — modal bottom sheet with a single destructive "Remove from wishlist" action.
- `napkin-app/components/wishlist/index.ts` — NEW — barrel.

**App — routes + integration**
- `napkin-app/app/wishlist.tsx` — NEW — full-screen personal `WishlistGrid` in personal mode.
- `napkin-app/app/(tabs)/tables.tsx` — MODIFY — add a segmented control (`Activity` | `Wishlist`) just under the table picker; when `Wishlist` is selected, render `WishlistGrid` in table mode for `activeTable.id` instead of the feed. Keep filter chips and date headers only in the Activity view.
- `napkin-app/app/(tabs)/settings.tsx` — MODIFY — add a "My Wishlist" row above "Sign out" that navigates to `/wishlist`.
- `napkin-app/app/restaurant/[id].tsx` — MODIFY (TICKET-016 owns the wiring; this ticket makes sure the button works in isolation) — drop in `<WishlistHeartButton restaurantId={id} />` in the header area. Minor enough to ship here; if TICKET-016 touches the same area, last-writer-wins is fine.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add:
  ```ts
  wishlist: {
      personal: (userId: string) => ['wishlist', 'personal', userId] as const,
      table: (tableId: string) => ['wishlist', 'table', tableId] as const,
  }
  ```

### Edge Function Signatures

```
POST /wishlist
  auth: required

  body: { action: "add", restaurant_id: string, note?: string }
     OR { action: "add", restaurant: PlacesPayload, note?: string }
  response: { data: { id, user_id, restaurant_id, note, created_at } }
  behavior: idempotent via ON CONFLICT DO NOTHING (re-add returns existing row)

  body: { action: "remove", restaurant_id: string }
  response: { data: { removed: true } }

  body: { action: "list_personal", limit?: number (default 40, max 100),
          before_created_at?: ISO8601 }
  response: { data: Array<{ id, note, created_at, restaurant: {...} }>,
              next_cursor: ISO8601 | null }

  body: { action: "list_table", table_id: string }
  response: { data: Array<{
    restaurant: {...},
    count: number,
    members: Array<{ user_id, display_name, avatar_url }>  // capped at 5
  }> }
  ordering: count DESC, max(created_at) DESC
  auth: caller must be member of table_id (403 otherwise)
```

### Implementation Order

1. **Migration** (`wishlist_items` table + indexes + RLS) — nothing else compiles until the table exists. Verify via `psql` that the unique index rejects duplicates.
2. **`wishlist` edge function, `add` + `remove` actions only** — wire against the existing `upsertRestaurant` helper. curl smoke-test both input shapes (`restaurant_id` and `restaurant`). Depends on step 1.
3. **`list_personal` action** — pagination on `created_at`. curl smoke-test with a seeded 60-row fixture to verify cursor behavior. Depends on step 2.
4. **`list_table` action** — aggregation + member-cap join. curl smoke-test that non-members get 403 and that counts rank correctly with 1, 2, 3-save cases.
5. **Query keys + hooks** (`useWishlistAdd`, `useWishlistRemove`, `useMyWishlist`, `useTableWishlist`, `useIsWishlisted`) — depends on steps 2–4. Ship with React Query devtools open to confirm invalidations.
6. **`WishlistHeartButton`** — depends on step 5. Test optimistic toggle + error rollback via network-off simulator.
7. **`WishlistGrid` + `WishlistCard` + chip/stack/sheet components** — depends on steps 5–6. Personal and Table modes sharing the same card with a mode prop.
8. **Personal screen (`/wishlist`) + Settings entry point** — depends on step 7.
9. **Tables tab segmented control + Table mode grid** — depends on step 7. Avoid touching filter chips / date headers (Activity mode only).
10. **Restaurant-page heart integration** — trivial drop-in; last so it doesn't block TICKET-016.

### Risks

- **Table-mode aggregation cost scales with `members × avg_saves_per_member`.** For typical Tables (5–15 members, ~20 saves each) this is fine; the query is indexed on `user_id`. For a 50-member Table with heavy savers it's still <10k rows aggregated. Mitigation: add a `LIMIT 200` on the aggregate output — beyond ~200 items the Table view is unusable UX anyway; defer pagination until someone hits the cap.

- **Optimistic toggle desync if `useMyWishlist` hasn't been fetched on the restaurant page.** The `useIsWishlisted` selector returns `false` when the query is uninitialized, so a heart could render "unsaved" for an actually-saved restaurant. Mitigation: the restaurant page component calls `useMyWishlist` to warm the cache; if first-paint feels stale, switch to a dedicated `useIsWishlisted(restaurantId)` that hits a lightweight server check. Start with the cheap option.

- **Places photo download on `add` path** — same 300–800ms photo latency TICKET-014 noted for `upsert_restaurant`. Here it's gated behind the heart tap, which is exactly the "Pinterest-mode hoarding loop" moment the UX decisions call out as latency-sensitive. Mitigation: the optimistic heart already flips instantly; the mutation resolves in the background. User doesn't feel the latency unless they immediately navigate to the wishlist and expect the photo to be there. Acceptable.

- **FlashList + variable-height items known quirk**: FlashList needs a reasonable `estimatedItemSize`. Variable aspect-ratio cards will cause over/under-estimation. Mitigation: set `estimatedItemSize={280}` (median expected card height) and accept minor scroll-position jitter on first render; revisit if it's jarring.

- **Doctrine pressure.** Someone will request "Nominate to Table" within a week of shipping. The schema is specifically shaped to make that a non-trivial add (no `table_id` column). Mitigation: point at `memory/project_wishlist_model.md` and the Notes section of this ticket. Do not cave on the first ask.

- **RLS on `wishlist_items`** — the `select` policy allows Table-mates to read each other's rows (necessary for Table-view rendering directly via PostgREST if that path is ever wanted). Edge function uses service role and will work either way. If this feels too loose, tighten to `select where auth.uid() = user_id` and rely exclusively on the edge function for Table view. Start loose; tighten if a client ever tries a direct PostgREST read and gets more than it should.

---

## Build Log

### Files Changed

**Migration**
- `supabase/migrations/20260420000000_wishlist_items.sql` — NEW — `wishlist_items` table with unique index on `(user_id, restaurant_id)`, secondary indexes on `user_id` and `restaurant_id`, RLS policies (select allows Table-mates), grants to `authenticated` and `service_role`.

**Edge Function**
- `supabase/functions/wishlist/index.ts` — NEW — four actions: `add` (accepts `restaurant_id` or Places payload; folds in `upsertRestaurant` from `_shared/restaurant.ts`; idempotent via ON CONFLICT), `remove`, `list_personal` (cursor-paginated on `created_at`), `list_table` (aggregates by restaurant, ranked count DESC / recency DESC, caps members at 5, rejects non-members with 403).

**Hooks**
- `napkin-app/hooks/wishlist/useWishlistAdd.ts` — NEW
- `napkin-app/hooks/wishlist/useWishlistRemove.ts` — NEW
- `napkin-app/hooks/wishlist/useMyWishlist.ts` — NEW — `useInfiniteQuery` with cursor pagination
- `napkin-app/hooks/wishlist/useTableWishlist.ts` — NEW — `useQuery` with 5-min staleTime
- `napkin-app/hooks/wishlist/useIsWishlisted.ts` — NEW — derived selector over `useMyWishlist` data
- `napkin-app/hooks/wishlist/index.ts` — NEW — barrel export
- `napkin-app/lib/queryKeys.ts` — MODIFIED — added `wishlist.personal(userId)` and `wishlist.table(tableId)` keys

**Components**
- `napkin-app/components/wishlist/WishlistHeartButton.tsx` — NEW — optimistic toggle, Reanimated `withSpring` scale-bounce, `Alert.alert` on rollback (matches codebase pattern; no separate toast library)
- `napkin-app/components/wishlist/WishlistGrid.tsx` — NEW — `FlatList numColumns={2}` (FlashList not installed), personal + table modes, empty states
- `napkin-app/components/wishlist/WishlistCard.tsx` — NEW — personal (long-press → sheet) and table (read-only, overlap chip + avatar stack) modes
- `napkin-app/components/wishlist/OverlapChip.tsx` — NEW — "N of you" chip
- `napkin-app/components/wishlist/AvatarStack.tsx` — NEW — up to 3 avatars + "+N" overflow
- `napkin-app/components/wishlist/RemoveConfirmationSheet.tsx` — NEW — bottom-sheet modal
- `napkin-app/components/wishlist/index.ts` — NEW — barrel export

**Routes + Integration**
- `napkin-app/app/wishlist.tsx` — NEW — full-screen personal wishlist screen
- `napkin-app/app/(tabs)/settings.tsx` — MODIFIED — added "My Wishlist" row above Sign Out
- `napkin-app/app/(tabs)/tables.tsx` — MODIFIED — added Activity | Wishlist segmented control; WishlistGrid renders outside ScrollView (avoids nested FlatList issue)
- `napkin-app/app/restaurant/[id].tsx` — MODIFIED — WishlistHeartButton in top bar, `useMyWishlist` called to warm cache; `topBar` style updated to `flexDirection: row / space-between`

### Tests

- TypeScript: `npx tsc --noEmit` passes with zero errors
- ESLint: `expo lint` passes with zero errors (4 pre-existing warnings from other files)
- Deno edge function tests: all 31 steps pass (existing test suite, no new tests written for `wishlist` — pattern mirrors `table-management` which has its own test file at `index.test.ts`)
- App jest: no tests found (existing state), exits 0

### Builder Questions

1. **FlashList not installed.** The Technical Design specifies FlashList for `WishlistGrid` but `@shopify/flash-list` is not in `package.json`. I used `FlatList` from React Native instead. `estimatedItemSize` concern from the risk section doesn't apply. If FlashList is desired, `npm install @shopify/flash-list` and swap `FlatList` → `FlashList` in `WishlistGrid.tsx` — the data contract is identical.

2. **`list_table` uses a JS aggregation loop instead of a SQL GROUP BY.** The edge function fetches all matching `wishlist_items` rows for a Table's members and groups them in Deno (not via a SQL aggregate). This is simpler to reason about and correct for typical Table sizes (5–15 members × ~20 saves = ≤300 rows). If Table sizes grow significantly, a native SQL `GROUP BY restaurant_id` with a JOIN to `profiles` would be more efficient — noted as a future optimization.

3. **The TICKET-015 wishlist files were included in the TICKET-017 commit** (`c83383f`) rather than a standalone TICKET-015 commit. This is because `feat/TICKET-017` was already branched from a state that expected TICKET-015 to be built first. The work is shipped to `main` as part of that merged commit.

---

## Review History

### Review 1
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 11/13 acceptance criteria met
- [x] Migration creates `wishlist_items` table with correct columns, unique + secondary indexes — PASS
- [x] Edge function `wishlist` with four actions routed by body `action` — PASS (add / remove / list_personal / list_table all present; Places upsert folded into `add`)
- [x] All actions require authenticated user; `list_table` rejects non-members with 403 — PASS (`supabase/functions/wishlist/index.ts:47–62, 175–185`)
- [~] `WishlistHeartButton` with saved/unsaved states + optimistic toggle + rollback + toast — WARN: uses `Alert.alert` instead of a toast (builder called this out; matches repo pattern), and rollback is done by flipping local state while the underlying `useIsWishlisted` may still show stale server truth. Functional but not a proper toast.
- [x] `WishlistGrid` two-column masonry-ish with variable heights, Heirloom palette — PASS (FlatList fallback, variable aspect via onLoad)
- [x] Personal view: tap → restaurant page, long-press → confirmation sheet — PASS
- [x] Table view: overlap chip + avatar stack, read-only long-press — PASS
- [x] Table view empty state copy — PASS (`WishlistGrid.tsx:43–54`, matches spec wording)
- [~] Tables tab sub-tab — PASS (Activity | Wishlist segmented control wired into `tables.tsx`; matches the Technical Design adaptation of the AC's "sub-tab")
- [x] Settings → "My Wishlist" → `/wishlist` — PASS
- [x] Hooks live in `hooks/wishlist/` with the five specified hooks + invalidations — PASS
- [x] `add` with `place_id` persists the restaurant and the wishlist row in a single round-trip — PASS (Places upsert folded into action)
- [x] Leaving a Table is a no-op for `wishlist_items` — PASS (no FK to `table_members`; schema enforces)

Correctness: WARN — idempotency bug on re-add; `useIsWishlisted` truncation risk; aggregation skips users without profiles.
Edge Cases: WARN — heart on ghost restaurant cannot be un-saved (handled by silently rolling back, but the UX is confusing).
Error Handling: PASS — unauthorized, 403 non-member, 400 missing params, generic 500 with details.
Security: PASS — service role + manual `getUser`; 403 on non-member table access; RLS policies defined and scoped correctly.
Performance: WARN — `list_table` fetches all wishlist rows for all members with no SQL-side aggregation (builder acknowledged this); acceptable for v1.
Design Compliance: PASS — doctrine-locked schema (no `table_id` column), folded Places upsert, idempotent add, capped member sample, matches Heirloom palette tokens.

Key issues:

1. **`add` overwrites existing `note` on re-add** — `supabase/functions/wishlist/index.ts:89–100` calls `.upsert(..., { ignoreDuplicates: false })` with `note: body.note ?? null`. Re-hearting an already-saved restaurant (common idempotent path from the heart button) writes `null` over any previously saved `note`. Acceptance criterion says "re-adding returns existing row, no error" and idempotency implies no silent data loss. Fix: either switch to `ignoreDuplicates: true` + a follow-up select to return the existing row, or conditionally only include `note` in the payload when provided, or use a proper Postgres `INSERT ... ON CONFLICT DO NOTHING RETURNING`.

2. **`useIsWishlisted` is silently wrong past page 1** — `napkin-app/hooks/wishlist/useIsWishlisted.ts:19–25` flattens only the currently-loaded pages of `useMyWishlist` (40/page). A user with >40 saves who opens a restaurant page for something saved months ago will see an unsaved heart, tap it, and the server `upsert` succeeds without error (idempotent) — but the optimistic state then clashes when the eventual refetch resolves. The "warm the cache" mitigation in the restaurant page (`useMyWishlist(user?.id)`) only loads page 1. Fix: add a lightweight `/wishlist?action=is_saved&restaurant_id=X` server check, or ensure the mutation's optimistic `onMutate` also updates the local cache so the heart stays in sync regardless of pagination.

3. **`list_table` silently drops members without a `profiles` row** — `supabase/functions/wishlist/index.ts:220` uses `profiles!inner`. If a Table member has a wishlist item but no profiles row (edge case, but `profiles` is keyed by `user_id` and only inserted via the signup trigger), their save is excluded from the count and the overlap number is wrong. Fix: use a left join (`profiles(...)` without `!inner`) and handle nulls in the aggregation.

4. **Heart button on a ghost restaurant cannot be un-saved in the same session** — `WishlistHeartButton.tsx:91–97` short-circuits removal when `restaurantId` is undefined, silently rolling back. If the user hearts a Places result (which upserts and returns a real `id` on the server), the component has no mechanism to learn the new `id`, so a subsequent un-heart within the same mount is a no-op. Fix: have `useWishlistAdd` return the resolved `restaurant_id` and thread it back into the button, or require the parent (e.g., the search result row) to re-render with the persisted id after the mutation resolves.

5. **Segmented control UX on personal-wishlist-empty** — when `activeTable` is the user's personal Table and they have no saves, the Table Wishlist view returns the personal empty state copy — which is fine — but the copy says "start hearting restaurants and they'll show up here for your Table" in a context that IS their personal Table. Minor polish; not a blocker.

6. **Toast vs. `Alert.alert`** — `WishlistHeartButton.tsx:87, 101` uses `Alert.alert`. Acceptance criterion says "rolls back on mutation error and shows a toast." Builder noted no toast library exists; acceptable deviation but flagged as WARN. Track as tech debt if a toast library is later introduced.

7. **`list_table` aggregation loop is O(N × M) without a hard row limit before aggregation** — `supabase/functions/wishlist/index.ts:202–226` fetches every wishlist row for every member of the Table with no server-side limit. The post-aggregation `.slice(0, 200)` helps the response size but not the fetch cost. For a 50-member Table with heavy savers this is a multi-thousand-row pull per request. Builder acknowledged; acceptable v1 but add a defensive `.limit()` on the fetch.

### Review 2
Date: 2026-04-16
Verdict: APPROVE

Spec compliance: 13/13 acceptance criteria met (no regressions from cycle 1 PASS items)
- [x] Blocker 1 — idempotent `add` does not overwrite `note` — PASS (`supabase/functions/wishlist/index.ts:89-99` selects-first and returns existing row untouched; fresh inserts go through the `.insert(...)` path on 101-109)
- [x] Blocker 2 — `useIsWishlisted` correct past page 1 — PASS (`napkin-app/hooks/wishlist/useIsWishlisted.ts:22-37` uses `useQuery` against new `check` action; cache-independent of `useMyWishlist` pagination)
- [x] Blocker 3 — `list_table` no longer drops profile-less members — PASS (`supabase/functions/wishlist/index.ts:247` changed `profiles!inner` → `profiles`; aggregation handles null profile via `?.display_name ?? null` on 281-282)
- [x] Blocker 4 — ghost-restaurant heart removable in-session — PASS (`WishlistHeartButton.tsx:93` falls back to `addMutation.data?.restaurant_id`)

Correctness: PASS — all four regressions from Review 1 resolved; optimistic cache writes keep `check` key consistent with add/remove.
Edge Cases: PASS — `maybeSingle()` used for existence check (no throw on zero rows); disabled-query branch for `useIsWishlisted` when restaurantId/userId missing.
Error Handling: PASS — unchanged from cycle 1 (was already PASS); new `check` action validates `restaurant_id` presence and returns 400.
Security: PASS — `check` action goes through same auth gate as other actions; returns only a boolean, no data leakage.
Performance: WARN — unchanged: `list_table` still does fetch-then-JS-aggregate with no `.limit()` on the fetch (cycle 1 issue #7 — acknowledged v1 tradeoff, not a blocker).
Design Compliance: PASS — fixes align with Technical Design; `check` action fits the body-action routing pattern; cache-key addition to `queryKeys.ts` follows existing convention.

Key issues:
None blocking. Minor observations:
1. **Unique-constraint race in `add`** — `supabase/functions/wishlist/index.ts:89-109`: select-then-insert is not atomic. Two concurrent `add` calls for the same `(user_id, restaurant_id)` can both pass the existence check and race on insert; the loser hits the unique index and surfaces as a 500. Extremely unlikely in practice (same user double-tapping the heart with network parallelism), and the client has optimistic state that papers over it. If you want to be tidy, catch Postgres error code `23505` on the insert and re-select. Not a blocker.
2. **Cycle-1 items #5 (personal-table empty-state copy), #6 (Alert vs. toast), and #7 (fetch limit) remain untouched.** These were WARN/polish in cycle 1 and the user didn't ask for them to be addressed in cycle 2; noting they're still open.
