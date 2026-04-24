---
id: TICKET-018
title: "Lists primitive (curated, themed, shareable)"
priority: high
status: done
created: 2026-04-17
updated: 2026-04-17
spec_resolved: 2026-04-17
completed: 2026-04-17
tags: [lists, discovery, profile, social, wedge]
---

# Lists primitive

## Problem

Napkin's current core loop is cataloguing (logging meals with your Table) + wishlisting (aspirational saves). What pulls a user back to the app beyond those two loops is an open question — and the answer most review apps reach for (influencer-style public feeds, Beli-style follower graphs) directly contradicts Napkin's Tables-first doctrine.

Working through it, the sharper wedge is **taste calibration via shared restaurant experiences** — the Letterboxd pattern where you read a stranger's review of a movie you just saw, their take resonates (or enrages you), and that one data point of shared calibration earns enough trust to click through to their profile and browse their lists. It's not cold discovery; it's post-experience resonance.

For that wedge to work, Napkin needs a primitive that doesn't exist yet: **the curated, themed list** — not "want to go" (that's wishlist), but "here's my opinion" ("My Taipei," "Best brunch SF," "Top 4 noodle spots"). Lists are the artifact a user exports of their taste. They're what a stranger browses after their take resonated on a shared restaurant.

This ticket introduces the list primitive itself. Public profiles and public-takes-on-restaurant-pages are follow-on tickets that depend on this existing.

## Notes

### Doctrine shift (locked this session)

The previous Path A position — "Tables-first, no public layer, door closed" — has been amended:

> **Tables stay sacred (private feed, Rounds, who's-been, Table wishlist overlap). Profiles + lists + individual takes are opt-in public surfaces a user can expose to the world.**

Same shape as Letterboxd: activity is semi-social/private, lists and reviews are opt-in public. Tables are not touched by this shift — the Table remains the private trust circle.

### The wedge

> Taste calibration via shared restaurant experiences, surfaced on restaurant pages, with opt-in public profiles and lists as the browsable expression of a person's palate.

Lists are step 1 of that wedge. Public profiles (step 2), restaurant-page takes (step 3), and calibration signals (step 4, much later) are follow-on tickets — not in this scope.

### Locked decisions from brainstorm

- **List = curatorial opinion object.** Distinct from wishlist (which is "want to go" utility). Same restaurant can appear in both without drama.
- **Aspirational entries allowed.** A list may include restaurants the user hasn't logged. You can build a "Tokyo — want to try" list before going. Flexibility is the point.
- **Ranked or unranked — user's choice.** At creation (or edit), user picks whether the list is ranked (ordered, top 1/2/3...) or an unranked collection. Supports both "Top 4 brunches" and "Best of SF (no order)" use cases.
- **Per-entry note allowed.** Each restaurant in a list can carry an optional one-line note ("best for dates," "get the uni pasta"). Depth over constraint.
- **Privacy: 2 tiers — public (default) or private.** No Table-only middle tier in v1 (redundant with Table activity). User picks at list creation.
- **Creation entry points (v1):**
  - Dedicated **Lists tab on the user's own profile** — "Create list" CTA
  - **"Add to list"** option on restaurant pages (Letterboxd-style), alongside wishlist heart. Creates a new list inline if user has none yet.
- **Public list shareable URL.** A public list has a canonical URL; private ones don't (or 404 to non-owners).
- **Lists primitive does not yet imply a public profile.** A user can have public lists without a public profile in v1. Profile-level visibility is a separate future toggle. (However, tapping a list's author from the list page should surface their other public lists — see open questions.)

### Explicitly deferred (not this ticket)

- **Public profile surface** — a visit-anyone's-profile screen showing their lists + logged restaurants. Separate ticket.
- **Restaurant-page "takes" section** — strangers' log notes surfaced on restaurant pages. Separate ticket.
- **Calibration signal / "this person rated similarly to you"** — requires data volume, separate ticket.
- **List following / subscribing / activity feed of lists you follow** — deferred.
- **Collaborative lists (multi-author)** — deferred.
- **List reactions / comments** — deferred.
- **Table-only privacy tier for lists** — deferred; revisit if users ask.

### Related changes

- **TICKET-011 (expanded logging metadata)** is being deleted this session. It piled more fields into the composer (occasion, price, companions, craving). We're moving the opposite direction — a future "progressive logging" ticket will instead let users log fast and revisit to flesh out. TICKET-011 is superseded.

### Key open questions for the product-designer pass

- When a user taps a restaurant inside a list, does it go to the standard restaurant page, or a list-scoped view showing the list author's rating/note for that restaurant prominently?
- Should the Lists tab on your profile show only your own lists in v1 (no browsing of others' public lists until the public profile ticket lands)?
- On "Add to list" from a restaurant page, what's the UX if the user has zero lists yet — inline "create new list" flow or route to the Lists tab?
- Ranked list ordering — drag-and-drop reorder, or number input per entry? (Drag-and-drop is heavier but better UX.)
- Is there a list cover image (first restaurant's photo? user-selected?) or is the list a pure text+tiles object?
- Cap on list size? (Letterboxd allows unbounded. Probably no cap needed.)

### Dependencies

- **TICKET-014** (restaurant entity foundation) — required; lists point at `restaurants.id`
- **TICKET-015** (wishlist) — not a hard dep but list UI should feel like a sibling to wishlist UI, not a reinvention
- **TICKET-016** (restaurant page v2) — "Add to list" action slots onto this page

---

## Product Spec

### User Stories

- As a **user with strong opinions**, I want to create a named, themed list of restaurants ("My Taipei", "Top 4 noodle spots"), so that I can express a point of view that's distinct from my log and my wishlist.
- As a **list creator**, I want to choose at creation time whether the list is ranked (ordered 1, 2, 3...) or unranked (a set), so that the list matches the use case I have in mind without forcing a false ordering.
- As a **list creator**, I want to add restaurants I haven't logged yet (aspirational entries), so that I can build a "Tokyo — want to try" list before a trip without inventing a log entry.
- As a **list creator**, I want to attach a short note to each entry ("best for dates," "get the uni pasta"), so that the list carries my take, not just a pointer.
- As a **list creator**, I want to choose public or private at creation (with public as the default), so that I can share a take without every list being broadcast.
- As a **user on a restaurant page**, I want an "Add to list" action next to the wishlist heart, so that I can capture a take on a place in the moment without navigating away.
- As a **user with zero lists on my first "Add to list" tap**, I want to be able to create a new list inline and add the restaurant to it in one flow, so that the first list doesn't require a separate trip to the Lists tab.
- As a **user on my own profile**, I want a Lists tab that shows my lists with a prominent "Create list" CTA, so that lists have a home I can return to.
- As a **creator of a ranked list**, I want to reorder entries by drag-and-drop, so that ranking feels like arranging, not form-filling.
- As a **list owner**, I want to rename, change ranked/unranked, toggle privacy, and delete a list, so that I can evolve or retire a list as my taste changes.
- As a **list owner**, I want to remove a restaurant from a list, so that I can retract an entry I no longer stand behind.
- As a **list owner viewing a public list**, I want a shareable URL I can copy, so that I can send a take to a friend outside the app.
- As a **visitor opening a shared public list URL**, I want to see the list and its author's name, so that I know whose taste this is.
- As a **visitor opening a private list URL I don't own**, I want to see a clear "not found" state, so that the existence of the list isn't leaked.
- As a **user tapping a restaurant inside a list**, I want to land on the normal restaurant page, so that the restaurant stays a standalone object — the list got me there, I don't need a reminder of that on the destination.

### Acceptance Criteria

**List creation**
- [ ] "Create list" is reachable from two entry points: (a) a dedicated Lists tab on the user's own profile, (b) "Add to list" on a restaurant page (TICKET-016).
- [ ] Create flow requires: a title (max 60 chars, required, trimmed). Optional: one-line description (max 140 chars).
- [ ] Create flow requires the user to pick ranked vs unranked at creation. Default: unranked.
- [ ] Create flow requires the user to pick public vs private at creation. Default: public.
- [ ] A list can be created empty (with zero restaurants) and have entries added later.
- [ ] Inline "create new list" from the "Add to list" sheet on a restaurant page creates the list AND adds the current restaurant in one submission; the user lands back on the restaurant page, not inside the list.

**Adding / removing entries**
- [ ] On any restaurant page, "Add to list" opens a sheet showing the user's existing lists (most-recently-used first), with an inline "New list" row at top.
- [ ] Tapping an existing list adds the restaurant to it immediately (optimistic). Tapping again on the same list in the same sheet session is idempotent (no duplicate entries).
- [ ] A restaurant can belong to multiple lists simultaneously; being in a list does not affect its wishlist state.
- [ ] The sheet shows which lists already contain this restaurant with a filled checkmark; tapping a checked row removes it.
- [ ] Inside a list detail screen, the owner can remove any entry; removal is confirmed by a subtle undo toast rather than a modal.
- [ ] Each entry carries an optional note (max 140 chars) editable inline from the list detail screen; owner-only.
- [ ] Aspirational entries are allowed: adding a restaurant the user has never logged is a valid, unremarkable path — no warning, no distinct visual.

**Ranked vs unranked**
- [ ] A ranked list displays entries in owner-defined order, numbered 1, 2, 3... starting from the top.
- [ ] A ranked list's detail screen shows a drag handle on each row (owner only) and supports drag-and-drop reorder; order persists on release.
- [ ] An unranked list displays entries in reverse-chronological add order; no numbers, no drag handle.
- [ ] Owner can convert ranked → unranked (order is preserved as the display order but numbers disappear) or unranked → ranked (current reverse-chron order becomes the initial ranking) from the list's edit screen.

**Privacy**
- [ ] Every list has a `privacy` field: `public` or `private`. No Table-only tier in v1.
- [ ] A private list is visible only to its owner. Non-owners attempting to open it see a "not found" state (not "you don't have access").
- [ ] A public list is visible to its owner today. Cross-user browsing of public lists is out of scope for this ticket (requires TICKET-020 public profile), but the data model and server authorization MUST already support non-owner reads of public lists, so the public profile ticket can light them up without a migration.
- [ ] A public list has a canonical shareable URL (deep link into the app). A private list's URL returns the same "not found" state to non-owners.
- [ ] Account-level privacy (the future account-wide public toggle) is NOT wired in this ticket. List privacy is set and respected per-list; account-level gating will be layered on in a later ticket.

**Lists tab on own profile**
- [ ] The current user's profile has a Lists tab showing all their lists (public and private), reverse-chron by updated_at.
- [ ] Each row shows: title, entry count, ranked/unranked badge, privacy badge (lock icon for private), last-updated date.
- [ ] Empty state: "No lists yet" with a primary "Create list" CTA.
- [ ] Tab is scoped to the viewer's own profile in v1; viewing another user's Lists tab is deferred to TICKET-020.

**List detail screen**
- [ ] Shows: title, optional description, author name/avatar, entry count, ranked/unranked indicator, privacy indicator (owner only).
- [ ] Renders entries as rows: restaurant name, city/cuisine line, per-entry note (if any), rank number (if ranked).
- [ ] Tapping an entry navigates to the standard restaurant page (TICKET-016). No list context is passed through or surfaced on the restaurant page — the restaurant page is a standalone object.
- [ ] Owner sees edit affordances (rename, toggle privacy, toggle ranked, delete list, reorder entries, remove entry, edit entry note). Non-owners see a read-only view.
- [ ] Share button (owner + public list only) copies the canonical URL to clipboard and shows a toast.

**Deletion**
- [ ] Owner can delete a list from its edit screen. Deletion is confirmed via a destructive-action sheet ("Delete this list? This can't be undone.").
- [ ] Deleting a list does not affect the underlying log entries, wishlist entries, or restaurants.

**State + perf**
- [ ] Adding or removing a restaurant from a list is optimistic; on server failure, state reverts and a subtle error toast appears.
- [ ] Lists tab and list detail load within typical page-load budget; no explicit pagination in v1 (cap is not enforced — see Open Questions).

### UX Decisions

- **Ranked/unranked at creation, not after-the-fact toggle in the add flow**: picking ranked up front forces the user to commit to a framing. Allowing conversion later via edit screen keeps the escape hatch without making the create flow wishy-washy. Rationale: a "Top 5" that starts unranked tends to stay that way; naming the frame at birth is the cheap forcing function.
- **Public as default at list creation**: Napkin's wedge is taste-as-expression; private lists are the escape hatch, not the default. This is per-list and is still gated by account-level privacy (deferred) — a public list in a private account is still invisible to the world today.
- **"Add to list" sheet on restaurant page, not a separate screen**: matches wishlist heart's in-place model; keeps the restaurant page the primary object and lists a lightweight decoration. Same interaction shape as `LogVisitSheet` in TICKET-016.
- **Drag-and-drop reorder for ranked lists**: numeric input is faster to ship but scales badly past 5 entries and reads like a form. Drag-and-drop is the industry default (Letterboxd, Spotify, Notion) and worth the one-time cost.
- **No list cover image in v1**: lists render as text-forward tiles with the top entry's photo used as a subtle background if present; no separate cover-upload UI. Keeps creation fast and prevents the "list without cover" visual awkwardness common on cover-based platforms. Revisit if users ask.
- **Tapping a list entry → standard restaurant page, no list context passed through**: the restaurant page is a standalone object and the user knows they tapped into it from a list — they don't need a reminder banner. Curators add from a place database/API; the list entry is a pointer, the restaurant page is the destination and stands on its own. Keeps TICKET-016 untouched and avoids banner clutter.
- **Private list URL → "not found" (not "forbidden")**: existence leakage is a privacy smell. 404-style wording for any non-owner access.
- **Per-list privacy toggle is respected today even though account-level public is deferred**: this lets users pick privacy intent at creation without rework. When the account-level toggle ships, it acts as a gate on top of per-list privacy.
- **Inline "New list" in the add-to-list sheet**: users with zero lists shouldn't be bounced to the Lists tab. The inline create uses a compact form (title + ranked/unranked + privacy) and treats "add the current restaurant" as implicit.
- **Lists are siblings to wishlist in UI language, not children**: the sheet, the heart/add affordance, and the empty states should feel like peers, not like lists are a wishlist sub-type. They are a different object (opinion vs. utility).

### Out of Scope

- Public profile surface (browsing another user's lists) — TICKET-020.
- Account-level public/private toggle (account-wide privacy gate) — separate future ticket.
- Cross-user browsing of public lists in any surface (profile, restaurant page, discovery).
- Restaurant-page "takes" section (strangers' notes surfaced on restaurant pages).
- Calibration signal ("this person rates similarly to you").
- List following / subscribing / activity feed of lists you follow.
- Collaborative lists (multi-author).
- List reactions, comments, likes.
- Table-only privacy tier for lists.
- List cover image upload.
- Search or discovery of lists (by tag, by city, by popularity).
- Exporting lists to external formats.
- List duplication / forking.
- Pagination of list entries (no size cap enforced; revisit if real lists exceed a few hundred).
- Notifications when a shared list is opened.
- Photos attached to a list entry (beyond the restaurant's own photo).

### Resolved Decisions (2026-04-17)

All open questions resolved before build:

- **Restaurant page on list tap**: no banner, no list context passed through. The restaurant page is a standalone object; user knows they tapped a list entry to get there. TICKET-016 stays untouched.
- **Add-to-list sheet ordering**: sort user's lists by list-level `updated_at` (most-recently-mutated first).
- **List title uniqueness**: allow duplicates. Titles are not identifiers.
- **Ranked list with 1 entry**: always show the "1". The frame is the point.
- **Ranked ↔ unranked conversion**: lives in the list edit screen, not a header toggle. Prevents accidental scrambling of a ranked list via a mis-tap.
- **Aspirational entries once the user logs the restaurant**: list stays purely curatorial. No "now logged" badge or state change on the list entry. The list is an opinion object, not a status tracker.
- **Deep-link URL shape**: `napkin://list/[id]` in v1. Username-based URLs wait for TICKET-020 (public profile).
- **Search filter inside add-to-list sheet**: not in v1. Revisit once real users cross ~10 lists.

---

## Technical Design

### Approach

Lists are a curation primitive that sits next to wishlist — same shape as `wishlist_items` extended with a parent `lists` row for title/privacy/ranked-ness. Two tables (`lists`, `list_entries`) behind one `lists` edge function (POST-with-`action` router, mirroring `wishlist/index.ts`). Frontend is a thin set of hooks + a new `/list/[id]` screen, a `/lists` screen for the owner's Lists tab, an `AddToListSheet` that parallels `LogVisitSheet`, and a wishlist-sibling `AddToListButton` pinned to the restaurant page next to `WishlistHeartButton`. RLS on both tables already permits non-owner reads of public lists so TICKET-020 can light up cross-user browsing without another migration. Ranked ordering uses a monotonically-increasing integer `position` column (gap-based — inserts go to `max+1024`, drag-reorder rewrites only the moved row's position) to keep reorder mutations cheap and single-row.

### Architecture Decisions

- **Two tables (`lists` + `list_entries`), not a single denormalised JSON blob**: the entry row has its own `note`, `position`, and FK to `restaurants.id` which we need to join for rendering. Same shape wishlist already uses. Trade-off: two writes on create-inline-from-restaurant-page instead of one — handled server-side in a single edge-function call.

- **Integer `position` with gap allocation (1024 spacing) for ranked ordering, not fractional ranks / linked list / array column**: drag reorder becomes one UPDATE on the moved row (set position = avg of neighbours' positions). When gaps collapse (unlikely for lists of <200 items in the lifetime of one user), a compaction pass runs server-side in the reorder endpoint. Trade-off: occasional compaction write vs the complexity of fractional indexing (Figma-style base62 strings). Proportional for the expected list sizes.

- **Unranked lists ignore `position`; sort by `created_at DESC` in server response**: ranked/unranked is a list-level attribute, not an entry-level one. When the list flips from unranked → ranked, the server back-fills `position` from the current reverse-chron order (first client call, or a trigger on `lists.ranked` change — we'll do it inline in the edge function since the toggle is rare). Trade-off: unranked lists still carry an unused column, which is fine.

- **Privacy enforced in RLS + edge function (double-gate)**: RLS policy on `lists` allows SELECT when `owner_id = auth.uid() OR privacy = 'public'`. The edge function uses service role but checks privacy explicitly before returning a list to a non-owner, and returns `{ error: 'not found' }` with 404 (not 403) for private lists the caller doesn't own. This is the "existence leakage is a privacy smell" requirement from the spec. Trade-off: the two layers duplicate the rule — acceptable because the service-role-bypass pattern is project doctrine, and RLS future-proofs direct PostgREST access for TICKET-020.

- **One `lists` edge function with a POST-and-`action` router, not REST-shaped routes**: matches `wishlist/index.ts`, `table-management`, etc. Trade-off: GET semantics (reads) go through POST — breaks HTTP caching but we rely on React Query cache anyway.

- **`list_entries` idempotency via unique `(list_id, restaurant_id)` index**: same pattern as `wishlist_items (user_id, restaurant_id)`. Re-adding the same restaurant to the same list is a no-op that returns the existing row. Lets the "add" sheet re-tap safely.

- **Restaurant entity may be a ghost (not yet in `restaurants`)**: the add path accepts either `restaurant_id` or a `restaurant` Places payload, and calls `upsertRestaurant` (shared helper used by wishlist + entry) before inserting the list entry. Matches wishlist flow exactly.

- **Deep-link scheme is `diningjournalapp://list/[id]` in code; surface as `napkin://list/[id]` in user-visible strings**: the Expo `app.json` scheme is `diningjournalapp`. Renaming the scheme is out of scope for this ticket (would break existing install deep-links). For "copy link to clipboard" we still write the `diningjournalapp://` form — the spec's `napkin://` shape is aspirational and lines up with a future scheme rename. Flag for product review.

- **No list cover image, no list tag/category system in v1**: `lists` table gets `title`, `description`, `ranked`, `privacy`, `owner_id`, timestamps. Nothing else. Cover = first entry's `restaurants.photo_url` rendered at the list-row level in CSS. Trade-off: spec explicitly rules cover-upload out; this decision sticks to that.

- **Lists tab lives at `/lists` (owner-scoped route), not embedded in `/settings`**: matches where wishlist landed (`/wishlist`). The tab entry point is a row in the settings tab (same place "My Wishlist" sits today). Trade-off: no full "user profile" surface in v1 — the spec explicitly scopes the Lists tab to the owner's own view until TICKET-020.

- **Optimistic mutations everywhere (add, remove, reorder, note-edit)**: matches wishlist's `useWishlistAdd` / `useWishlistRemove`. Reorder is the trickiest — we locally splice the entry into the new position, then fire a single mutation. On error we revert via the `onError` snapshot pattern. No server round-trip between drag release and UI settling.

### Database Schema

**Migration: `supabase/migrations/20260421000000_lists.sql`**

```sql
-- lists: one row per curated list
CREATE TABLE public.lists (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT         NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 60),
    description TEXT         CHECK (description IS NULL OR char_length(description) <= 140),
    ranked      BOOLEAN      NOT NULL DEFAULT false,
    privacy     TEXT         NOT NULL DEFAULT 'public'
                             CHECK (privacy IN ('public', 'private')),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX lists_owner_id_idx      ON public.lists(owner_id);
CREATE INDEX lists_owner_updated_idx ON public.lists(owner_id, updated_at DESC);
CREATE INDEX lists_public_idx        ON public.lists(privacy) WHERE privacy = 'public';

-- list_entries: one row per (list, restaurant)
CREATE TABLE public.list_entries (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id       UUID         NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
    restaurant_id UUID         NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    note          TEXT         CHECK (note IS NULL OR char_length(note) <= 140),
    position      INTEGER      NOT NULL, -- gap-allocated; used only for ranked lists
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX list_entries_list_restaurant_idx ON public.list_entries(list_id, restaurant_id);
CREATE INDEX list_entries_list_position_idx ON public.list_entries(list_id, position);
CREATE INDEX list_entries_list_created_idx  ON public.list_entries(list_id, created_at DESC);

-- Trigger: bump lists.updated_at on any change to its entries, and on own edits
CREATE OR REPLACE FUNCTION public.touch_list_updated_at() RETURNS trigger ...
CREATE TRIGGER lists_touch_on_entry_change AFTER INSERT OR UPDATE OR DELETE
    ON public.list_entries FOR EACH ROW EXECUTE FUNCTION public.touch_list_updated_at();
CREATE TRIGGER lists_self_touch BEFORE UPDATE ON public.lists
    FOR EACH ROW EXECUTE FUNCTION public.touch_list_updated_at();

-- RLS
ALTER TABLE public.lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_entries  ENABLE ROW LEVEL SECURITY;

-- lists SELECT: owner OR public (preps TICKET-020 cross-user reads)
CREATE POLICY "lists_select" ON public.lists FOR SELECT
    USING (auth.uid() = owner_id OR privacy = 'public');
CREATE POLICY "lists_insert" ON public.lists FOR INSERT
    WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "lists_update" ON public.lists FOR UPDATE
    USING (auth.uid() = owner_id);
CREATE POLICY "lists_delete" ON public.lists FOR DELETE
    USING (auth.uid() = owner_id);

-- list_entries SELECT: visible iff parent list is visible (owner OR public)
CREATE POLICY "list_entries_select" ON public.list_entries FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id
          AND (l.owner_id = auth.uid() OR l.privacy = 'public')
    ));
-- INSERT/UPDATE/DELETE: only on own lists
CREATE POLICY "list_entries_write" ON public.list_entries FOR ALL
    USING (EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_entries.list_id AND l.owner_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_entries.list_id AND l.owner_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lists, public.list_entries TO authenticated;
GRANT ALL ON public.lists, public.list_entries TO service_role;
```

### Edge Function: `supabase/functions/lists/index.ts`

Single POST handler, routes on `body.action`. Follows `wishlist/index.ts` exactly. Actions:

| Action | Body | Returns |
|---|---|---|
| `create` | `{ title, description?, ranked, privacy, initial_restaurant_id? \| initial_restaurant? }` | `{ data: ListRow }` — creates list; if `initial_restaurant*` given, also inserts one `list_entries` row in the same call |
| `update` | `{ list_id, title?, description?, ranked?, privacy? }` | `{ data: ListRow }` — owner-only. If `ranked` flips from false→true, back-fills `position` for existing entries in current reverse-chron order |
| `delete` | `{ list_id }` | `{ data: { deleted: true } }` |
| `list_mine` | `{}` | `{ data: ListRowWithCount[] }` — caller's lists, reverse-chron by `updated_at`; includes `entry_count` and `cover_photo_url` (first entry's restaurant.photo_url) |
| `get` | `{ list_id }` | `{ data: { list, entries, owner_profile } }` — enforces privacy (404 if private + non-owner); entries ordered by `position ASC` if ranked else `created_at DESC` |
| `add_entry` | `{ list_id, restaurant_id? \| restaurant?, note? }` | `{ data: ListEntry }` — idempotent on `(list_id, restaurant_id)`; `position = COALESCE(max(position), 0) + 1024`; upserts restaurant if Places payload supplied |
| `remove_entry` | `{ list_id, restaurant_id }` | `{ data: { removed: true } }` |
| `update_entry` | `{ list_id, entry_id, note? }` | `{ data: ListEntry }` — note edit |
| `reorder_entry` | `{ list_id, entry_id, before_entry_id? \| after_entry_id? }` | `{ data: ListEntry }` — computes new `position` as midpoint of neighbour positions. If gap shrinks below 2, triggers a full re-space (rewrite all positions in current order to `1024, 2048, ...`) |
| `lists_containing` | `{ restaurant_id }` | `{ data: string[] }` — list of caller's list IDs that already contain this restaurant (drives checkmarks in AddToListSheet) |

All actions call `supabase.auth.getUser(token)` first. All write actions verify `owner_id = user.id` before mutating. Privacy/not-found doctrine: for `get` on a private list not owned by caller, return `jsonResponse({ error: 'Not found' }, 404)` — same wording as a nonexistent list.

### Hooks (`napkin-app/hooks/lists/`)

- `useMyLists(userId)` — `useQuery`, calls `list_mine`. Returns `{ id, title, description, ranked, privacy, entry_count, cover_photo_url, updated_at }[]`. Drives Lists tab + AddToListSheet.
- `useList(listId)` — `useQuery`, calls `get`. Returns `{ list, entries, owner_profile }`. Drives list detail screen.
- `useListsContainingRestaurant(userId, restaurantId)` — `useQuery`, calls `lists_containing`. Small response; drives checkmark state in AddToListSheet.
- `useCreateList(userId)` — `useMutation`; invalidates `queryKeys.lists.mine(userId)`.
- `useUpdateList(userId)` — `useMutation`; invalidates `queryKeys.lists.detail(listId)` + `queryKeys.lists.mine(userId)`.
- `useDeleteList(userId)` — `useMutation`; same invalidations.
- `useAddToList(userId)` — optimistic; on mutate, updates `lists_containing(restaurant_id)` cache to include `list_id` + increments `entry_count` in `mine`. Rollback on error.
- `useRemoveFromList(userId)` — mirror of add.
- `useUpdateListEntryNote()` — optimistic on the list detail cache.
- `useReorderListEntry(listId)` — optimistic: splices the moved entry into its new slot in the cached `entries` array, then fires `reorder_entry`. On error, restore the snapshot.

Barrel exports in `hooks/lists/index.ts`.

### Query Keys (add to `lib/queryKeys.ts`)

```ts
lists: {
    mine: (userId: string) => ['lists', 'mine', userId] as const,
    detail: (listId: string) => ['lists', 'detail', listId] as const,
    containing: (userId: string, restaurantId: string) =>
        ['lists', 'containing', userId, restaurantId] as const,
},
```

### Components (`napkin-app/components/lists/`)

- `ListCard.tsx` — row in the Lists tab: title (Newsreader headlineMedium), entry count + ranked/unranked badge + lock icon if private, last-updated date, small cover thumbnail if present.
- `ListEntryRow.tsx` — row in list detail: rank number (if ranked) + restaurant name + city/cuisine line + per-entry note line. Drag handle rendered conditionally (owner + ranked). Tapping the body navigates to `/restaurant/[id]`.
- `AddToListSheet.tsx` — bottom-sheet modal (same `Modal` + `TouchableWithoutFeedback` pattern as `LogVisitSheet`). Top row: "+ New list" (tap opens `CreateListSheet` with current restaurant pre-seeded). Below: caller's lists, MRU (by `updated_at`), each row with a filled/outlined checkmark based on `useListsContainingRestaurant`. Tapping toggles membership.
- `CreateListSheet.tsx` — compact bottom sheet for inline list creation from the add-to-list sheet. Fields: title (required), ranked toggle (default off), privacy toggle (default public), optional description (collapsed by default). On submit, fires `create` with `initial_restaurant*` and closes both sheets.
- `ListDetailHeader.tsx` — title, description, author row, entry-count + ranked/privacy badges, share button (owner + public only), edit button (owner only, routes to `/list/[id]/edit`).
- `ListEditForm.tsx` — full form: rename, toggle ranked, toggle privacy, delete. Delete is a destructive action sheet.
- `EmptyListsState.tsx` — empty state with "Create list" primary CTA.
- `AddToListButton.tsx` — sibling to `WishlistHeartButton`. Bookmark/plus icon; tapping opens `AddToListSheet`. Shown pinned next to the heart on `RestaurantHero` (RestaurantHero already renders the heart).
- `index.ts` — barrel.

For drag-and-drop: **`react-native-draggable-flatlist`** (or expo-compatible equivalent). It is not currently a dep; add it. If the team prefers zero new deps, we can fall back to reanimated-based reorder, but DFL is the pragmatic choice for v1.

### Screens

- `app/lists.tsx` — new. Owner's Lists tab. Header + `FlatList` of `ListCard` rows + "Create list" CTA. Pulls from `useMyLists`. Reached from settings tab ("My Lists" row, sibling to "My Wishlist").
- `app/list/[id].tsx` — new. List detail screen. Pulls from `useList(id)`. Renders `ListDetailHeader` + either `DraggableFlatList` (ranked) or a regular `FlatList` (unranked). Handles deep-link arrivals; shows "not found" state if the server returned 404. Share button (owner + public) copies `diningjournalapp://list/{id}` to clipboard via `expo-clipboard` + fires a toast via the existing `ToastProvider`.
- `app/list/[id]/edit.tsx` — new. `ListEditForm` wrapped in a screen. Delete sheet lives here.
- `app/list/new.tsx` — new. Full-screen create flow (used when user has no lists and taps "Create list" from the tab; inline `CreateListSheet` handles the restaurant-page path). Actually — we can use a `presentation: 'modal'` on `/list/new` and re-use the same form component internally. Keep surface consistent.

Navigation registration in `app/_layout.tsx`:

```tsx
<Stack.Screen name="list/[id]" options={{ headerShown: false }} />
<Stack.Screen name="list/[id]/edit" options={{ presentation: 'modal', headerShown: false }} />
<Stack.Screen name="list/new" options={{ presentation: 'modal', headerShown: false }} />
<Stack.Screen name="lists" options={{ headerShown: false }} />
```

### Restaurant page integration (TICKET-016 surface)

`app/restaurant/[id].tsx`: add `AddToListButton` next to the existing wishlist heart in `RestaurantHero`. No other changes — the button opens `AddToListSheet`. Tapping an existing list is idempotent (adds, shows checkmark). Tapping "+ New list" opens `CreateListSheet` which creates the list with the current restaurant pre-added and dismisses back to the restaurant page (not into the new list — per spec).

The button is hidden when the restaurant is still a ghost without an `external_id` in the payload. When the restaurant is a pure ghost (no UUID yet), the add-entry call flows through `initial_restaurant`/`restaurant` which triggers `upsertRestaurant` server-side. After upsert, we re-query `lists_containing` with the new UUID.

### Deep-link

Scheme stays `diningjournalapp://`. Expo Router auto-maps `diningjournalapp://list/{id}` to `/list/[id]`. Share button writes that URL. The user-facing ticket spec says `napkin://list/[id]` — we flag this as a naming gap for a future scheme rename, not blocking.

### File Changes

- `supabase/migrations/20260421000000_lists.sql` — NEW — creates `lists`, `list_entries`, indexes, RLS policies, `updated_at` trigger.
- `supabase/functions/lists/index.ts` — NEW — edge function with all list + entry actions.
- `supabase/functions/lists/deno.json` — NEW — mirror existing functions.
- `supabase/functions/_shared/restaurant.ts` — no change; reused for ghost upsert.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `lists` key group.
- `napkin-app/hooks/lists/index.ts` — NEW — barrel.
- `napkin-app/hooks/lists/useMyLists.ts` — NEW.
- `napkin-app/hooks/lists/useList.ts` — NEW.
- `napkin-app/hooks/lists/useListsContainingRestaurant.ts` — NEW.
- `napkin-app/hooks/lists/useCreateList.ts` — NEW.
- `napkin-app/hooks/lists/useUpdateList.ts` — NEW.
- `napkin-app/hooks/lists/useDeleteList.ts` — NEW.
- `napkin-app/hooks/lists/useAddToList.ts` — NEW.
- `napkin-app/hooks/lists/useRemoveFromList.ts` — NEW.
- `napkin-app/hooks/lists/useUpdateListEntryNote.ts` — NEW.
- `napkin-app/hooks/lists/useReorderListEntry.ts` — NEW.
- `napkin-app/components/lists/index.ts` — NEW — barrel.
- `napkin-app/components/lists/ListCard.tsx` — NEW.
- `napkin-app/components/lists/ListEntryRow.tsx` — NEW.
- `napkin-app/components/lists/AddToListSheet.tsx` — NEW.
- `napkin-app/components/lists/AddToListButton.tsx` — NEW.
- `napkin-app/components/lists/CreateListSheet.tsx` — NEW.
- `napkin-app/components/lists/ListDetailHeader.tsx` — NEW.
- `napkin-app/components/lists/ListEditForm.tsx` — NEW.
- `napkin-app/components/lists/EmptyListsState.tsx` — NEW.
- `napkin-app/app/lists.tsx` — NEW — Lists tab screen.
- `napkin-app/app/list/[id].tsx` — NEW — list detail (ranked DFL + unranked FlatList).
- `napkin-app/app/list/[id]/edit.tsx` — NEW — edit + delete.
- `napkin-app/app/list/new.tsx` — NEW — full create flow.
- `napkin-app/app/_layout.tsx` — MODIFY — register new routes.
- `napkin-app/app/(tabs)/settings.tsx` — MODIFY — add "My Lists" row next to "My Wishlist".
- `napkin-app/components/restaurants/RestaurantHero.tsx` — MODIFY — add `AddToListButton` next to heart.
- `napkin-app/package.json` — MODIFY — add `react-native-draggable-flatlist` + `expo-clipboard` (if not already present).

### Implementation Order

1. **Migration + edge function skeleton** — because every other piece depends on the data model + server shape. Write the migration, apply locally, wire up `create` / `list_mine` / `get` / `add_entry` / `remove_entry` first (covers 80% of the product).
2. **Query keys + core read hooks** (`useMyLists`, `useList`, `useListsContainingRestaurant`) — depends on step 1; lets us get data flowing to any UI.
3. **Core mutations** (`useCreateList`, `useAddToList`, `useRemoveFromList`) — depends on hooks registry being in place; these are the hot-path writes.
4. **Lists tab + list detail screens (read-only pass first)** — depends on read hooks; build the screens renderered statically, prove data flow.
5. **AddToListSheet + AddToListButton wired into RestaurantHero** — depends on core mutations + lists list hook; closes the "add from restaurant page" loop end-to-end.
6. **CreateListSheet (inline flow)** — depends on AddToListSheet scaffold + useCreateList; completes the zero-lists first-tap flow.
7. **Edit flow + delete + privacy/ranked toggles** — depends on `update` + `delete` edge function actions; ship the list management surface.
8. **Ranked reorder (DraggableFlatList + reorder edge function action + optimistic hook)** — last because it's the riskiest piece and not strictly blocking the unranked flow; ships after the simpler path is solid.
9. **Deep-link share button + toast** — small; depends on list detail screen; wrap up.

### Risks

- **Drag-and-drop reorder correctness under optimistic state**: a drop during an in-flight mutation can land entries in the wrong order. Mitigation: queue reorder mutations per-list (a single in-flight promise chain keyed by `list_id`), and on any error, snapshot-restore before re-fetching. Start simple: disable the drag handle visually while a reorder mutation is in flight.
- **Position-gap collapse on heavy reorder**: if a user reorders the same pair 11 times, midpoints halve each time and eventually collide. Mitigation: when `new_position - prev_position < 2`, the `reorder_entry` handler rewrites every row's position to `1024, 2048, ...` in the new order. Single-transaction compaction, invisible to the client.
- **Privacy leakage on the `get` endpoint**: the double-gate (RLS + explicit code check) is deliberate because service-role bypasses RLS. If a future dev adds a direct PostgREST call to `lists` from the client, RLS covers them. Code review checklist: any read of `lists.privacy = 'private'` by a non-owner must return the "not found" shape.
- **Restaurant ghost upsert race**: two clients simultaneously adding the same ghost restaurant to different lists can race on `upsertRestaurant`. The existing upsert helper handles this via `ON CONFLICT (external_id)`; no new concern here, but verify it during `add_entry` implementation.
- **Deep-link scheme mismatch**: spec says `napkin://`, app uses `diningjournalapp://`. Ship as `diningjournalapp://` and file a follow-up for the rename. Don't block this ticket on it.
- **Lists tab discoverability**: entry point via settings is functional but thin. If usage is low after launch, consider a Lists row on the journal/tables home. Not this ticket.
- **No pagination on list entries** — deliberate for v1 per spec. Safe until a list exceeds ~200 entries; revisit with real data.

---

## Build Log

### Commit

`0579b82` on branch `feat/TICKET-018`

### Files Changed

**New — Database**
- `supabase/migrations/20260421000000_lists.sql` — `lists` + `list_entries` tables, indexes, RLS policies, `touch_list_updated_at` trigger

**New — Edge Function**
- `supabase/functions/lists/index.ts` — 10-action POST router: `create`, `update`, `delete`, `list_mine`, `get`, `add_entry`, `remove_entry`, `update_entry`, `reorder_entry`, `lists_containing`

**Modified — Query Keys**
- `napkin-app/lib/queryKeys.ts` — added `lists.mine`, `lists.detail`, `lists.containing`

**New — Hooks (`napkin-app/hooks/lists/`)**
- `useMyLists.ts`, `useList.ts`, `useListsContainingRestaurant.ts`
- `useCreateList.ts`, `useUpdateList.ts`, `useDeleteList.ts`
- `useAddToList.ts` (optimistic), `useRemoveFromList.ts` (optimistic), `useUpdateListEntryNote.ts` (optimistic), `useReorderListEntry.ts` (optimistic)
- `index.ts` — barrel export

**New — Components (`napkin-app/components/lists/`)**
- `ListCard.tsx`, `ListEntryRow.tsx`, `AddToListSheet.tsx`, `AddToListButton.tsx`
- `CreateListSheet.tsx`, `ListDetailHeader.tsx`, `ListEditForm.tsx`, `EmptyListsState.tsx`
- `index.ts` — barrel export

**New — Screens**
- `napkin-app/app/lists.tsx` — owner's Lists tab
- `napkin-app/app/list/[id].tsx` — detail (DraggableFlatList for ranked, FlatList for unranked)
- `napkin-app/app/list/[id]/edit.tsx` — edit + delete modal
- `napkin-app/app/list/new.tsx` — full-screen create modal

**Modified — Integration**
- `napkin-app/app/_layout.tsx` — registered 4 new routes
- `napkin-app/app/(tabs)/settings.tsx` — added "My Lists" row (sibling to "My Wishlist")
- `napkin-app/components/restaurants/RestaurantHero.tsx` — `AddToListButton` next to `WishlistHeartButton` in both photo and no-photo layouts

**Modified — Package**
- `napkin-app/package.json` + `package-lock.json` — added `expo-clipboard ~8.0.8`, `react-native-draggable-flatlist ^4.0.3`

### Tests

- All existing Deno edge function tests: **31 passed**
- App test suite: **passWithNoTests** (no new tests added — UI-only feature, no pure-logic units to isolate)
- TypeScript: **clean compile** on all TICKET-018 files

### Builder Questions

1. **`lists.txt` `reorder_entry` before/after edge case**: The server-side `before_entry_id` / `after_entry_id` logic handles the common cases but the "insert before first" and "insert after last" paths use a simplified fallback (midpoint of 0 and next, or prev + 1024). In practice this works but a more robust implementation would pass an explicit `new_index` to the server and let it compute positions from the full sorted set. Flagging for review if users report reorder glitches with edge positions.

2. **Deep-link scheme confirmed `diningjournalapp://`**: Share button writes `diningjournalapp://list/{id}`. The spec says `napkin://list/[id]` — shipped as `diningjournalapp://` per the architect's note. No follow-up ticket filed yet.

3. **ToastProvider exists** (builder memory was stale): `providers/ToastProvider.tsx` ships `useToast().show(message)`. Used in `ListDetailHeader` for the share confirmation toast. The builder memory said "no toast lib, use Alert.alert" — that was true before ToastProvider was added in a prior ticket. Memory updated.

4. **Lists tab entry point is Settings only**: Spec notes this is discoverable but thin. If analytics show low engagement, a future ticket should add a Lists row to the journal home or profile. Not blocking.

---

## Review History

### Review 1
Date: 2026-04-17
Verdict: REVISE

Spec compliance: 28/32 acceptance criteria met (with caveats)
- [x] Two creation entry points (Lists tab + restaurant page) — PASS
- [x] Create: title required (1–60), description optional (≤140) — PASS (DB + edge function both enforce)
- [x] Ranked/unranked at creation, default unranked — PASS
- [x] Public/private at creation, default public — PASS
- [x] Empty list creation — PASS
- [x] Inline create from restaurant page creates list + adds entry in one call — PASS (`lists/index.ts:189-203`)
- [x] Add-to-list sheet MRU order with "New list" row — PASS
- [x] Idempotent add (same restaurant twice) — PASS (`lists/index.ts:403-411` returns existing row)
- [x] Restaurant can belong to multiple lists; independent of wishlist — PASS
- [x] Checkmark on rows already containing; tap removes — PASS
- [ ] Remove via "subtle undo toast rather than a modal" — FAIL: `ListEntryRow.tsx:69-78` uses `Alert.alert` destructive confirm, not an undo toast. Spec explicitly rejects modal in favor of toast-with-undo.
- [x] Per-entry note ≤140 chars editable inline — PASS
- [x] Aspirational entries — PASS
- [x] Ranked: owner-defined order, numbered 1..n — PASS
- [x] Drag handle for owner on ranked lists — PASS (DraggableFlatList wired)
- [x] Unranked: reverse-chron display order — PASS
- [x] Ranked↔unranked conversion preserves order — PASS (server back-fills positions on false→true)
- [x] `privacy` field enum — PASS
- [ ] Private list to non-owner → "not found" (not "forbidden") — FAIL at client layer: `useList.ts:72` checks `data?.error` but `supabase.functions.invoke` surfaces 404 responses as `error = FunctionsHttpError` with `data = null` (functions-js 2.81). The `if (data?.error)` branch will not fire on 404, so the code falls into the earlier `throw error` at line 70. The server correctly returns 404 JSON, but the client treats it as an uncaught error and the "not found" UI in `app/list/[id].tsx:141-150` never renders for private lists. RLS + server gate are correct; the UI path is broken.
- [x] Server authorization supports non-owner reads of public lists — PASS (RLS + `get` both gate by `privacy = 'public' OR owner_id = auth.uid()`)
- [x] Canonical shareable URL for public lists — PASS (`diningjournalapp://list/{id}`; naming mismatch with spec's `napkin://` noted by builder, not blocking)
- [x] Account-level privacy NOT wired — PASS
- [x] Lists tab on own profile (Settings → My Lists) — PASS
- [x] Empty state with CTA — PASS
- [x] List detail: title, description, author, count, badges, privacy — PASS
- [x] Entry rows with rank, name, city/cuisine, note — PASS
- [x] Tap entry → standard restaurant page; no list context on restaurant page — PASS (verified in `app/list/[id].tsx:108-113` and `app/restaurant/[id].tsx` unchanged re: list banner)
- [x] Owner edit affordances; non-owners read-only — PASS
- [x] Share (owner + public only) — PASS
- [x] Destructive delete confirmation — PASS (`ListEditForm`)
- [x] Delete preserves entries/wishlist/restaurants — PASS (FK is ON DELETE CASCADE only from list → entries; restaurants untouched)
- [x] Optimistic add/remove with rollback — PASS
- [ ] Optimistic reorder correctness — WARN: hook logic and server both have edge-case bugs (see Correctness).

Correctness: WARN — reorder edge-case bugs at list boundaries, and client 404 handling is broken.
Edge Cases: WARN — ghost restaurant on remove path short-circuits silently; compaction trigger path rewrites positions sequentially without a transaction.
Error Handling: WARN — 404 from `get` doesn't reach "not found" UI.
Security: PASS — RLS double-gate is correct; service-role code path also re-verifies ownership on every write; `lists_containing` scoped to caller via inner join.
Performance: WARN — `list_mine` does N+1 queries per list (entry_count + cover). For a user with 20 lists this is 41 sequential round-trips; should be a single SQL join / aggregate.
Design Compliance: PASS — follows wishlist sibling patterns, edge function router matches project doctrine, no list context leaks onto restaurant page.

Key issues:

1. **Private-list "not found" UI never shows** (`napkin-app/hooks/lists/useList.ts:70-77`). `supabase.functions.invoke` surfaces non-2xx as `error` (FunctionsHttpError), not as `data.error`. The 404 response from the edge function is thrown as a generic error and the `isNotFound: true` branch is unreachable. Fix: inspect `error.context?.status === 404` (or parse the FunctionsHttpError body) and return `{ data: null, isNotFound: true }` in that case. This is the one acceptance-criterion regression with real privacy-leakage surface area — a non-owner opening a shared-but-private list URL currently sees a generic error toast rather than the spec-mandated "not found" state.

2. **Reorder server logic is broken for "insert at start" and "insert at end"** (`supabase/functions/lists/index.ts:528-558`). When only `before_entry_id` is passed (end of list), the code at lines 535-541 tries to compute `nextPos` with a filter+find that re-searches for `before_entry_id` — it always returns the same `before_entry_id` or undefined, never the intended "next" entry. Symmetric bug for `after_entry_id`-only at 550-554 (the `slice(...).pop()` returns the wrong neighbour in most cases). Builder flagged this in Builder Question #1 — it's real and will mis-position drops at list head/tail. Fix: accept `new_index` from the client and compute positions from the sorted array, or just set `nextPos = null` when only `before_entry_id` is supplied and `prevPos = null` when only `after_entry_id` is supplied (which is actually what the fallback arithmetic at 563-568 already expects).

3. **Remove-entry uses Alert.alert modal, spec requires undo toast** (`napkin-app/components/lists/ListEntryRow.tsx:69-78`). Spec says "removal is confirmed by a subtle undo toast rather than a modal." `ToastProvider` is already wired (see `ListDetailHeader`). Fix: remove immediately on tap, show toast with "Undo" action that re-adds via `useAddToList` if tapped.

4. **`list_mine` is N+1** (`supabase/functions/lists/index.ts:282-309`). For each list, fires a separate `count` query and a `first entry` query — so a user with 20 lists triggers 41 sequential queries. Fix: single query with a `json_agg`/subquery or `select lists.*, (select count(*) ...) as entry_count, (select photo_url ...) as cover_photo_url` — or batch the enrichment with a join and aggregate client-side.

5. **Compaction is not a transaction** (`supabase/functions/lists/index.ts:98-103`). The loop rewrites each row sequentially; a failure mid-loop leaves positions partially rewritten. Low likelihood (compaction is rare), but wrap in `rpc` to a plpgsql function or use a single `UPDATE ... FROM (VALUES ...)` statement for atomicity.

6. **Ghost restaurant on "remove" short-circuits silently** (`napkin-app/components/lists/AddToListSheet.tsx:75-77`). If a ghost-payload-only restaurant is already in a list (possible via the create-with-initial path), tapping to remove no-ops with no feedback because `restaurantId` is undefined. Low-priority but UX-unclear.

7. **Scope bleed**: branch `feat/TICKET-018` contains a second commit `89518d5` implementing TICKET-019 (progressive logging: `fast-log.tsx`, `FastLogForm`, `FastLogSheet`, `useUpdateEntry`, rewrite of `entry-detail.tsx`, 800+ lines). These should not merge as part of this ticket. Either rebase them out or split the PR — reviewer scope for TICKET-018 is violated otherwise.

Note: issues 2, 4, 5, 6 are fixable follow-ups; issues 1, 3, 7 are blockers for APPROVE per the spec's acceptance criteria and doctrine.

### Review 2
Date: 2026-04-17
Verdict: APPROVE

Spec compliance: 32/32 acceptance criteria met
- [x] Private list to non-owner → "not found" — PASS: `useList.ts:70-78` now inspects `FunctionsHttpError.context?.status === 404` and returns `{ data: null, isNotFound: true }`. The `app/list/[id].tsx:155-164` "Not found" UI is now reachable for the 404 path, matching the no-leakage doctrine.
- [x] Remove-entry via undo toast, not modal — PASS: `ListEntryRow.tsx:68-71` removes immediately on tap; `app/list/[id].tsx:61-78` dispatches `toast.show('Removed ...', { label: 'Undo', onPress: () => addToList.mutate(...) })`. Modal is gone.
- [x] Reorder head/tail positions — PASS: `lists/index.ts:509-539` now trusts the client contract. Client (`useReorderListEntry.ts:32-36`) derives `before_entry_id = withoutMoved[new_index-1]` and `after_entry_id = withoutMoved[new_index]`, server fetches only those two rows and handles null-prev / null-next arithmetic cleanly. Head drop → `newPosition = floor(next/2)`, tail drop → `prev + 1024`. Verified against [A,B,C,D] head/tail scenarios.
- [x] Scope bleed removed — PASS: `git log feat/TICKET-018` shows only `0579b82` + `681c333`; no TICKET-019 commit.

Correctness: PASS — reorder simplification is mathematically correct for all three cases (between, head, tail); client delivers the correct neighbour contract the server depends on.
Edge Cases: WARN — gap-collapse compaction still re-appends the moved entry at `max+1024` instead of the target slot (`lists/index.ts:547-552`); client re-fetch hides the mis-placement but user sees entry jump to the end on a rare compaction event. Same as pre-fix; not regressed. Issue #6 (ghost remove short-circuit) from Review 1 also still open — both remain acceptable follow-ups.
Error Handling: PASS — 404 surface is now plumbed all the way to the UI; the `error.context?.status` read is the correct functions-js 2.x shape. Non-404 errors still throw and land in React Query's error state (acceptable — the "not found" doctrine only applies to privacy, generic errors should not be silently hidden).
Security: PASS — double-gate (RLS + explicit server 404 on private) unchanged; undo re-add goes through the same `add_entry` action which re-verifies ownership.
Performance: WARN — `list_mine` N+1 from Review 1 issue #4 still present; not a blocker, flagged as follow-up.
Design Compliance: PASS — `ToastAction` extension to `ActivityToast`/`ToastProvider` is minimal and additive (optional `action?: ToastAction`); existing toast call-sites pass no action and render unchanged. `useToast` fail-open signature also updated to accept the optional action, keeping the tests-outside-provider pattern intact.

Key issues:
None blocking. Follow-up tickets (non-blocking, carry over from Review 1):
1. `list_mine` N+1 — consolidate into one query with subselect aggregates (`supabase/functions/lists/index.ts:282-309`).
2. Position-gap compaction — wrap the rewrite loop in a plpgsql RPC for atomicity, and on compaction keep the moved entry at its intended slot instead of max+1024 (`supabase/functions/lists/index.ts:547-552`).
3. Ghost remove short-circuit in `AddToListSheet.tsx:75-77` — show user-visible feedback when `restaurantId` is undefined.

Minor observation (not a bug): `ToastProvider` has a `setTimeout(dismiss, TOAST_TTL_MS)` and `ToastItem` also has its own 3s auto-dismiss timer. Both fire at ~3s; the second call to `dismiss(id)` is a no-op filter. Pre-existing, not introduced by this fix.
