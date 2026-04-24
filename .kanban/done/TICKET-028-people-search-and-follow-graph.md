---
id: TICKET-028
title: "People search + follow graph"
priority: high
status: done
created: 2026-04-20
updated: 2026-04-21
tags: [social, search, graph]
---

# People search + follow graph

## Problem

Right now the search tab only finds restaurants. There's no way to find a person on Napkin, follow them, or invite someone not on the app. That blocks the social layer from forming — companion tagging (TICKET-027) needs a way to discover who's even on Napkin, and a public-profile visit (TICKET-020) has nowhere to originate. This ticket closes that gap with the thinnest possible shape: one segmented control + a directional follow graph.

## Notes

### Design intent
- **Segmented control at the top of `/(tabs)/search`**: `Places` (default) | `People`. No Tables tab — Tables are private by doctrine, and you only ever have a handful.
- **People tab behavior:** type a name → people you follow first, then broader matches, then at the bottom a single "Invite [query] via SMS" row that opens the iOS share sheet with a link.
- **Follow = directional, instant.** No pending-accept inbox. Like Instagram public follows. (Private accounts — i.e. users who've opted profile-private in settings — still get followed instantly, but the follower only sees whatever the privacy toggle permits. That's TICKET-020's concern; this ticket just writes the edge.)
- **No counts yet** (follower count etc.). Just the edge and the toggle.

### Data shape

```sql
create table follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on follows(following_id, created_at desc);
```

### Search backend
- Reuse (or add) a simple `people-search` edge function: `GET /people-search?q=clara&limit=20`
- Postgres `ILIKE '%clara%'` on `profiles.display_name` is fine for v1 (users are thousands, not millions).
- Orders: followed users first, then others by recency of signup. Tiebreak by `display_name`.

---

## Product Spec

### User Stories
1. As a user, I want a segmented control at the top of search to switch between Places and People without tab sprawl.
2. As a user looking for someone, I want to type their name and see matching Napkin users, with my follows at the top.
3. As a user who knows someone not on Napkin, I want an "Invite via SMS" row that opens iMessage prefilled with a link so I don't have to hunt in settings.
4. As a user on someone's profile, I want a single [Follow] button that works instantly — no "request sent" limbo.
5. As a user who followed someone, I want to see [Following] on the same button with tap-to-unfollow.

### Acceptance Criteria
- [ ] `follows` table exists with check constraint preventing self-follow
- [ ] `people-search` edge function returns `{ users: [{id, display_name, avatar_url, is_following}] }`
- [ ] Search tab has a segmented control `Places | People` above the input; state scoped to the tab (resetting query switches both)
- [ ] People results render as rows: avatar, display name, small "Following" pill if already followed
- [ ] Empty query on People tab shows suggested people (e.g. users you follow, or recent companions from TICKET-027)
- [ ] Non-empty query with zero matches renders "Invite {query} via SMS" row; tap opens `sms:` with a prefilled body
- [ ] Profile screen gets a [Follow] / [Following] button wired to `useFollow` / `useUnfollow` mutations
- [ ] Follow mutation is optimistic (button flips instantly, reverts on error)
- [ ] No notification is sent to followed user (explicitly — notifications are a separate future ticket)

### UX Decisions
- No follower/following counts exposed in this ticket (hide for now; surface if/when public profile ticket adds them)
- No block/mute in v1 — flag in backlog
- SMS invite body: plain text, includes app link. Example: `"Come keep a food journal with me on Napkin: https://napkinapp.com/i/{referral_code}"`. Referral code optional — static link OK for v1.
- Segmented control is two-wide, no third tab. No Tables tab. Ever.

### Out of Scope
- Notifications (follow, mention, invite accepted)
- Follower/following counts or lists
- Block / mute / report
- Referral codes / invite attribution
- Contact-book scan ("find friends from contacts")
- Paginated People results — first 20 is enough for v1

### Open Questions
- Should `people-search` also include users you've been tagged with (companion history)? *(Lean yes — dogfood-friendly, costs nothing.)*
- Rate-limit: cap follow mutations to 100/day to prevent scripted follow spam? *(Probably yes, trivially enforced server-side.)*

---

## Technical Design

### Approach

Extend existing surfaces — do not fork. Reuse the `user-profile` edge function (add `is_following` to its existing `action=search` response, plus three new actions: `follow`, `unfollow`, `check_follow`). Add a `follows` table migration with a self-follow CHECK and an index on `following_id`. On the client, add a `useFollow`/`useUnfollow` mutation pair modeled exactly on `useToggleReaction` (optimistic flip via query-cache mutation, revert on error). In `app/(tabs)/search.tsx`, keep the current Places flow 100% untouched and wrap the body in a `Places | People` segmented control that mounts a new `PeopleSearchPane` sibling component. Wire a Follow/Following button into `ProfileHeader` gated on `!isSelf`. Net new files are tightly scoped: 1 migration, 2 hooks, 2 components, 1 sub-pane.

### Architecture Decisions

- **Reuse `user-profile` edge function for all follow ops**, not a new `follows` function, because the codebase already has an action-dispatched `user-profile` with the right auth shape, and a separate function adds cold-start latency with no clear benefit. Trade-off: `user-profile/index.ts` grows; accept it.
- **Add `is_following` to the existing `action=search` response** via a single left-join / IN lookup on `follows`, because the alternative — a separate `check_follow` fan-out on the client — is N+1. Trade-off: search becomes relationship-aware, so cache key stays `['users','search', q]` but results are per-caller (already the case since `neq user.id`).
- **Ordering in People results done server-side** — `ORDER BY is_following DESC, created_at DESC` (profiles.created_at), tie-break `display_name`. Client does zero sorting. Trade-off: server takes on ordering; simpler client.
- **Optimistic follow toggle, no confirmation dialog**. Mirrors `useToggleReaction` — button flips instantly, reverts on mutation error. Trade-off: transient flicker on failures; acceptable for a low-severity edge.
- **Follow mutation invalidates two keys**: `queryKeys.users.profile(identifier)` (for future `is_following_viewer` field on profile payload) and `queryKeys.users.search` family. No cross-user invalidation — the target user's follower count is out of scope.
- **Segmented control lives in the Search screen, not a tab** — matches ticket doctrine ("two-wide, no third tab. Ever."). State is local `useState<'places'|'people'>` in `search.tsx`. No URL param. Query string is shared across modes (typing resets results appropriately per pane).
- **Do NOT modify `app/(tabs)/_layout.tsx`** — the bottom nav rule is non-negotiable (Ionicons + labels).
- **Empty-state suggested people** = `useRecentCompanions` merged with people you already follow (new `useFollowingList` helper). No scoring, no recommender. Dedupe by `user_id`, cap at 10. Trade-off: rough signal; enough for v1.
- **Rate limit (open Q)** — defer. Server-side follow insert already has auth + CHECK + PK unique; scripted abuse is not a realistic v1 threat for a closed beta. Reopen if abuse appears.
- **Follow server-side**: `supabase.from('follows').upsert({ follower_id: user.id, following_id: target })` with `onConflict: 'follower_id,following_id', ignoreDuplicates: true`. Unfollow is a plain delete on composite key. The CHECK constraint in the migration guards self-follow; re-assert in the handler with `if (target === user.id) return fail('cannot follow self', 400)` for a clean error.

### File Changes

**Migration**
- `supabase/migrations/20260428000000_create_follows.sql` — NEW — `follows` table per ticket spec, plus RLS: read = caller sees rows where `follower_id = auth.uid() OR following_id = auth.uid()`; insert policy = `follower_id = auth.uid()`; delete policy = same. (Edge function uses service role; policies document intent for any direct client reads.)

**Edge function**
- `supabase/functions/user-profile/index.ts` — MODIFY —
  - Extend `action=search`: after fetching `results`, run one lookup of `follows` rows where `follower_id = user.id AND following_id IN (result_ids)`, then attach `is_following: boolean` to each row. Order server-side: followed first (by `follows.created_at DESC`), non-followed next (by `profiles.created_at DESC`), then `display_name ASC`. Response shape becomes `{ data: { user_id, display_name, avatar_url, is_following }[] }`.
  - New `action=follow`: `{ target_user_id }` → insert, handle self-follow and unique conflict gracefully, return `{ data: { following: true } }`.
  - New `action=unfollow`: same shape, delete, return `{ data: { following: false } }`.
  - New `action=check_follow`: `{ target_user_id }` → single row lookup, return `{ data: { is_following: boolean } }`. Used only for the profile screen Follow button on initial render (before we add `is_following_viewer` to `action=profile` payload — see below).
  - Extend `action=profile` response: include `is_following_viewer: boolean` in the payload (computed at the same point where `viewer_target_relationship` is computed). This lets `ProfileHeader` render the Follow button without a second round-trip. Trade-off: one more small query on profile loads; negligible.

**Hooks**
- `napkin-app/hooks/users/useFollow.ts` — NEW — `useFollow()` + `useUnfollow()` mutations. Accept `{ targetUserId }`. Optimistic pattern:
  - `onMutate`: cancel + snapshot `queryKeys.users.search` family, also cancel `queryKeys.users.profile(targetUserId)`. Flip `is_following` in any cached search results and in the profile payload if present.
  - `onError`: restore snapshots.
  - `onSuccess`: invalidate `queryKeys.users.search` family (cheap, next search refetches) and `queryKeys.users.profile(targetUserId)`.
- `napkin-app/hooks/users/useFollowingList.ts` — NEW — thin query against `follows` joined to `profiles` for the current user's followings, cap 50. Used by `PeopleSearchPane` empty state.
- `napkin-app/hooks/users/useUserSearch.ts` — MODIFY — update `UserSearchResult` type to include `is_following: boolean`. No signature change; existing callers (CompanionPickerSheet) simply gain a field they can ignore.

**Query keys**
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `users.following: (userId: string) => ['users','following', userId]`. (No dedicated follow check key — use `users.profile` since Follow state lives there.)

**UI**
- `napkin-app/app/(tabs)/search.tsx` — MODIFY — add a `useState<'places'|'people'>('places')` near the top. Render a `SearchModeTabs` component under `screenTitle`. When mode === 'places', render the existing body (unchanged). When mode === 'people', render `<PeopleSearchPane query={immediateQuery} debouncedQuery={debouncedQuery} />`. Keep the shared `SearchInput` above both — the query string is shared. Do not refactor the Places branch beyond what's required to host the conditional.
- `napkin-app/components/search/SearchModeTabs.tsx` — NEW — two-wide pill segmented control matching Heirloom Journal tokens (warm paper, italic serif labels "Places" / "People", selected = olive underline, unselected = textMuted). No Ionicons. 44pt tap target.
- `napkin-app/components/search/PeopleSearchPane.tsx` — NEW — FlatList-based body. Three states:
  1. `query.trim().length === 0`: render "Suggested" header and merged `useFollowingList` + `useRecentCompanions` (dedupe, cap 10).
  2. `query` present, results non-empty: render a flat list of `PeopleResultRow` (avatar 40, name, small "Following" pill if `is_following`). Tap → `router.push('/u/' + user_id)`.
  3. `query` present, results empty: render a single `InviteViaSmsRow` with copy `Invite "{query}" via SMS`. Tap → `Linking.openURL('sms:&body=' + encodeURIComponent('Come keep a food journal with me on Napkin: https://napkinapp.com/i/'))`.
- `napkin-app/components/search/PeopleResultRow.tsx` — NEW — presentational row. Props `{ user_id, display_name, avatar_url, is_following, onPress }`.
- `napkin-app/components/search/index.ts` — MODIFY — export new components.
- `napkin-app/components/profile/FollowButton.tsx` — NEW — pill button; reads initial `is_following_viewer` from profile payload, delegates to `useFollow` / `useUnfollow`. Label flips between "Follow" (terracotta fill) and "Following" (outline, textSecondary). Long-press or tap-when-Following triggers unfollow with no confirmation dialog.
- `napkin-app/components/profile/ProfileHeader.tsx` — MODIFY — accept a new optional prop `isFollowingViewer?: boolean` (defaults false). When `!isSelf`, render `<FollowButton />` where the gear currently sits for self. When `isSelf`, keep gear. Mutually exclusive.
- `napkin-app/components/profile/ProfileScreenBody.tsx` — MODIFY — pass `isFollowingViewer={profileData.is_following_viewer}` to `ProfileHeader`.
- `napkin-app/hooks/users/useUserProfile.ts` — MODIFY — add `is_following_viewer: boolean` to the response type.

**Do NOT touch**
- `app/_layout.tsx` / `BottomNavBar` / `navStyles`
- `hooks/users/useUserSearch.ts` callers other than the single field addition
- Any Places tab component (`useRestaurantSearch`, `SearchResultRow`, `TierHeader`, `RecentSearchesList`, `SearchInput`)

### Implementation Order

1. **Migration** — `follows` table + RLS + indices. Must run before any edge-function reads.
2. **Edge function extensions** — add `follow`, `unfollow`, `check_follow`, extend `search` response with `is_following`, extend `profile` response with `is_following_viewer`. Deploy.
3. **Hook updates** — `useFollow` / `useUnfollow` (optimistic), `useFollowingList`, update `useUserSearch` type, add `is_following_viewer` to `useUserProfile`. Depends on step 2.
4. **FollowButton + ProfileHeader wiring** — tests the follow edge end-to-end via the profile screen before exposing Search UI. Depends on step 3.
5. **Search mode tabs + PeopleSearchPane + PeopleResultRow** — last, because it's pure composition over shipped hooks. Depends on steps 3–4.
6. **Invite-via-SMS row + empty-state merge** — cosmetic tail; lowest risk.

### Risks

- **CompanionPickerSheet regression** (TICKET-027) — it consumes `useUserSearch`. Adding a field is additive, but verify the row renderer doesn't break on an unknown key.
- **Self-follow race** — user hits Follow on a stale profile where the viewer IS the target (e.g. identifier resolution bug). Mitigation: CHECK constraint + explicit server-side guard returning 400. Do not swallow the error.
- **Optimistic cache drift across multiple query keys** — follow flips appear in `users.profile`, `users.search`, and suggested-people lists. Mitigation: `onMutate` only flips `search` cache entries containing the target id; on `onSuccess` invalidate the broad search family. `useFollowingList` gets a direct invalidation so its suggested-people output refreshes.
- **Profile payload adds a new field** — older clients reading `is_following_viewer` as `undefined` coerces to falsy (shows Follow). Safe default.
- **Segmented control shares the input debounce** — switching from Places → People while a query is in flight could show stale Places results for a blink. Mitigation: the conditional swap on `mode` unmounts the Places list; no stale render is visible.
- **No notification sent** — explicit ACK. Do not add a side-effect insert into any notifications table; the ticket is clear.

---

## Build Log

### Files Changed

**Migration**
- `supabase/migrations/20260428000000_create_follows.sql` — NEW — `follows` table, composite PK, self-follow CHECK, `follows_following_idx`, RLS (read/insert/delete scoped to auth.uid()).

**Edge function**
- `supabase/functions/user-profile/index.ts` — MODIFIED — extended `action=profile` with `is_following_viewer` in all non-self branches; extended `action=search` with `is_following` (single IN lookup, no N+1) and server-side ORDER (followed → created_at DESC → display_name ASC); added `action=follow`, `action=unfollow`, `action=check_follow`, `action=following_list`.

**Hooks**
- `napkin-app/hooks/users/useFollow.ts` — NEW — `useFollow()` + `useUnfollow()` mutations, optimistic pattern mirroring `useToggleReaction`.
- `napkin-app/hooks/users/useFollowingList.ts` — NEW — thin query for the caller's following list (used by PeopleSearchPane empty state).
- `napkin-app/hooks/users/useUserSearch.ts` — MODIFIED — added optional `is_following?: boolean` to `UserSearchResult`. Additive; existing callers unaffected.
- `napkin-app/hooks/users/useUserProfile.ts` — MODIFIED — added `is_following_viewer: boolean` to `UserProfileData` type.
- `napkin-app/hooks/users/index.ts` — MODIFIED — barrel exports for `useFollow`, `useUnfollow`, `useFollowingList`.

**Query keys**
- `napkin-app/lib/queryKeys.ts` — MODIFIED — added `users.following`.

**UI**
- `napkin-app/components/profile/FollowButton.tsx` — NEW — pill button, terracotta fill (Follow) / outline (Following), long-press to unfollow, optimistic local state.
- `napkin-app/components/profile/ProfileHeader.tsx` — MODIFIED — accepts `isFollowingViewer` prop; renders `FollowButton` instead of gear for non-self.
- `napkin-app/components/profile/ProfileScreenBody.tsx` — MODIFIED — passes `profileData.is_following_viewer` to `ProfileHeader`.
- `napkin-app/components/profile/index.ts` — MODIFIED — exports `FollowButton`.
- `napkin-app/components/search/SearchModeTabs.tsx` — NEW — two-wide segmented control (Places | People), Newsreader italic labels, terracotta underline.
- `napkin-app/components/search/PeopleSearchPane.tsx` — NEW — three-state pane: suggested (empty query), results FlatList, InviteViaSmsRow.
- `napkin-app/components/search/PeopleResultRow.tsx` — NEW — avatar 40, display name, Following pill.
- `napkin-app/components/search/index.ts` — MODIFIED — exports new components.
- `napkin-app/app/(tabs)/search.tsx` — MODIFIED — added `mode` state, `SearchModeTabs` in header, conditional `PeopleSearchPane` vs existing Places body.

### Tests

- `npx tsc --noEmit` — 0 errors.
- `deno test supabase/functions/` — 6 passed (38 steps), 0 failed. Existing user-profile tests still pass.
- `jest --passWithNoTests` — no jest tests exist for the app yet; passed.
- All 25 lint warnings are pre-existing (from other files); 0 new warnings introduced by this ticket.
- Migration applied successfully against local Supabase (`npx supabase migration up`).

### Builder Questions

1. **`action=profile` for `relationship=none` (private account, no shared table)**: The ticket extends `is_following_viewer` to `tables_in_common` and public branches, but `none` still returns `notFound()` before any follow check. A user who follows a private account can't visit their profile via this endpoint. Is that the intended behaviour, or should `none` be relaxed to `none_but_following` once follows are wired? This is TICKET-020's concern per the design — noting it here in case it needs a fast-follow.

2. **`SearchModeTabs` placement**: Per the design the segmented control sits "under `screenTitle`" — in the header area above `SearchInput`. I placed it *between* the search input and the body (i.e., after `SearchInput` in the header `View`). That means the tabs are always visible and the shared input stays at top. If the intended layout is tabs above the input, the two lines in `search.tsx` can be swapped.
   **→ Resolved by orchestrator (2026-04-21):** Swapped — tabs now render above the input. Matches IG/Twitter/Beli mental model (tab switch frames what you're searching before you type).

3. **`Radius.full` on the `FollowButton`**: The design spec says "pill" — `Radius.full` (9999) achieves that. If the design system expects a fixed radius value (e.g. `Radius.xl`) for action pills, this can be adjusted without logic changes.
   **→ Resolved by orchestrator (2026-04-21):** `Radius.full` is correct. IG/Twitter action pills use full radius; `Radius.xl` would read as a card corner.

---

## Review History

### Review 1
Date: 2026-04-21
Verdict: APPROVE

Spec compliance: 9/9 acceptance criteria met
- [x] `follows` table exists with check constraint preventing self-follow — PASS (`supabase/migrations/20260428000000_create_follows.sql:10` — `check (follower_id <> following_id)`; composite PK; `on delete cascade`; `follows_following_idx` index; RLS enabled with read/insert/delete policies scoped to `auth.uid()`).
- [x] `people-search` edge function returns `{users: [{id, display_name, avatar_url, is_following}]}` — PASS (action=search in `supabase/functions/user-profile/index.ts:1015` returns `{data: [{user_id, display_name, avatar_url, is_following}]}`, matching the tech-design response shape. The ticket's `{users:[...]}` was a shape-shift; the implemented `{data}` shape matches existing codebase convention and explicit tech-design line 111).
- [x] Segmented control `Places | People` above input; state scoped to tab — PASS (`napkin-app/app/(tabs)/search.tsx:252-259` — tabs render above input after orchestrator swap; `mode` is local `useState`).
- [x] People results render as rows — PASS (`PeopleResultRow.tsx` — avatar 40, display name, "Following" pill when `is_following`).
- [x] Empty query → suggested people (follow list + recent companions) — PASS (`PeopleSearchPane.tsx:98-121` — merges `useFollowingList` + `useRecentCompanions`, dedupes by user_id, cap 10).
- [x] Non-empty query with zero matches → invite SMS row — PASS (`PeopleSearchPane.tsx:168-174` — `InviteViaSmsRow` with `Linking.openURL('sms:&body=...')`).
- [x] [Follow]/[Following] on profile wired to `useFollow`/`useUnfollow` — PASS (`FollowButton.tsx` + `ProfileHeader.tsx:82-99` — mutually exclusive with gear; renders FollowButton when `!isSelf`).
- [x] Optimistic mutation — PASS (FollowButton flips local state instantly and reverts on error via `onError: () => setIsFollowing(...)`; useFollow also mirrors the useToggleReaction pattern on search + profile caches).
- [x] No notification sent to followed user — PASS (zero notification code in diff; insert is pure follows-table upsert).

Correctness: PASS — all mutation paths authenticated via server; follower_id is always set from `user.id`, never trusted from client.
Edge Cases: WARN — small profile-cache key mismatch (see issue #1); FollowButton local state doesn't react to later `initialIsFollowing` prop changes (see #2).
Error Handling: PASS — mutation errors roll back optimistic state; self-follow returns 400 with clear message; DB CHECK is a final backstop.
Security: PASS — `follower_id = user.id` is always set server-side; `target_user_id === user.id` guard prevents self-follow both in edge function and via DB CHECK; no forwarded-id vulnerability; RLS policies are correctly scoped even though edge function uses service role.
Performance: PASS — search uses single IN-lookup on follows (no N+1); ordering done server-side in JS (not SQL, but dataset capped at 20). `following_list` uses one query for follows + one for profiles.
Design Compliance: PASS — tokens sourced from theme (`Radius.full`, `Colors.primary`, `oliveCream`, `surfaceContainerLow`, `textInverse`). Italic Newsreader on mode tabs. No hardcoded colors except the pre-existing avatar-initials `rgba(255,255,255,0.92)` copied from ProfileHeader. No emoji in chrome.

Out-of-scope check: PASS — no follower counts, no block/mute, no contact scan, no rate limiting, no notifications added.

Key issues (all non-blocking):
1. **Profile cache key drift when visited via username** (WARN) — `napkin-app/hooks/users/useFollow.ts:66,101,161,169` invalidate `queryKeys.users.profile(targetUserId)` where `targetUserId` is always a UUID. But `useUserProfile` can be called with a username (route `/u/[identifier]` where identifier may be a username). If the user visits `/u/clara` and taps Follow, the optimistic flip and `onSuccess` invalidation miss the cache entry `['users','profile','clara']`. Visible UI is correct because `FollowButton` uses local state, but cached `is_following_viewer` goes stale until the 5-min `staleTime` elapses. Fix: invalidate by prefix `['users','profile']` or also pass the route identifier into the mutation.
2. **FollowButton ignores `initialIsFollowing` prop updates** (WARN) — `napkin-app/components/profile/FollowButton.tsx:25` initializes state once; later prop changes (e.g., from a cache refetch that reflects another-device follow) do not update the label. For the common path this is invisible because the button itself drives the state. Fix (optional): sync with `useEffect` on `initialIsFollowing`, or key the component on `initialIsFollowing`.
3. **Search within-followed ordering** (WARN) — tech design line 111 says "followed first by `follows.created_at DESC`, non-followed by `profiles.created_at DESC`" — implementation in `supabase/functions/user-profile/index.ts:1065-1074` uses `profiles.created_at` for both branches (follow-time is not fetched into the join). Net effect is close to intent for most cases; escalation path is minor.
4. **SMS URL format non-standard** (WARN) — `PeopleSearchPane.tsx:49` uses `sms:&body=` per ticket spec. iOS accepts this in modern versions but the canonical no-recipient form is `sms:?body=` (or `sms:/open?body=`). Since the spec explicitly specifies `sms:&body=`, not flagging as FAIL. Worth a device-smoke test.

Nits (non-blocking):
- `useFollow.ts:54,127` have unused `data` bindings in `for (const { key, data } of ...)` destructuring — lint warnings, not errors. Harmless.
- `useFollow.ts:47,121` use `Array<T>` where lint prefers `T[]` — pre-existing project style convention.

---

## Completion

- **Completed:** 2026-04-21
- **Final verdict:** APPROVE (9 PASS / 4 WARN / 0 FAIL)
- **Branch:** `feat/TICKET-028` (stacked on `feat/TICKET-027`). Commits: `3e60482` (migration), `3d73785` (edge function + hooks), `65640e4` (FollowButton + ProfileHeader), `86dd395` (Search segmented control + PeopleSearchPane), `ab5004a` (orchestrator: swap tabs above input).
- **Deploy notes:**
  - Migration `20260428000000_create_follows.sql` needs `supabase db push` to the remote project.
  - Edge function `user-profile` needs redeploy (added `follow` / `unfollow` / `check_follow` / `following_list` actions + `is_following` on `action=search` + `is_following_viewer` on `action=profile`).
- **Accepted WARNs** (follow-up candidates, not blocking ship):
  1. `useFollow` cache invalidation uses UUID-keyed `queryKeys.users.profile(targetUserId)`; when the profile was loaded via username (`/u/clara` path), the cache stays stale for 5min. Local follow state still correct (FollowButton `useState`); only stale for siblings reading from cache. Fix: invalidate by prefix.
  2. `FollowButton` seeds from `initialIsFollowing` prop via `useState` — doesn't react to later prop changes (cross-device follow won't reflect on refetch). Fix: `useEffect(() => setIsFollowing(initialIsFollowing), [initialIsFollowing])`.
  3. Within-followed ordering uses `profiles.created_at` where the tech design specified `follows.created_at`. Shows followed users by signup recency instead of follow recency. Single-line SQL fix.
  4. `sms:&body=` used per ticket spec; canonical no-recipient form is `sms:?body=`. Both work on modern iOS; smoke-test on device.
