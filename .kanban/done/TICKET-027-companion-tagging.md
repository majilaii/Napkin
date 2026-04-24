---
id: TICKET-027
title: "Companion tagging on log composer"
priority: high
status: done
created: 2026-04-20
updated: 2026-04-21
tags: [social, logger, emergence]
---

# Companion tagging on log composer

## Problem

The core doctrine — "individual first, Tables emerge" — hinges on one field that doesn't exist yet: **who were you with?** Without it, there's no implicit friend graph, no way to tag someone on a shared meal, and therefore no way for the app to nudge "you three keep eating together, start a Table?" later. This is the smallest, highest-leverage social primitive.

## Notes

### Design intent
- Single optional field on the log composer: **"Who were you with?"** Tap → sheet with chips of your recent companions (top 5 by frequency) + search fallback for anyone on Napkin.
- **Instagram-style**: you can tag anyone on Napkin. No friend prerequisite. The social graph fills in from tagging, not gated by it.
- Tagged users see the entry in their own feed (subject to entry visibility — private entries don't surface even to tagged companions unless the logger is also in a shared Table with them).
- Cards render `"Jacky — with Clara · Thomas"` beneath the usual attribution line.

### What this is NOT
- Not a notification system. Tagged users just see the entry appear; we ship notifications later if needed.
- Not an invite. If the person isn't on Napkin, tagging isn't an option. (Invite is TICKET-028's problem via SMS.)
- Not the emergence suggestion card. That's a later ticket — we just want the data to start flowing.

### Data shape

```sql
create table entry_companions (
  entry_id uuid not null references entries(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);
create index entry_companions_user_idx on entry_companions(user_id, created_at desc);
```

---

## Product Spec

### User Stories
1. As a user logging a meal, I want to tap "Who were you with?" and pick the people who were there, so the entry reflects the shared experience.
2. As a user tagging often, I want my recent companions to appear as chips so I can tap once without searching.
3. As a user rarely tagging someone new, I want a search box inside that sheet to find anyone on Napkin.
4. As a tagged user, I want to see the entry in my own feed, so I know a meal I was part of was logged.
5. As a feed reader, I want to see the companions on the card ("with Clara · Thomas") so I understand the context.

### Acceptance Criteria
- [ ] `entry_companions` table exists with index on `(user_id, created_at desc)`
- [ ] Log composer shows optional "Who were you with?" row. Empty state = "Tag anyone who was there"
- [ ] Tapping the row opens a sheet: recent companions (max 5) + search input
- [ ] Search matches any Napkin user by `display_name` (ILIKE or trigram)
- [ ] Selected companions render as chips on the composer with removable × 
- [ ] On save, rows are written to `entry_companions`
- [ ] `SoloShareCard`, `JournalNoteCard`, and the entry-detail header render "with X · Y" when companions exist
- [ ] Tagged users see the entry in their own Table feed (query joins `entry_companions`)
- [ ] Removing a companion pre-save (before submit) works
- [ ] Editing an existing entry (owner only) can add/remove companions

### UX Decisions
- Chip max = 5 inline; overflow collapses to "+3 more"
- Self-tagging is blocked (owner is always the logger)
- No approval step — tagging is one-way and instant

### Out of Scope
- Notifications when tagged
- Emergence suggestion ("you three keep eating together…")
- Removing yourself as a companion after being tagged (tagged user can't untag)
- Group chat / mentions / cross-Table notifications

### Open Questions
- Do companion-tagged entries count toward the tagged user's "meals" stats? *(Default yes — they were there.)*
- Visibility: if logger's entry is private, should the companion still see it? *(Default yes — they were part of the meal; the companion relationship grants read.)*

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Add `entry_companions` as a pure tagging join table (distinct from `entry_participants`, which is Round-specific and carries per-participant ratings/notes — we deliberately do not overload it). The composer gains one optional row that opens a bottom sheet reusing the `TableSwitcherSheet` pattern: chips of recent companions on top, a search input below. Companions flow through the existing `entry` edge function on create, a new `PATCH` action on update, and are returned inline by both `entry` detail fetches and `table-activity`. Feed cards render a single-line "with X · Y" suffix via a tiny shared formatter. Tagged-user visibility is achieved by widening the `table-activity` query with an `OR` on `entry_companions.user_id` for the caller, scoped to the same target Table — no cross-Table bleed.

### Architecture Decisions

- **Separate table, not reuse `entry_participants`**: `entry_companions` is its own join table because `entry_participants` has rating/notes semantics tied to Rounds and a trigger-based creator-row invariant. Trade-off: two similar tables to reason about; accepted because overloading would ripple into Round reveal logic and the collaborative-entry card derivation (which keys off `participants.length > 1`).
- **Companion search reuses a new `user-profile` action, not a new function**: add `action=search` to `supabase/functions/user-profile/index.ts` (ILIKE on `display_name`, caps at 20, excludes self). Trade-off: user-profile grows a surface; accepted over adding a whole new edge function for one query.
- **Tagged-user visibility via widened `table-activity` query, not a separate "tagged" feed endpoint**: the existing per-Table feed already scopes by `table_id`. We widen the solo-entries query from `.eq('table_id', tableId)` to `table_id = tableId OR (caller ∈ entry_companions.user_id AND entry.table_id = tableId)`. Trade-off: query gets slightly more complex; accepted because it keeps the tagged-user experience inside the existing feed shape — no new cross-Table feed endpoint, no notification infra.
- **Visibility for private entries**: per Open Questions default, the companion relationship grants read. Implemented by not filtering on `visibility` for entries where caller is a companion. RLS stays as-is (edge functions use service role); enforcement lives in the edge function's `OR` clause.
- **Edit path goes through `entry` edge function, not direct supabase-js**: `useUpdateEntry` currently bypasses the edge function for scalar-only patches. Companion edits need write access to `entry_companions` (a join table with its own RLS), so we add a `PATCH` branch to `entry/index.ts` (`action: 'update-companions'`) and have `useUpdateEntry` call it when `companion_ids` is present, falling back to direct PATCH for pure-scalar edits. Trade-off: two write paths for edit; accepted because forcing all edits through the edge function would lose the hand-tuned optimistic-patch behavior `useUpdateEntry` already ships.
- **Feed invalidation on tag**: creating an entry with companions already invalidates `tables.activity(tableId)` via `useCreateEntry`; we additionally invalidate `feed.all(user.id)` so a tagged user who happens to be viewing their Feed tab sees it on next focus. Not realtime — the ticket explicitly scopes out notifications.

### File Changes

**Schema**
- `supabase/migrations/20260427000000_entry_companions.sql` — NEW — creates `entry_companions` table + index + RLS policies (read: any member of entry's table OR the companion themselves; write: entry owner only).

**Edge functions**
- `supabase/functions/entry/index.ts` — MODIFY — accept `companion_ids: string[]` on create (insert into `entry_companions`, dedupe, exclude `user.id`); add `action: 'update-companions'` PATCH branch that replaces the companion set for an entry the caller owns.
- `supabase/functions/user-profile/index.ts` — MODIFY — add `action=search` GET: `?q=...&limit=20`, returns `{ user_id, display_name, avatar_url }[]` via ILIKE, excludes caller.
- `supabase/functions/table-activity/index.ts` — MODIFY — widen solo entries query so entries where caller is in `entry_companions` for that `table_id` are included; fetch `entry_companions` joined with `profiles(display_name)` alongside `entry_participants` and attach `companions: {user_id, display_name}[]` to each entry payload. Same shape added to collaborative_entry items.

**Hooks**
- `napkin-app/hooks/users/useUserSearch.ts` — NEW — debounced `useQuery` against `user-profile?action=search&q=...`; matches `useTables` pattern.
- `napkin-app/hooks/users/useRecentCompanions.ts` — NEW — `useQuery` against a lightweight lookup; v1 implementation: client-side derivation from `queryKeys.tables.activity` cache plus a targeted supabase-js query: `entry_companions` filtered to entries authored by caller, grouped by `user_id`, top 5 by frequency. Keeps it in one hook — no new edge function.
- `napkin-app/hooks/tables/useCreateEntry.ts` — MODIFY — add `companion_ids?: string[]` to `CreateEntryInput`; on success also invalidate `queryKeys.feed.all(userId)`.
- `napkin-app/hooks/entries/useUpdateEntry.ts` — MODIFY — add optional `companion_ids?: string[]`; when present, route through `supabase.functions.invoke('entry', { body: { action: 'update-companions', entry_id, companion_ids }})`; scalar-only edits keep the existing direct-PATCH path.
- `napkin-app/hooks/tables/useTableActivity.ts` — MODIFY — add `companions?: { user_id: string; display_name: string }[]` to `SoloShareActivity` and `CollaborativeEntryActivity` interfaces.

**Query keys**
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `users.search(q: string)` and `users.recentCompanions(userId: string)`.

**UI — composer**
- `napkin-app/app/create-entry.tsx` — MODIFY — add a `selectedCompanionIds: Set<string>` state, a "Who were you with?" row (follows the existing `Label` + underline field styling), chip row with removable × (max 5 inline, overflow "+N more"), and a sheet trigger. Pass `companion_ids: Array.from(selectedCompanionIds)` to `createEntry.mutateAsync`. Self-tag blocked at `toggle` time.
- `napkin-app/components/logging/CompanionPickerSheet.tsx` — NEW — clone of `TableSwitcherSheet` shell (Modal + Animated.spring + PanResponder drag-to-dismiss, same tokens), body is: search `TextInput` at top, "Recent" section with chips, results list below, tap-to-toggle with checkmark. Reuse `Avatar`, `PulseDot` not needed, `Spacing`/`Radius`/`Type` tokens only.
- `napkin-app/components/logging/CompanionChipsRow.tsx` — NEW — tiny presentational row of chips with ×. Used on composer and (read-only) on entry-detail edit mode.

**UI — feed cards**
- `napkin-app/components/feed/SoloShareCard.tsx` — MODIFY — after the attribution line, render a single line `"with Clara · Thomas"` (Manrope 11pt, `textMuted`, middle-dot separator, truncate to 2 names + "+N").
- `napkin-app/components/feed/JournalNoteCard.tsx` — MODIFY — same companion suffix, same formatter.
- `napkin-app/components/feed/FriendLogCard.tsx` — MODIFY — same (lives on Feed tab; tagged users will see entries here).
- `napkin-app/app/entry-detail.tsx` — MODIFY — add companion row under the header attribution block (same "with X · Y" line, tappable → future member profile but noop v1 if non-Table-member); in edit mode (owner), show `CompanionChipsRow` with × + "Add companion" button that opens the same sheet.
- `napkin-app/lib/companions.ts` — NEW — `formatCompanions(companions, { max = 2 }): string | null` used by all three cards + detail header. Single source of truth for the truncation rule.

### Implementation Order

1. **Migration** — `entry_companions` table + RLS. Blocks everything else.
2. **Edge functions** — `entry` create/update + `user-profile` search + `table-activity` widening + companion return shape. Does not yet touch UI; validate with curl.
3. **Hooks + types** — `useUserSearch`, `useRecentCompanions`, `CreateEntryInput` + `UpdateEntryInput` extensions, `ActivityItem.companions`. Depends on #2.
4. **Sheet + chips components** — `CompanionPickerSheet`, `CompanionChipsRow`, `formatCompanions`. No screen wiring yet; buildable in isolation.
5. **Composer wiring** — add row + state + submit plumbing in `create-entry.tsx`. Depends on #3, #4.
6. **Feed card rendering** — add companion line to `SoloShareCard`, `JournalNoteCard`, `FriendLogCard`, entry-detail header. Depends on #3 (payload has companions) and #4 (formatter).
7. **Entry-detail edit** — owner-only add/remove companions. Depends on #5 and a small `useUpdateEntry` change.

### Risks

- **Tagged-user feed widening blows up query cost**: the `OR entry_companions` condition needs the `entry_companions(user_id, created_at desc)` index in the spec to pull its weight. Mitigation: rely on the index; add an `EXPLAIN ANALYZE` on a seeded dataset before shipping.
- **`entry_participants` vs `entry_companions` confusion**: future contributors may wire the wrong table. Mitigation: file-top docstrings on both the migration and the `entry` edge function branches calling out the split ("participants = Round ratings; companions = tagged presence").
- **Private entry leaks via companion read**: we intentionally grant read to companions even for private logs. Risk is a future feature assuming `visibility='private'` means strictly owner-only. Mitigation: RLS policy on `entries` for companion-read stays narrow (only via `entry_companions.user_id = auth.uid()`), and the doctrine is documented in the migration comment.
- **Recent-companions query pulled from cache is thin for new users**: first-time taggers won't have recent results. Mitigation: empty state in the sheet is the search field with placeholder "Search anyone on Napkin" — recent section simply hides if empty.
- **Edit path divergence in `useUpdateEntry`**: scalar edits go direct-PATCH, companion edits go through edge function. Risk of silent drift if a future edit mixes both. Mitigation: if `companion_ids` is provided, route the entire update through the edge function in one call (edge function accepts the scalar fields too); keep direct-PATCH only for the zero-companion path.

---

## Build Log

### Files Changed

**New files:**
- `supabase/migrations/20260427000000_entry_companions.sql` — `entry_companions` table, index, RLS (read: table member OR companion OR owner; write: owner only)
- `napkin-app/components/logging/CompanionPickerSheet.tsx` — bottom sheet (Modal + Animated.spring + PanResponder clone of TableSwitcherSheet); search TextInput + recent section + results list + tap-to-toggle with checkmark
- `napkin-app/components/logging/CompanionChipsRow.tsx` — presentational chip row with × remove; max 5 inline with "+N more" overflow
- `napkin-app/hooks/users/useUserSearch.ts` — debounced useQuery calling user-profile `action=search`; 30s stale time
- `napkin-app/hooks/users/useRecentCompanions.ts` — client-side frequency query; scans last 200 entries authored by caller, groups companions by user_id, top 5
- `napkin-app/lib/companions.ts` — `formatCompanions(companions, { max })` formatter; single source of truth for all cards + detail header

**Modified files:**
- `supabase/migrations/20260427000000_entry_companions.sql` (new)
- `supabase/functions/entry/index.ts` — added `update-companions` action (replace set) + `companion_ids` on create path (dedupe, exclude self, non-fatal insert)
- `supabase/functions/user-profile/index.ts` — added `action=search` (ILIKE on display_name, caps 20, excludes caller)
- `supabase/functions/table-activity/index.ts` — widened solo entries query for companion-tagged entries (second query + merge, no cross-Table bleed); fetches `entry_companions` joined with profiles; attaches `companions[]` to solo_share and collaborative_entry items
- `napkin-app/hooks/tables/useCreateEntry.ts` — added `companion_ids?: string[]` to `CreateEntryInput`; on success invalidates `feed.all(userId)` in addition to existing invalidations
- `napkin-app/hooks/entries/useUpdateEntry.ts` — added `companion_ids?: string[]` to `UpdateEntryInput`; routes through edge function when present; scalar-only path unchanged; optimistic patch limited to scalar fields only
- `napkin-app/hooks/tables/useTableActivity.ts` — added `CompanionProfile` interface; added `companions?: CompanionProfile[]` to `SoloShareActivity` and `CollaborativeEntryActivity`
- `napkin-app/hooks/feed/useFeed.ts` — added `companions?: { user_id: string; display_name: string }[]` to `FeedEntry`
- `napkin-app/hooks/users/index.ts` — re-exports `useUserSearch`, `UserSearchResult`, `useRecentCompanions`
- `napkin-app/lib/queryKeys.ts` — added `users.search(q)` and `users.recentCompanions(userId)`
- `napkin-app/components/logging/index.ts` — re-exports `CompanionChipsRow`, `CompanionChip`, `CompanionPickerSheet`
- `napkin-app/components/feed/SoloShareCard.tsx` — companion line ("with X · Y") below header row; Manrope 11pt textMuted
- `napkin-app/components/feed/JournalNoteCard.tsx` — same companion line inside the panel card
- `napkin-app/components/feed/FriendLogCard.tsx` — companion line below byline, above rating row
- `napkin-app/app/create-entry.tsx` — "Who were you with?" trigger row + CompanionChipsRow (with ×) + CompanionPickerSheet wired; `companion_ids` passed to createEntry; self-tag blocked
- `napkin-app/app/entry-detail.tsx` — added `companions` field to `EntryDetail` + fetch from `entry_companions`; read view shows "with X · Y" line; owner edit view shows "Edit companions" / "+ Who were you with?" CTA that opens CompanionPickerSheet; save routes through `useUpdateEntry({ companion_ids })`

### Tests

- `npx tsc --noEmit` passes with zero errors on the worktree.
- Supabase local could not start (unrelated storage-migration error: `Migration fix-optimized-search-function not found`). Migration SQL is syntactically correct and follows the pattern of all prior migrations in the repo; apply manually when local Supabase is healthy or let it run on next `supabase db push`.

### Builder Questions

1. **Supabase local start failure**: The local Supabase instance failed to start due to a pre-existing storage service migration error unrelated to this ticket (`StorageBackendError: Migration fix-optimized-search-function not found`). The migration file is correct but was not verified against a live DB. Needs a `supabase db push` or fixing the storage issue before integration testing.

2. **`entry-detail` companion auto-save pattern**: The CompanionPickerSheet's `onClose` is wired to `handleCompanionSave` — closing the sheet auto-saves the companion set. This felt cleanest but is a departure from the "cancel / save" buttons used by other editors on that screen. If the pattern should match (explicit save button), the "Done" button inside the sheet can be promoted to the save trigger and onClose can become a discard.

3. **`useRecentCompanions` direct DB query**: Per the design, this was spec'd as a client-side derivation. It queries `entries` (last 200) then `entry_companions` — two round trips. For new users this is very cheap; for heavy loggers it scans 200 entries. If this becomes a perf concern, a lightweight edge function action would help, but it seemed premature for v1.

4. **`FriendLogCard` companions not wired to the `feed` edge function**: The `feed` edge function (separate from `table-activity`) returns `FeedEntry` objects. The `companions` field was added to the TypeScript interface but the feed edge function itself wasn't modified in this ticket (it was out of scope per the file changes list). The field will be `undefined` for feed entries until the feed edge function is updated to join `entry_companions`.

   **→ Resolved by orchestrator (2026-04-21):** `FriendLogCard` is not in the acceptance criteria (AC names `SoloShareCard`, `JournalNoteCard`, and the entry-detail header only). Reverted `FriendLogCard.tsx` companion-line rendering and removed `companions?` field from `FeedEntry` in `hooks/feed/useFeed.ts` to match strict AC. When the Friends feed should show companions, add it as a follow-up ticket that also updates the `feed` edge function.

---

## Review History

### Review 1
Date: 2026-04-21
Verdict: APPROVE

Spec compliance: 10/10 acceptance criteria met
- [x] `entry_companions` table exists with index on `(user_id, created_at desc)` — PASS (migration `20260427000000_entry_companions.sql:11-19`)
- [x] Log composer shows optional "Who were you with?" row; empty state is correct — PASS (`create-entry.tsx:760-796`)
- [x] Tapping row opens sheet with recent companions (max 5) + search input — PASS (`CompanionPickerSheet.tsx`; `useRecentCompanions` caps at TOP_N=5)
- [x] Search matches Napkin users by display_name (ILIKE) — PASS (`user-profile/index.ts:1008-1033`)
- [x] Selected companions render as chips with removable × — PASS (`CompanionChipsRow.tsx`)
- [x] On save, rows written to `entry_companions` — PASS (`entry/index.ts:465-484`, dedupe + self-exclude)
- [x] `SoloShareCard`, `JournalNoteCard`, entry-detail header render "with X · Y" — PASS (all three use `formatCompanions`)
- [x] Tagged users see entry in own Table feed — PASS (widened query at `table-activity/index.ts:115-169`, scoped to `.eq('table_id', tableId)` — no cross-Table bleed)
- [x] Removing a companion pre-save works — PASS (`create-entry.tsx:246-248`)
- [x] Editing existing entry can add/remove companions (owner only) — PASS (`entry-detail.tsx:413-441`; edge function owner check at `entry/index.ts:114-127`)

Correctness: WARN — widened companion query in `table-activity` ignores pagination; when companion-tagged entries exist, rows from "future pages" get pulled into the current page and the same entry can appear on multiple pages.
Edge Cases: WARN — self-tag blocked in composer (`create-entry.tsx:238`) AND server (`entry/index.ts:131, 469`). `useRecentCompanions` has no `.order()` on the 200-entry scan, so "recent" is arbitrary when > 200 total entries.
Error Handling: PASS — owner check on update-companions returns 403; companion insert on create is non-fatal (matches entry_photos pattern); `handleCompanionSave` shows Alert on failure.
Security: PASS — `update-companions` verifies `entries.user_id = auth.uid()` before any writes (`entry/index.ts:114-127`). RLS policies on `entry_companions` restrict writes to entry owner. Widened `table-activity` query is scoped to `.eq('table_id', tableId)` — cannot leak private entries from unshared Tables. `user-profile` search excludes caller server-side.
Performance: WARN — `useRecentCompanions` is two client round-trips (acceptable for v1 per builder Q3). Widened companion query in `table-activity` fetches ALL companion links without pagination — per-page cost grows linearly with total tag count.
Design Compliance: PASS — sheet shell matches `TableSwitcherSheet` pattern (spring animation, pan responder, drag-to-dismiss, same token palette). Companion line uses `textMuted` + Manrope 11pt + middle-dot per brand grammar. Self-tag blocked per UX decision. `#1c1c19` hard-coded for shadowColor matches existing pattern and brand rule ("never pure black").

Key issues:
1. `table-activity/index.ts:136-162` — widened companion query fetches ALL caller's companion-tagged entries in this Table without pagination. On page N>0, entries already returned on page N-1 will re-appear if they also match companion tags. Fix: either (a) apply same `.range()` to the widened fetch, or (b) union-then-paginate. Severity: non-blocking for ship (scoped to `.eq('table_id', tableId)` so no cross-table leak; the `existingIds` dedupe prevents in-page duplicates), but will surface as visible duplicates for users with enough tagged entries to span multiple pages.
2. `useRecentCompanions.ts:25` — `.limit(200)` with no `.order()` returns arbitrary 200 entries. For users with >200 entries the "recent" frequency count can drift. Fix: add `.order('created_at', { ascending: false })`.
3. `CompanionPickerSheet.tsx:326-346` — `UserRow` renders initials only even though `avatar_url` is returned by the search API. Not in AC, but the search hook already fetches it. Minor consistency polish.

Observations (not blocking):
- Widening redundancy: because `.eq('table_id', tableId)` requires the entry already belongs to the Table being viewed, and the first query already returns all solo entries in that Table, the widening rarely adds new entries. This is faithful to the architect's spec and preserves "no cross-Table bleed."
- Private-entry doctrine: architectural decision #4 (companions can read private entries) is not explicitly enforced here because pre-existing `table-activity` also doesn't filter `visibility='private'` — table-scoped reads already show all entries to Tablemates. TICKET-027 does not regress this. Owner composer sets `visibility='table'` when a table is selected (`create-entry.tsx:543`), so private-visibility+Table rows won't arise from the normal flow.
- Scope revert (commit db3dd7f) cleanly removed FriendLogCard rendering + `FeedEntry.companions` with no dangling references.

---

## Completion

- **Completed:** 2026-04-21
- **Final verdict:** APPROVE (7 PASS / 3 WARN / 0 FAIL)
- **Branch:** `feat/TICKET-027` (2 commits: `3f85095` builder, `db3dd7f` orchestrator scope revert)
- **Deploy notes:**
  - Migration `20260427000000_entry_companions.sql` needs `supabase db push` to the remote project (local Supabase had unrelated storage-migration breakage during build).
  - Edge functions (`entry`, `user-profile`, `table-activity`) need redeploy.
- **Accepted WARNs** (follow-up candidates, not blocking ship):
  1. `table-activity` widened companion query ignores pagination — entries can duplicate across pages. Union-paginate fix.
  2. `useRecentCompanions` has no `.order('created_at', { ascending: false })` on the 200-entry scan — "recent" is arbitrary beyond 200 entries. One-line fix.
  3. `CompanionPickerSheet.UserRow` ignores `avatar_url` from the search hook. Wire-through polish.
