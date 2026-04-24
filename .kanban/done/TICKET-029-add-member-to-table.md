---
id: TICKET-029
title: "Add member to a Table from settings"
priority: medium
status: done
created: 2026-04-20
updated: 2026-04-21
tags: [tables, social, settings]
---

# Add member to a Table from settings

## Problem

Tables emerge from companion-tagging over time (doctrine) — but sometimes you just *know* you want Clara in Sunday Roast Club now. Today there's no in-app path to add a member to a Table without waiting for the emergence suggestion. This ticket adds the explicit path, without resurrecting a pending-invite inbox.

Depends on TICKET-028 (follow graph).

## Notes

### Design intent
- Table settings screen gains an **"Add member"** row at the top of the members list.
- Tapping it opens a search sheet **scoped to mutual follows** (reuses TICKET-028's people search with `&mutual_only=true` — both users follow each other).
- Selecting a person **immediately adds them** as a member. No inbox, no approval, no pending.
- The added user sees the Table appear in their Tables list on next refresh. A single passive banner in-app ("Clara added you to Sunday Roast Club") on first view is enough — no push notifications in this ticket.
- **Anti-spam gate: mutual follow required.** Both parties must follow each other before a Table add is possible. This mirrors Instagram group-DM defaults: both sides have signaled consent, no approval inbox needed.

### Why mutual follow (not one-way)
Tables are sacred (doctrine). One-way follow means Alice could add Dave even if Dave has never engaged with Alice — feels invasive. Requiring Dave to follow Alice back means Dave has deliberately opted into Alice's orbit. Two affirmative signals, no inbox, no friction beyond a 30-second follow-back when onboarding a new friend.

### What happens when the target doesn't follow you back
Search sheet shows the person with a muted "Needs to follow you back" row (tappable → opens their profile so you can remind/nudge them). No silent blocker — the UX surfaces the exact next step.

### Opt-out, not opt-in
If Clara doesn't want to be in Sunday Roast Club, she leaves the Table from her own Tables list (existing flow). Leaving is already wired. Adding is one-way with a known escape hatch — this is the same asymmetry Slack channels use.

---

## Product Spec

### User Stories
1. As a Table owner, I want an explicit "Add member" entry point in Table settings so I don't have to wait for the emergence nudge when I already know the person should be there.
2. As a Table member, I want to add people I already follow, so I'm gated against accidentally pulling in strangers.
3. As a user who was added, I want to see the Table in my list immediately, with a quiet banner explaining it so I know how I got there.
4. As a user who doesn't want to be in that Table, I want a visible "Leave Table" action so I can opt out without friction.

### Acceptance Criteria
- [ ] Table settings screen has a primary "Add member" row above the existing member list
- [ ] Tapping opens a search sheet with `mutual_only=true` filter on people-search
- [ ] Results show mutual follows first. Non-mutual follows appear with a muted "Needs to follow you back" label and are not selectable — tapping opens their profile
- [ ] Selecting a mutual-follow inserts into `table_members` and closes the sheet
- [ ] Server enforces mutual-follow: returns 403 if either direction of the follow is missing, with error code `NOT_MUTUAL_FOLLOW`
- [ ] Added user sees the Table in `useTables()` results within 30s (or immediately on manual refresh)
- [ ] Added user sees a single passive banner on the Table feed: "Clara added you to Sunday Roast Club" — dismissible, shown only once
- [ ] Adding someone already in the Table is a no-op (idempotent insert)
- [ ] Existing "Leave Table" action is visible on the Table settings screen for the current user, if they're a member but not the owner

### UX Decisions
- Only the Table owner can add members in v1 (simplest rule). Any-member-can-add is a later relaxation.
- No "invite via SMS" path here — Tables are for already-on-Napkin people. For not-yet-Napkin people, use the search-tab invite (TICKET-028).
- The banner on first-view uses the same warm-cream `LogVisit`-style treatment, one-line.

### Out of Scope
- Push notifications when added
- Removing a member (owner action)
- Role-based permissions (admin / member)
- Mass-add / invite link for a specific Table
- Adding yourself to someone else's Table (impossible)

### Open Questions
- Cap on Table size? *(Doctrine says Tables are tiny — 3–8 people. Enforce `member_count <= 8`? Soft-warn at 8, hard-cap at 12?)*
- When a member is added, do their existing public-profile entries get pulled retroactively into the Table feed, or is the feed forward-only from the add date? *(Default: forward-only. Retroactive backfill is confusing and surfaces old takes out of context.)*

---

## Technical Design

### Approach

Add a new `add_member` action to the existing `table-management` edge function that does three things atomically: (1) verify caller is the Table owner, (2) verify mutual-follow via two `follows` lookups, (3) idempotent upsert into `table_members`. Extend `user-profile.action=search` with a `mutual_only: true` flag that intersects `follows(me→x)` ∩ `follows(x→me)`; when passed, non-mutual rows are still returned but flagged `is_mutual: false` so the picker can render them as muted/non-selectable per the UX spec. Build a new `/table/[id]/settings` route that lists members, exposes the owner-only "Add member" row, surfaces "Leave Table" for non-owner members, and hosts the `AddMemberSheet` reusing `PeopleResultRow` visuals. Add a `welcomed_at TIMESTAMPTZ` column to `table_members` and a simple `"X added you to Y"` banner at the top of the Tables tab feed that dismisses by hitting a new `mark_welcomed` action (same shape as the existing `mark_seen`).

### Architecture Decisions

- **Overload `action=search` with `mutual_only` + `is_mutual` flag, don't add a new action**: because the search code path, sort order, and client hook all already exist — we're just adding one server-side filter and one extra `follows` lookup. Trade-off: the search endpoint's response shape becomes conditionally polymorphic (`is_mutual` present only when `mutual_only=true`), but that's less surface area than a parallel `mutual_follows` action. The existing "non-mutual still tappable, just not selectable" UX requires returning non-mutual rows anyway, so `following_list`-style filtering wouldn't fit.

- **Put "Add member" server logic in `table-management`, not `user-profile`**: it's a Table mutation, not a user-graph mutation. Keeps the mutual-follow rule adjacent to the owner-gate and the `table_members` write. Trade-off: `table-management` now has to read `follows`, a table it previously didn't touch — acceptable; one self-contained validation function.

- **`welcomed_at` column on `table_members`, not a separate `table_welcomes` table**: the state is 1:1 with membership, clears when membership clears (via ON DELETE CASCADE of the row itself), and mirrors the shape of `last_seen_at` from TICKET-010. A separate table would require another join on every Tables-tab render for zero benefit. Trade-off: we can't distinguish "never welcomed" from "welcome dismissed long ago" — both are just `NOT NULL`. That's fine; we only need the one-shot show-once semantic.

- **Owner-only add via server-side `tables.owner_id = auth.uid()` check**: the ticket scopes v1 to owner-only. Any-member-add is a one-line rule relaxation later. Trade-off: when we loosen this, the edge function action and the UI gate both change; the client gate (showing/hiding the CTA) must mirror the server rule or fail loud.

- **Optimistic UI on add, pessimistic on error display**: mutation closes the sheet + optimistically inserts the new member into the cached members list, then invalidates on success. On `NOT_MUTUAL_FOLLOW` / 403 / cap-exceeded, roll back and show an inline toast/`Alert` with the server's error_code mapped to human copy. Trade-off: the optimistic path is complex, but the picker already pre-filters to mutuals so the failure path is mostly a race (they unfollowed between search and add) — worth the snappiness.

- **Forward-only feed for newly-added members**: `table_activity` already filters by `tables.created_at` implicitly via participation semantics; no retroactive backfill. Matches the Open Question default. Trade-off: Alice's older solo logs at a restaurant Dave now cares about won't show in the Table feed — acceptable, and Dave can still see them on Alice's profile if public.

- **Cap enforcement: soft-warn only in v1**: no hard cap. Doctrine says 3–8, but a hard server cap surfaces ugly errors and product hasn't committed. Trade-off: a Table could grow unbounded; accepted for v1, revisit if it becomes a real user pattern.

### File Changes

**Migration**
- `supabase/migrations/20260429000000_table_members_welcomed_at.sql` — NEW — adds `welcomed_at TIMESTAMPTZ NULL` to `table_members`. Mirrors `last_seen_at` migration.

**Edge Functions**
- `supabase/functions/user-profile/index.ts` — MODIFY — extend `action=search` handler: accept optional `mutual_only: boolean`; when true, fetch `follows(follower=me)` AND `follows(following=me)` for result set, intersect, decorate each row with `is_mutual: boolean`. Non-mutual rows are still returned (sorted after mutuals). Response contract: when `mutual_only` is set, every row includes `is_mutual`; otherwise the field is absent (preserving backwards compat).
- `supabase/functions/table-management/index.ts` — MODIFY — add three POST actions:
  - `action=add_member` — body `{ table_id, target_user_id }`. Validates owner, validates mutual follow both directions, idempotent upsert into `table_members` with `role='member'`. Returns `{ data: { member_id, already_member: boolean } }`. Errors: 403 `{ error, error_code: 'NOT_OWNER' | 'NOT_MUTUAL_FOLLOW' }`, 404 if target_user_id doesn't exist.
  - `action=mark_welcomed` — body `{ table_id }`. Sets `welcomed_at = now()` for caller's membership row. Mirrors `mark_seen`.
  - `action=leave_table` — body `{ table_id }`. Deletes caller's row if they're a non-owner member. Owners cannot leave (later ticket handles transfer/delete). Separate action keeps the "Leave" button wiring simple.

**Hooks**
- `napkin-app/hooks/tables/useAddMember.ts` — NEW — `useMutation`; invalidates `queryKeys.tables.members(tableId)` + `queryKeys.tables.detail(tableId)` on success. Maps server error_codes to typed error for the UI.
- `napkin-app/hooks/tables/useLeaveTable.ts` — NEW — `useMutation`; invalidates `queryKeys.tables.list(userId)`, routes back to Tables tab on success.
- `napkin-app/hooks/tables/useMarkWelcomed.ts` — NEW — `useMutation`, optimistically clears welcomed state in `tables.detail` cache.
- `napkin-app/hooks/users/useUserSearch.ts` — MODIFY — accept optional `mutualOnly: boolean` arg; forward to edge function. Type `UserSearchResult` gains optional `is_mutual?: boolean`. Query key becomes `queryKeys.users.search(q, { mutualOnly })` to keep caches distinct.
- `napkin-app/lib/queryKeys.ts` — MODIFY — extend `users.search` key to include a flag object so mutual/non-mutual caches don't collide.

**Client UI**
- `napkin-app/app/table/[id]/settings.tsx` — NEW — Table settings screen. Sections: header (Table name, member count, avatar stack), "Add member" row (owner only, opens `AddMemberSheet`), members list (reuse `PeopleResultRow`-style row but scoped to `TableMemberRow`), "Leave Table" footer action (non-owner members only). Styled per Heirloom Journal — warm paper, italic serif name, Manrope body. Route added via Expo Router file-based routing.
- `napkin-app/components/tables/AddMemberSheet.tsx` — NEW — bottom sheet built on the same Modal + Animated.spring pattern as `TableSwitcherSheet`. Contains `SearchInput` (reuse from `components/search/`), uses `useUserSearch(q, true, { mutualOnly: true })`, renders rows. Mutuals → tap selects and triggers `useAddMember`; non-mutuals → rendered with `"Needs to follow you back"` muted subtitle, tap routes to `/u/[id]`. Shows empty / loading / no-results states matching `PeopleSearchPane` idiom.
- `napkin-app/components/tables/TableMemberRow.tsx` — NEW — presentational row: avatar + display_name + optional "Owner" chip. Tap routes to `/u/[id]` or `/member/[id]` based on context.
- `napkin-app/components/tables/WelcomeBanner.tsx` — NEW — one-line passive banner: "Clara added you to Sunday Roast Club". Warm-cream surface, Ionicons close X, dismiss fires `useMarkWelcomed`. Shown only when membership row has `welcomed_at IS NULL` AND caller is not the Table owner AND `role !== 'admin'` (creator wasn't "added"). The edge function's GET `/:id` response already exposes `members[].joined_at` + `role`; extend it to also return the caller's own `welcomed_at` (trivial addition to the existing single-table read).
- `napkin-app/app/(tabs)/tables.tsx` — MODIFY — render `WelcomeBanner` when the active Table's membership row has null `welcomed_at`. Wire a gear/ellipsis affordance in the header area (small 18pt Ionicon next to the avatar stack, or as part of the existing `TableHeader` via an optional prop) that routes to `/table/[id]/settings`. Keep bottom nav untouched.
- `napkin-app/components/tables/TableHeader.tsx` — MODIFY — accept optional `onSettingsPress` callback; render a subtle outline gear icon to the right of the avatar stack when provided. Keeps the component presentational.
- `napkin-app/components/tables/index.ts` — MODIFY — re-export `AddMemberSheet`, `TableMemberRow`, `WelcomeBanner`.

### Implementation Order

1. **Migration + edge function** — adds `welcomed_at`, `add_member` / `mark_welcomed` / `leave_table` actions, and `mutual_only` flag on `search`. Everything else depends on these being deployable. Test via curl against a local Supabase before writing client code.
2. **Hooks (`useAddMember`, `useLeaveTable`, `useMarkWelcomed`, modified `useUserSearch`)** — depends on step 1's edge function shapes; lets the UI wire to real data.
3. **`TableMemberRow` + `AddMemberSheet`** — pure components; depends on step 2's hooks.
4. **`/table/[id]/settings` route** — depends on steps 2 and 3.
5. **`TableHeader` settings affordance + tables.tsx router wiring** — depends on step 4 existing to route into.
6. **`WelcomeBanner` + tables.tsx integration** — depends on step 1 (column + `mark_welcomed`), independent of steps 3–5, can run in parallel once step 1 is done.
7. **QA pass on the 403 NOT_MUTUAL_FOLLOW race** — unfollow target in one device, try to add in another; confirm rollback + inline error copy.

### Risks

- **Search result shape divergence when `mutual_only` is passed**: if a caller forgets to set the flag but renders the sheet assuming `is_mutual` is present, rows will all be treated as non-mutual (falsy). Mitigation: make the `mutualOnly` argument required in the hook's option bag (not optional), and type `UserSearchResult` as a discriminated union keyed on the request-side flag, so TS prevents the mismatch.
- **Race: Alice adds Dave moments after Dave unfollows her**: server returns 403 `NOT_MUTUAL_FOLLOW`, optimistic insert rolls back. Mitigation: handle in `useAddMember.onError`, surface inline error copy ("Dave no longer follows you back") instead of generic toast.
- **Welcome banner on newly-created Tables**: the Table creator is inserted with `welcomed_at = NULL` too (existing INSERT doesn't set it). That would show them a "X added you to Y" banner on their own Table. Mitigation: in the `tables` POST handler, set `welcomed_at = now()` for the creator at insert time; OR gate the banner on `role !== 'admin'`. Pick the gate — it's the single-line fix and also handles legacy rows.
- **Migration on production `table_members`**: adding a nullable column is safe (no locks, no backfill), but `table_members` is hot. Non-issue with a nullable-no-default column, but flag it so the orchestrator isn't surprised.
- **Owner leaves vs. owner deletes Table**: `leave_table` refuses for owners. If the owner wants out, that's the TICKET for transfer-or-delete — not this one. Make sure the UI never renders "Leave Table" for owners so users don't hit the 403.
- **Cap ambiguity**: no hard cap in v1 means a determined user could add 50+ people. Accept risk; add `member_count` to a future analytics check.

---

## Build Log

### Files Changed

**New files:**
- `supabase/migrations/20260429000000_table_members_welcomed_at.sql` — adds `welcomed_at TIMESTAMPTZ NULL` to `table_members`
- `napkin-app/hooks/tables/useAddMember.ts` — mutation hook; typed `AddMemberError` with `error_code`
- `napkin-app/hooks/tables/useLeaveTable.ts` — mutation hook; invalidates tables list + detail
- `napkin-app/hooks/tables/useMarkWelcomed.ts` — mutation hook; optimistic cache write
- `napkin-app/components/tables/TableMemberRow.tsx` — presentational row: avatar + name + Owner chip
- `napkin-app/components/tables/AddMemberSheet.tsx` — bottom sheet with mutual-only search; non-mutual rows muted/non-selectable
- `napkin-app/components/tables/WelcomeBanner.tsx` — one-shot passive banner; gated on `role !== 'admin'`
- `napkin-app/app/table/[id]/settings.tsx` — settings route: Add member (owner only), members list, Leave Table (non-owner only)

**Modified files:**
- `supabase/functions/table-management/index.ts` — added `add_member`, `mark_welcomed`, `leave_table` POST actions; `GET /:id` now returns `caller_welcomed_at` + `caller_role` + `welcomed_at` in members
- `supabase/functions/user-profile/index.ts` — `action=search` extended with `mutual_only: boolean`; adds `is_mutual` field to each row when flagged
- `napkin-app/lib/queryKeys.ts` — `users.search` key accepts `{ mutualOnly }` opts to keep mutual/non-mutual caches separate
- `napkin-app/hooks/users/useUserSearch.ts` — `options.mutualOnly` arg (required in options bag); `UserSearchResult` gains optional `is_mutual?`
- `napkin-app/hooks/tables/useTableDetail.ts` — response type extended with `caller_welcomed_at` + `caller_role`; fetches with auth header
- `napkin-app/hooks/tables/useTableMembers.ts` — added `avatar_url` to profiles select
- `napkin-app/components/tables/TableHeader.tsx` — optional `onSettingsPress` prop; renders `settings-outline` gear icon when provided
- `napkin-app/components/tables/index.ts` — re-exports `AddMemberSheet`, `TableMemberRow`, `WelcomeBanner`
- `napkin-app/app/(tabs)/tables.tsx` — imports `useTableDetail` + `WelcomeBanner`; wires gear icon to `/table/[id]/settings`; renders `WelcomeBanner` when `caller_welcomed_at === null && role !== 'admin'`

**Type declaration (gitignored, worktree-only):**
- `napkin-app/.expo/types/router.d.ts` — manually added `/table/[id]/settings` to the Expo Router type union so `tsc --noEmit` passes; this file regenerates on `expo start`

### Tests

- `npx tsc --noEmit` — **CLEAN** (0 errors)
- `deno test supabase/functions/` — **6 passed, 38 steps, 0 failed**
- `jest --passWithNoTests` — passes (no unit tests for new hooks; follows existing project convention)
- Pre-commit lint hook: **0 errors, 25 warnings** (all warnings are pre-existing in the codebase, not introduced by this ticket)

### Builder Questions

1. **Welcome banner copy: who is "adder"?** The banner currently resolves the owner's name from `tableDetail.members` (the admin-role member). This is correct for the simple v1 case where only the owner can add. If any-member-add is unlocked later, the backend would need to return an explicit `added_by_user_id` field on the `table_members` row — the current approach would show the owner's name even if a member added them.

2. **`useTableDetail` now sends auth header; previously it didn't.** The existing hook called `supabase.functions.invoke` without explicit auth headers. Supabase's JS client forwards the session automatically for most calls, so this was likely fine before — but `caller_welcomed_at` requires the server to know who the caller is, so I added explicit auth headers to be safe. No behavioral regression expected.

3. **`useTableMembers` direct DB query (no auth header).** This hook queries Supabase tables directly (not via edge function), which relies on RLS. The profile join now includes `avatar_url` — if RLS on `profiles` blocks this join for some callers, the `avatar_url` will come back null (graceful fallback to initials avatar). No change to RLS policies was made.

---

## Review History

### Review 1
Date: 2026-04-21
Verdict: APPROVE

Spec compliance: 9/9 acceptance criteria met
- [x] Table settings screen has a primary "Add member" row above the existing member list — PASS (`app/table/[id]/settings.tsx:128-150`)
- [x] Tapping opens a search sheet with `mutual_only=true` filter — PASS (`AddMemberSheet.tsx:147-149`)
- [x] Results show mutual follows first; non-mutuals muted/non-selectable, tap → profile — PASS (`AddMemberSheet.tsx:68-124`, search sort in `user-profile/index.ts:1085-1092`)
- [x] Selecting mutual-follow inserts into `table_members` and closes sheet — PASS (`AddMemberSheet.tsx:219-238`)
- [x] Server enforces mutual-follow: 403 NOT_MUTUAL_FOLLOW — PASS (`table-management/index.ts:256-280`)
- [~] Added user sees Table in `useTables()` within 30s — WARN: `useTables` staleTime is 5 min; in practice the new Table lands on focus/mount refetch or a manual pull. AC allows "or immediately on manual refresh," so behavior is acceptable.
- [x] Added user sees a single passive banner, dismissible, shown only once — PASS (`WelcomeBanner.tsx`, gated on `caller_welcomed_at === null && caller_role !== 'admin'` in `tables.tsx:126-130`)
- [x] Adding someone already in the Table is idempotent — PASS (`table-management/index.ts:283-297`)
- [x] Leave Table visible for non-owner members only — PASS (`settings.tsx:54, 183-198`)

Correctness: PASS — Owner check against `tables.owner_id`, mutual-follow checked in both directions, idempotent upsert, banner gating on role+welcomed_at, target-exists check before follow lookup.
Edge Cases: WARN — Pre-existing non-admin members from before this migration will have `welcomed_at = NULL` and would see a spurious "You were added…" banner. Acceptable for pre-launch but worth backfilling on production. Self-add is implicitly blocked by the `follows.check(follower_id <> following_id)` constraint producing NOT_MUTUAL_FOLLOW. Closing the sheet while an add is in-flight leaves `addingUserId` stale on next open (minor).
Error Handling: PASS — Typed `AddMemberError` with `error_code`; UI maps NOT_MUTUAL_FOLLOW and NOT_OWNER to specific copy; generic fallback otherwise. Optimistic mark_welcomed rolls back on failure.
Security: PASS — `add_member` enforces `tables.owner_id = auth.uid()` before the follows lookup (returns 403 NOT_OWNER); mutual follow required in BOTH directions before insert (returns 403 NOT_MUTUAL_FOLLOW); `mark_welcomed` scoped by `.eq('member_id', user.id)`; `leave_table` refuses when role='admin' (403 OWNER_CANNOT_LEAVE). RLS on `table_members` INSERT policy already restricts to owner-self-add or admin-add, so a non-owner cannot bypass the edge function via direct anon-key insert. RLS on `follows` prevents spoofing the mutual check.
Performance: PASS — mutual-follow check is two parallel `.maybeSingle()` lookups on indexed `(follower_id, following_id)` PK. Search endpoint adds one additional `IN` lookup when `mutual_only=true`. `welcomed_at` column is nullable with no default (no lock, no backfill).
Design Compliance: PASS — theme tokens only, Ionicons outline @ appropriate sizes, italic Newsreader for TABLE name in hero, warm terracotta accent for CTAs, warm-cream surfaces for banner, dividers via `dividerSoft` background shifts (no 1px solid borders for sectioning), non-negotiable bottom nav untouched.

Key notes (not blocking):
1. Migration leaves legacy non-admin members with `welcomed_at = NULL` → harmless spurious banner on next visit for existing members. Acceptable pre-launch; consider backfill on production rollout.
2. `useAddMember.ts:64-66` invalidates the *adder's* `tables.list(userId)` — not strictly needed since adding a member doesn't change the adder's own tables list. No behavior impact.
3. `TableMember.user_id` in `useTableDetail.ts:14` is mistyped (server returns `member_id`). Pre-existing (outside this ticket's scope); the new tables.tsx banner code only reads `role` and `profiles.display_name`, so no regression.
4. `GET /:id` on table-management does not enforce caller membership (pre-existing behavior with service-role bypass); any authenticated user can fetch any table's member list. Out of scope for this ticket; file a follow-up.
5. No unit tests added for the new actions. Builder followed existing project convention, but the NOT_OWNER / NOT_MUTUAL_FOLLOW paths are critical-path security code and would benefit from Deno integration tests in a follow-up.

---

## Completion

- **Completed:** 2026-04-21
- **Final verdict:** APPROVE (8 PASS / 2 WARN / 0 FAIL)
- **Branch:** `feat/TICKET-029` (stacked on `feat/TICKET-028` → `feat/TICKET-027`). Single commit: `ad60ef5 feat: add member to Table from settings (TICKET-029)`.
- **Deployed to production Supabase (`ftvmseaqwwlcxtdlvxxz`):**
  - Migration `20260429000000_table_members_welcomed_at` applied via MCP ✅
  - `table-management` edge function redeployed (adds `add_member`, `mark_welcomed`, `leave_table` actions; `GET /:id` returns `caller_welcomed_at` + `caller_role`) ✅
  - `user-profile` edge function redeployed (`action=search` now accepts `mutual_only` + returns `is_mutual`) ✅
- **Accepted WARNs** (follow-up candidates, not blocking ship):
  1. Added-user visibility via `useTables` 5-min staleTime — relies on tab-focus refetch or manual pull to hit the 30s window. Consider query invalidation from a push or shorter staleTime.
  2. Legacy non-admin `table_members` rows from before this migration all have `welcomed_at = NULL` → will see a spurious "You were added…" banner once. Pre-launch backfill: `UPDATE table_members SET welcomed_at = now() WHERE welcomed_at IS NULL;` once the app is in the user's hands.
