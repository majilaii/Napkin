---
id: TICKET-012
title: "Member profile — the known face at your table"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [enrichment, profile, social, table-member, identity]
---

# Member Profile — the known face at your table

## Problem

Napkin has members but no *members*. Right now if Sarah posts a 4.5 at Lucali, "Sarah" is just a display name and an avatar — the Table has no surface to get to know her as a taste signature. No "Sarah usually rates between 3.5 and 4.2," no "her Top 5 in this Table," no "she hates slow service," no sense of who she is in this food group.

**The Table is the product.** The people at the table are the half of that product that's currently invisible. If the Table is the trust container, the members are the trust *signals* — "I trust Sarah's 4s more than Mike's 5s because Sarah's 5s are rare." Without profiles, that pattern-matching has to happen entirely in the user's head, off-app. The data to reveal it is right there in the database.

**Who has this problem:** every member of every Table. Especially acute when a Table has 5+ members or has been active for months — at that scale, scrolling the feed to get a sense of "what does Mike think of Italian places" is exhausting.

**Why it matters:** profiles are the glue between *entries* (what someone ate) and *Rounds* (what the Table did together). They make the Table feel populated instead of anonymous. They're also the obvious next stop after TICKET-008 (restaurant memory) — memory of *places* + memory of *people* = the Letterboxd-with-warmth loop.

## Notes

### The mental model

Letterboxd's member profile: recent watches, favorite films, rating distribution, a short bio, a list of lists. Napkin's version is the same idea, but **Table-scoped**. No public profile, no followers, no friends outside the Table. The profile is literally "who Sarah is, at this table."

### What this ticket delivers

A new route `/member/[userId]` (or `/table/[tableId]/member/[userId]` — decide) that renders a member's Table-scoped persona:

1. **Header** — avatar, display name, "member since [date]", and a single-line "taste summary" ("Averages 3.8 · 14 entries · Loves spicy · Slow service is a deal-breaker" — start simple, auto-generated from data patterns).
2. **Rating personality** — a small stats strip: average rating given, number of entries, number of Rounds attended. Optional second row with category affinity ("Leans on vibe and flavor, rarely rates service").
3. **Their top 5 at the Table** — the 5 highest-rated entries they've logged in this Table context, ranked by rating desc (tiebreaker: most recent). Show as compact rows (restaurant name + rating + date).
4. **Recent activity** — last ~10 entries + Rounds they've been in, chronological. Compact rows, tappable → routes into the respective detail screen.
5. **(Optional v2)** Tags they use frequently, most-mentioned dishes, etc.

### Concrete additions

| # | What | Where | Effort |
|---|------|-------|--------|
| 1 | New route `/member/[userId]` with `?tableId=...` context param | `app/member/[userId].tsx` | M |
| 2 | Avatar + display name in header, tappable from nowhere yet | this route | S |
| 3 | Taste summary one-liner (rule-based, no LLM) | `lib/memberSummary.ts` | S |
| 4 | Rating personality stats strip | this route | S |
| 5 | Top 5 entries list | this route | S |
| 6 | Recent activity list (entries + round participations) | this route | M |
| 7 | Make avatar/name tappable everywhere → this route (feed cards, participant rows) | `components/feed/*`, `app/table-night-detail.tsx` | S |
| 8 | "View [name]'s profile" link inside `/entry-detail` | `app/entry-detail.tsx` | S |

### Data layer

No new tables. Queries all go against existing `entries`, `table_night_participants`, `profiles`, `tables`, `table_members`.

New edge function action (on a new `member-profile` function or folded into `table-management`):

- `GET ?action=profile&user_id=X&table_id=Y` → returns `{ profile, stats: { avg, entryCount, roundCount, categoryAffinity }, top_entries: [...], recent_activity: [{ kind, id, rating, date, restaurant_name }] }`

Validates caller is a member of the table. Validates `user_id` is also a member of the same table (can't peek at members from other Tables).

### New hooks

```typescript
// hooks/members/useMemberProfile.ts
useMemberProfile(userId, tableId) → { profile, stats, topEntries, recentActivity }
```

Add `queryKeys.members.profile(userId, tableId)`.

### UX decisions to lock in during product spec

- **Table-scoped only.** No cross-Table aggregation. If Sarah is in three Tables, she has three profiles — one per Table. This keeps Table privacy absolute, matching TICKET-008's decisions.
- **"Own profile" is identical to "member's profile."** Viewing yourself doesn't unlock an edit mode on this screen — editing is still in settings. This keeps the screen single-purpose.
- **Taste summary — rule-based, not generative.** Auto-compute from rating patterns (mean, stdev, most-common category, etc.). Save the LLM-generated vibe-reads for v2 or a separate ticket. Rule-based fails gracefully and doesn't make stuff up.
- **No follow/social affordances.** No DMs, no reactions at the profile level, no "add friend." The profile is informational, not a relationship primitive.
- **Top 5 tiebreaker: most recent.** If multiple entries share a rating, newest wins. This keeps the list fresh.
- **Private visits excluded.** If an entry's visibility is `'private'`, don't show it on the profile — even to the owner viewing themselves (separately addressable through a "my journal" view later).
- **Header copy voice.** "Member since [date]" feels less formal than "joined [date]." Match the Heirloom Journal voice — italic Newsreader subtitle, no corporate social-profile chrome.

### Tap entry points (make avatar/name tappable)

After this ship, the avatar/name combination routes to the profile from:
- **Tables feed cards** — `SoloShareCard`, `JournalNoteCard`, `TableNightCard`'s participant stack
- **Round detail** — `ParticipantRow` in "Who Said What" (avatar + name only; the card body routes to entry-detail — see TICKET-013)
- **Entry detail** — author's avatar/name in the header
- **Restaurant screen** — visit rows (future; show authors on rows)
- **Participant list during live Rounds** — optional, could be confusing mid-game; default off, revisit

### Out of scope

- ❌ Cross-Table aggregate profile ("Sarah across all her Tables")
- ❌ Public profile / share-to-web
- ❌ Activity graphs / score-over-time charts (lives in TICKET-017 if/when)
- ❌ Following, blocking, muting
- ❌ Photo grid of everything they've eaten (v2)
- ❌ LLM-generated vibe summary (keep rule-based)
- ❌ Edit affordances on own profile (settings remains edit location)

### Risks

- **Scaling the "Top 5" query.** On a large Table with hundreds of entries, sorting by rating across all of them needs indexed support. `entries_user_id_idx` + rating filter should be fine. Verify during spec.
- **Member left the Table but historical entries remain.** Edge case: if Sarah was removed from the Table but her past Rounds are still visible, her profile should still be reachable from historical posts. Decision: keep profile reachable but show a "no longer at this table" label at the top. Lock during spec.
- **Taste summary staleness.** If computed on read, it's always fresh but costs a query. If cached, it drifts. Start with on-read (the data volumes are small per Table member).

### Files touched (anticipated)

- **New**: `supabase/functions/member-profile/index.ts`, `napkin-app/hooks/members/useMemberProfile.ts`, `napkin-app/app/member/[userId].tsx`, `napkin-app/components/members/MemberStatsStrip.tsx`, `napkin-app/components/members/TasteSummary.tsx`, `napkin-app/components/members/TopEntriesList.tsx`, `napkin-app/components/members/RecentActivityList.tsx`, `napkin-app/components/members/index.ts`, `napkin-app/lib/memberSummary.ts`
- **Modified**: `napkin-app/lib/queryKeys.ts`, `napkin-app/app/table-night-detail.tsx` (make participant avatar/name tappable), `napkin-app/app/entry-detail.tsx` (add "View profile" link), `napkin-app/components/feed/Avatar.tsx` (optional onPress), `napkin-app/components/feed/SoloShareCard.tsx`, `napkin-app/components/feed/JournalNoteCard.tsx`, `napkin-app/components/feed/TableNightCard.tsx`

### Dependencies

- **Prerequisite for TICKET-013** — member profile is where "View profile" lands after a participant drill-down. Ship this first, then 013.
- **Weak synergy with TICKET-008** — restaurant memory + member memory = the memory cluster. Both ticked, the app starts to feel *smart*.
- **No dependency on TICKET-007 (reactions)** — profile doesn't expose reactions in this scope.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories

- As a Table member, I want to tap a friend's avatar on a feed card and land on their profile, so that I can put their numbers in context without scrolling the whole feed.
- As a Table member, I want a one-glance sense of someone's rating personality (average, distribution, total entries), so that I can calibrate their 4s against mine.
- As a Table member, I want to see a friend's Top 5 at this Table, so that I can get a quick recommendation queue when I'm hungry.
- As a Table member, I want to see a friend's recent activity in this Table (entries + Rounds), so that I can catch up on what they've been eating without opening each card.
- As a Table member viewing my own profile, I want it to look identical to how others see me, so that I know exactly what they see (and trust that the Table is the only audience).
- As a Table member, I want to see the profile of someone who has left the Table but whose old Rounds are still in my feed, so that historical context stays navigable.

### Acceptance Criteria

- [ ] Route `/member/[userId]?tableId=[tableId]` renders the profile; `tableId` is required and scopes all data on the page.
- [ ] Only Table members can view profiles of other members of the same Table. A non-member hitting the route (or passing a `tableId` they don't belong to) sees an error state: "This profile isn't available." No data leaks.
- [ ] A member viewing a `userId` who isn't (and never was) a member of the given Table sees the same error state.
- [ ] Header shows: avatar (large, ~88pt, initials fallback), display name (Newsreader, `displaySmall` weight), "member since [Month Year]" subtitle (Newsreader italic, `textMuted`), and a single-line taste summary (Manrope `bodySmall`, italic, `textSecondary`).
- [ ] Taste summary is rule-based, generated client-side in `lib/memberSummary.ts` from the stats payload. No LLM, no hallucination. Falls back gracefully to just "Averages X.X · N entries" when there's not enough signal.
- [ ] Stats strip shows three tiles side by side: average rating given (Newsreader italic, amber), entry count, Round count. Uses the same breakdown-cell pattern as entry-detail/table-night-detail (`surfaceContainerLow` background, `Radius.lg`).
- [ ] Top 5 section lists up to 5 entries in this Table, sorted by `rating DESC, visited_at DESC`. Each row: restaurant name (Newsreader italic), rating (amber), relative date (`textMuted`). Tapping a row routes to `/entry-detail?entryId=[id]`.
- [ ] Recent activity section lists up to 10 items merged chronologically: solo entries authored by this user in this Table AND Rounds where this user was a participant. Each row shows kind label (ENTRY / ROUND), restaurant name, their rating (if any), relative date. Tapping routes to `/entry-detail` (entries) or `/table-night-detail` (Rounds).
- [ ] Entries with `visibility = 'private'` are excluded from all lists and from the stats (average, entry count), even when the viewer is the profile owner.
- [ ] Tapping avatar or display name on these surfaces routes to this profile with the active `tableId`: `SoloShareCard`, `JournalNoteCard`, `TableNightCard` participant stack, `ParticipantRow` on table-night-detail, author block on entry-detail. Tap target is at least 44x44pt.
- [ ] Entry-detail header gains a "View profile" affordance (text link below the name, Manrope `caption`, `primary` color) that routes to the member profile with the entry's `table_id`.
- [ ] Viewing your own profile (userId matches `useAuth().user.id`) renders identically — no edit button, no "This is you" banner, no visual difference. Tapping your own avatar anywhere in the app is the same route as tapping someone else's.
- [ ] Former-member case: if `userId` exists in `entries` or `table_night_participants` for this Table but is NOT in `table_members` anymore, profile still loads with a `textMuted` italic line under the header: "no longer at this table". All historical data still renders.
- [ ] Empty states: if this member has zero entries, the stats strip shows "—" for average, Top 5 is hidden, and recent activity shows "Nothing here yet" in Newsreader italic `textMuted`. If they have entries but no Round participations, recent activity only shows entries; no special message needed.
- [ ] Loading state: full-screen `ActivityIndicator` in `palette.primary`, matching entry-detail's pattern. Error state: "Couldn't load this profile" with a ← Back affordance.
- [ ] Back button copy is "← Back" (matching entry-detail and table-night-detail).
- [ ] Scroll: the entire profile is one ScrollView; header is NOT sticky. `paddingBottom: insets.bottom + 40`.
- [ ] Live-Round participant list avatars are NOT tappable in this ticket (waiting / rating phase). Only revealed/closed Round participant rows route to profiles.

### UX Decisions

- **Route shape: `/member/[userId]?tableId=X`.** File-based routing in `app/member/[userId].tsx` with `tableId` as a required search param. Chosen over `/table/[tableId]/member/[userId]` because the existing router is flat (`/entry-detail`, `/table-night-detail`, `/restaurant/[id]`) and nested routes would be a one-off.
- **Table-scoped, always.** No cross-Table aggregation. The same user in three Tables has three profiles. Matches TICKET-008's privacy model — Tables are trust containers; bleeding data between them breaks that contract.
- **Own profile is identical to others' profiles.** Editing stays in settings. Keeps the screen single-purpose and means WYSIWYG — if you want to know what your Table sees, you just look.
- **Taste summary — rule-based, not LLM.** Deterministic, auditable, never wrong in an embarrassing way. A v2 ticket can layer in generative vibe-reads.
- **Top 5 tiebreaker: most recent.** Keeps the list feeling current instead of frozen in the Table's early days.
- **Private entries excluded everywhere**, including from the owner's own view. A separate "My Journal" surface (future) can expose private entries to their author.
- **No social primitives.** No follow, no reactions at profile level, no DM. Profile is informational furniture, not a relationship layer.
- **Header voice: "member since April 2026".** Not "Joined 4/12/26." Matches Heirloom Journal editorial register — italic Newsreader subtitle, no corporate profile chrome.
- **Former members stay reachable** with a muted "no longer at this table" subtitle. Historical context doesn't disappear when someone leaves; nothing invites re-engagement either.
- **Tapping your own avatar** routes to your own profile (same as tapping anyone else's). No dead-end.
- **Live Round avatars: not tappable this ticket.** During `rating` phase, a mid-game profile detour is more distracting than useful. Flip it on after Round reveal if friction-testing warrants.

### Out of Scope

- Cross-Table aggregate profile ("Sarah across all her Tables").
- Public profile / share-to-web link.
- Activity graphs, score-over-time charts, rating histograms (TICKET-017 territory).
- Follow, block, mute, DM, reactions at profile level.
- Photo grid of everything the member has eaten.
- LLM-generated taste summary (rule-based only for this ticket).
- Edit affordances on the profile screen — editing lives in settings.
- Pagination / "load more" on recent activity (fixed cap at 10 this ship).
- Most-used tags, most-mentioned dishes, category affinity as a second row (defer to v2 — the single-line taste summary is the MVP).
- Tappable avatars during live `rating` phase of a Round.
- A "My Journal" view for private entries.

### Open Questions

- **Taste summary rules — proposed set (decide before build):**
  1. If `entryCount < 3`: "New to the table · N entr{y,ies} so far" — not enough data for a read.
  2. Always start with `Averages X.X · N entries`.
  3. If `stdDev < 0.4` and `entryCount >= 5`: append "· Steady rater" (they don't swing much).
  4. If `stdDev > 0.9` and `entryCount >= 5`: append "· Strong opinions" (big swings).
  5. If `avg >= 4.2` and `entryCount >= 5`: append "· Generous grader".
  6. If `avg <= 3.0` and `entryCount >= 5`: append "· Tough room".
  7. Category affinity (e.g., "leans on flavor") deferred to v2 — keep this ship to rating-shape signals only.
  Joined with "·" separator. Max 3 clauses total. Confirm thresholds with the team before build.
- **Recent activity — entries authored only, per Notes.** Proposal: yes, only entries this user authored + Rounds they participated in. No reactions, no starred items (those don't exist yet). Blocking: no — proceed with this.
- **Route param name: `tableId`.** Matches `tableId` used elsewhere (`restaurant/[id].tsx`, `entry-detail`). Not blocking.
- **Avatar tap during live Round — default off this ticket.** Documented in acceptance criteria; revisit post-release if users ask for it.

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

One new Expo Router screen at `app/member/[userId].tsx` that reads a required `tableId` search param and fetches everything it needs from a single new edge function, `member-profile`. The edge function does all authorization (caller must be in the Table; target user must be or have been in the Table) and returns one JSON payload: `profile`, `is_current_member`, `stats`, `top_entries`, and `recent_activity` (merged entries + round participations, already sorted). The client hook `useMemberProfile(userId, tableId)` wraps that in TanStack Query; the screen assembles four presentational components (`TasteSummary`, `MemberStatsStrip`, `TopEntriesList`, `RecentActivityList`) and computes the taste-summary string via a pure helper in `lib/memberSummary.ts`. The tap-wiring pass is a second phase: `Avatar` gets an optional `onPress`, and `SoloShareCard` / `JournalNoteCard` / `TableNightCard` / `table-night-detail` / `entry-detail` get a small `handleAuthorPress` that pushes `/member/[userId]?tableId=...`. Edge function first (curl-testable), then hook + screen against real data, then tap wiring last.

### Architecture Decisions

- **New edge function `member-profile` (not folded into `table-management`)**: matches the shape of `restaurant-history` (a Table-scoped read-only aggregator with its own auth rules) and keeps `table-management` focused on CRUD. Trade-off: one more function to deploy, but conceptual clarity wins.
- **Single GET endpoint `?action=profile&user_id=X&table_id=Y`**: returns the whole payload in one round-trip. Top-5 + recent-10 + stats are all small per-member reads; splitting into multiple hooks would add loading coordination for no payoff. Trade-off: any future "paginate recent activity" needs a second action (fine — add it when we need it).
- **Taste summary lives in `lib/memberSummary.ts` as a pure function `buildTasteSummary(stats)`**: deterministic, trivially unit-testable, no infra. Called from the screen after the query resolves. The server returns raw stats (`avg`, `entryCount`, `roundCount`, `stdDev`); the string is assembled client-side so copy tweaks don't require a redeploy.
- **Former-member detection server-side**: the edge function checks `table_members` for current membership and separately confirms historical presence via `EXISTS` in `entries` or `table_night_participants` scoped to that `table_id`. Returns `is_current_member: boolean` on the profile payload. Neither current nor historical → 403. Trade-off: two extra cheap queries, but the client stays dumb and the authorization rule is enforced in one place.
- **`Avatar` gains an optional `onPress` prop**: wraps its root in `Pressable` when provided (with `hitSlop` to reach 44pt), otherwise renders the existing `View`. Chosen over wrapping every call site in `Pressable` because it keeps feed-card JSX tidy and centralizes the 44pt tap-target rule. Trade-off: `Avatar` now knows about interaction — acceptable, the component stays under 30 lines.
- **Route param validation is manual, not zod**: `useLocalSearchParams<{ userId: string; tableId?: string }>()` plus explicit guards (`if (!tableId) return <ErrorState />`). Matches `restaurant/[id].tsx`. No new dependency.
- **Loading state is full-screen `ActivityIndicator` in `palette.primary`**: spec calls it out, and it matches `entry-detail.tsx` / `table-night-detail.tsx`.
- **No realtime**: profiles are read-mostly and drift-tolerant. 5-minute `staleTime` on the query is enough; `useQuery` will refetch on focus. Avoids a Supabase channel subscription for a screen that doesn't need live updates.
- **Private-entry filtering is server-side**: the edge function filters `visibility != 'private'` on both the stats aggregation and the two lists, so the client never sees private data (including when viewing own profile). Matches the acceptance-criteria intent that "My Journal" is a separate future surface.
- **Ordering + limits done in SQL** where possible: Top-5 uses `ORDER BY rating DESC, visited_at DESC LIMIT 5`; recent activity merges two queries (entries + round participations, each limited to 10) then sorts the union in JS and slices to 10. Simpler than a SQL UNION and sufficient at our data volumes.

### File Changes

**New:**
- `supabase/functions/member-profile/index.ts` — NEW — edge function: auth + fetch profile/stats/top-entries/recent-activity for `(userId, tableId)`.
- `napkin-app/hooks/members/useMemberProfile.ts` — NEW — `useMemberProfile(userId, tableId)` query hook; exports `MemberProfileData` types used by components.
- `napkin-app/app/member/[userId].tsx` — NEW — screen: parses params, renders loading/error/former-member/empty states, composes the four sections.
- `napkin-app/lib/memberSummary.ts` — NEW — pure `buildTasteSummary(stats)` using the rule set from Open Questions (averages, steady/strong, generous/tough). Unit-testable, no deps.
- `napkin-app/components/members/TasteSummary.tsx` — NEW — Newsreader italic subtitle under the header, takes a pre-built string.
- `napkin-app/components/members/MemberStatsStrip.tsx` — NEW — three breakdown-cell tiles (avg / entries / rounds) using the entry-detail style.
- `napkin-app/components/members/TopEntriesList.tsx` — NEW — up to 5 compact rows, tap → `/entry-detail`.
- `napkin-app/components/members/RecentActivityList.tsx` — NEW — up to 10 rows, kind label (ENTRY / ROUND), tap routes to the right detail screen.
- `napkin-app/components/members/index.ts` — NEW — barrel export.

**Modified:**
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `members.profile(userId, tableId)` key.
- `napkin-app/components/feed/Avatar.tsx` — MODIFY — add optional `onPress` prop; wrap in `Pressable` with `hitSlop` when provided.
- `napkin-app/components/feed/SoloShareCard.tsx` — MODIFY — make avatar + display name tap → `/member/[userId]?tableId=...`.
- `napkin-app/components/feed/JournalNoteCard.tsx` — MODIFY — same.
- `napkin-app/components/feed/TableNightCard.tsx` — MODIFY — make participant stack avatars tappable (one route per avatar).
- `napkin-app/app/table-night-detail.tsx` — MODIFY — make revealed/closed participant rows tap the avatar/name to profile; live `rating`-phase rows stay inert.
- `napkin-app/app/entry-detail.tsx` — MODIFY — add "View profile" caption link under the author block routing to `/member/[userId]?tableId=[entry.table_id]`.

### Implementation Order

1. **Edge function `member-profile`** — no dependencies; curl-testable in isolation. Validates auth + caller/target Table membership (current or historical), returns the full payload. Ship this, smoke-test with a real user+table pair, confirm the 403 paths.
2. **`queryKeys.members.profile`** — one-line addition; unblocks the hook.
3. **`useMemberProfile` hook** — thin wrapper over `supabase.functions.invoke('member-profile', ...)`; depends on step 1 + 2.
4. **`lib/memberSummary.ts`** — pure function, no deps on anything else. Easy to land before or alongside the screen.
5. **Member components** (`TasteSummary`, `MemberStatsStrip`, `TopEntriesList`, `RecentActivityList`, `index.ts`) — presentational; depend only on the types from step 3.
6. **`app/member/[userId].tsx` screen** — wires steps 3–5 together. Handles param validation, loading/error/former-member/empty states, back button, `ScrollView` with bottom inset.
7. **`Avatar` `onPress` prop** — small, mechanical change; unblocks all the tap-wiring.
8. **Feed-card tap wiring** — `SoloShareCard`, `JournalNoteCard`, `TableNightCard`. One-liner handler per card.
9. **`entry-detail` + `table-night-detail` wiring** — "View profile" link on entry detail; participant-row tap on revealed/closed rounds.
10. **Manual two-device smoke test** — confirm own-profile = others-profile, former-member shows the muted label, private entries excluded, cross-Table access is 403.

### Risks

- **Top-5 query cost on large Tables**: `entries WHERE user_id = X AND table_id = Y AND visibility != 'private' ORDER BY rating DESC, visited_at DESC LIMIT 5`. The existing `entries_user_id_idx` covers the filter; confirm `EXPLAIN` stays sub-10ms on a Table with a few hundred entries. Mitigation: if it degrades, add a composite index `(user_id, table_id, rating DESC)`.
- **Former-member authorization correctness**: the `is_current_member = false` path is the most error-prone — we must still allow reads while returning the flag. Mitigation: unit-test the edge function's three branches (current member, former member with history, never-a-member → 403) with explicit curl cases before moving on.
- **Recent-activity merge fairness**: fetching 10 entries + 10 round participations and then slicing to 10 after sort means an extremely active user could push all rounds off-list, or vice versa. Spec caps at 10 and doesn't ask for balance. Acceptable for v1; revisit if users complain.
- **Cross-Table leak via `tableId` swap**: a caller could pass a `tableId` they belong to but a `userId` who's in a different Table entirely. Mitigation: the server verifies target user's Table presence independently; do NOT short-circuit after confirming the caller's membership.
- **Avatar `onPress` regression**: adding `Pressable` wrapping changes layout subtly (touchable area, possible child clipping). Mitigation: keep the existing `View` as the visual root and wrap *outside* it; visually identical, tappable only when `onPress` is passed.
- **Private-entry exclusion in stats**: if a user has 20 entries with 5 private, the displayed "N entries" must match the filtered count used for `avg`. Mitigation: compute stats from the same filtered set used for the lists, in one pass server-side.
- **`Avatar.onPress` on in-progress rounds**: spec says live-`rating`-phase avatars stay inert. Mitigation: gate the tap wiring in `table-night-detail.tsx` on `status === 'revealed' || status === 'closed'`, not on the `Avatar` component itself — keeps `Avatar` simple.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New:**
- `supabase/functions/member-profile/index.ts` — Edge function: auth + fetch profile/stats/top-entries/recent-activity for `(userId, tableId)`. Validates caller is current member; validates target is current or former member (historical presence via entries or round participations). Private entries excluded server-side. Returns `is_current_member` flag.
- `napkin-app/hooks/members/useMemberProfile.ts` — `useMemberProfile(userId, tableId)` query hook; exports `MemberProfileData`, `MemberProfile`, `MemberStats`, `TopEntry`, `RecentActivityItem` types.
- `napkin-app/app/member/[userId].tsx` — Screen: parses `userId` + `tableId` params, renders loading/error/former-member/empty states, back button, ScrollView with bottom inset. Composes the four section components.
- `napkin-app/lib/memberSummary.ts` — Pure `buildTasteSummary(stats)` function. Implements the approved rule set (new-to-table, averages base, steady/strong, generous/tough qualifiers). No deps, deterministic.
- `napkin-app/components/members/TasteSummary.tsx` — Manrope italic subtitle component for the taste string.
- `napkin-app/components/members/MemberStatsStrip.tsx` — Three breakdown-cell tiles (avg / entries / rounds) using entry-detail's `surfaceContainerLow` + `Radius.lg` pattern.
- `napkin-app/components/members/TopEntriesList.tsx` — Up to 5 compact rows ranked by (rating DESC, visited_at DESC). Taps route to `/entry-detail`.
- `napkin-app/components/members/RecentActivityList.tsx` — Up to 10 merged rows (ENTRY / ROUND kind chip). Taps route to `/entry-detail` or `/table-night-detail`. Empty state: "Nothing here yet" in Newsreader italic.
- `napkin-app/components/members/index.ts` — Barrel export.

**Modified:**
- `napkin-app/lib/queryKeys.ts` — Added `members.profile(userId, tableId)` key.
- `napkin-app/components/feed/Avatar.tsx` — Added optional `onPress` prop; wraps visual in `Pressable` with `hitSlop` to guarantee 44pt tap target when provided.
- `napkin-app/components/feed/SoloShareCard.tsx` — Added `tableId` prop; avatar frame is a Pressable that routes to `/member/[userId]?tableId=...`.
- `napkin-app/components/feed/JournalNoteCard.tsx` — Added `tableId` prop; display name is a Pressable that routes to the member profile.
- `napkin-app/components/feed/TableNightCard.tsx` — Added `tableId` prop; each visible participant avatar is a Pressable routing to their member profile.
- `napkin-app/app/(tabs)/tables.tsx` — Passes `tableId={activeTable?.id}` to `TableNightCard`, `SoloShareCard`, and `JournalNoteCard`.
- `napkin-app/app/table-night-detail.tsx` — `ParticipantRow` accepts `tableId` + `canTapProfile` props; avatar and name are Pressable only when `canTapProfile` is true (i.e. `status === 'revealed' || 'closed'`).
- `napkin-app/app/entry-detail.tsx` — Author avatar and display name are now Pressable (routes to member profile); added "View profile" caption link below the name block.

### Tests
- `npm run test:functions` (via Deno): all 31 existing edge function tests pass. No new test file for `member-profile` was added (no test files exist for `restaurant-history` or other read-only functions — consistent with project convention).
- `npx tsc --noEmit`: clean compile, zero TypeScript errors, across all modified and new files.
- Edge function deployed via `npx supabase functions deploy member-profile` was **not** run (no local Supabase instance available). Manual curl testing not performed — see Builder Questions.
- No device smoke test performed.

### Builder Questions
- **Edge function curl testing:** Could not run locally (no local Supabase instance). Recommend deploying `supabase functions deploy member-profile` against staging and testing the three auth paths (current member, former member, never-a-member → 403) before merging to production.
- **PostgREST `!inner` filter syntax:** The rounds query uses `table_night_participants!inner(user_id, rating)` with `.eq('table_night_participants.user_id', targetUserId)`. This is valid PostgREST v2 syntax and matches the pattern used in `restaurant-history`. Should be confirmed working against a real Supabase instance.
- **`SoloShareActivity` missing `table_id`:** The `SoloShareActivity` type returned by `table-activity` doesn't include `table_id`. Instead, `tableId` is passed as a prop from the parent (`tables.tsx` → `activeTable?.id`). This works for the feed but means the card doesn't carry its own Table context — if cards are ever rendered outside of the Tables tab (e.g. notifications), `tableId` would need to be sourced differently. Added a note here but didn't change the data type to avoid scope creep.
- **Nested Pressable in `SoloShareCard`:** The avatar frame is a `Pressable` nested inside the outer card `Pressable`. In React Native, nested Pressables work correctly (inner captures the tap), but the visual tap feedback only shows on the inner element. This is the intended behavior.
- **`entryCount` in stats includes unrated entries:** Per spec, `entry_count` is the count of all non-private entries (not just rated ones), while `avg` is computed only over rated entries. `stdDev` is computed only over rated entries. This matches the acceptance criteria.


---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
Date: 2026-04-16
Verdict: REVISE
Score: 12 PASS / 4 WARN / 2 FAIL

## PASS
- AC1 (route + required tableId): `app/member/[userId].tsx:123-144` parses params, renders error state when tableId missing. Hook guards with `enabled: !!userId && !!tableId`.
- AC2 (caller-must-be-member, no data leaks): `supabase/functions/member-profile/index.ts:103-110` verifies caller membership via `table_members` with service-role client, returns 403 with `"This profile isn't available."` before any target lookup.
- AC3 (target must be current/former member, 403 otherwise): `index.ts:112-151` checks `table_members` first, then falls back to entry/round presence, and 403s otherwise. Independent target verification → no cross-Table leak.
- AC4 (header layout): `app/member/[userId].tsx:197-246` renders 88pt avatar (LargeAvatar w/ initials fallback), `displaySmall` name, italic `member since [Month Year]` subtitle, taste summary below. Copy matches spec exactly.
- AC6 (stats strip): `components/members/MemberStatsStrip.tsx` uses `surfaceContainerLow` + `Radius.lg`, three-tile row; avg renders `—` when null. Matches entry-detail breakdown-cell pattern.
- AC7 (Top 5 sort): edge function `index.ts:175-176, 239-254` orders by `rating DESC, visited_at DESC`, filters null ratings, slices to 5. `TopEntriesList` taps route to `/entry-detail`.
- AC9 (private-entry exclusion): every query uses `.neq('visibility', 'private')` server-side (stats, Top 5, recent activity). Client never sees private data.
- AC11 (entry-detail "View profile" link): `app/entry-detail.tsx:445-465` renders `Type.caption`/`palette.primary` link under the name block; avatar + name are also tappable (`:409-467`).
- AC12 (own profile identical): no edit chrome; `useAuth().user.id` comparison is absent by design. Single route for any userId.
- AC13 (former-member label): `app/member/[userId].tsx:226-240` renders muted italic "no longer at this table" when `is_current_member === false`.
- AC14 (empty-state loading + error): full-screen `ActivityIndicator` in `palette.primary` (`:146-156`); error state shows "Couldn't load this profile" + ← Back (`:158-173`).
- AC15 (Back copy + scroll): `← Back` everywhere; ScrollView with `paddingBottom: insets.bottom + 40` + `paddingTop: insets.top + Spacing.md`.
- AC16 (live-phase avatars inert): `app/table-night-detail.tsx:882-894` gates `onPress` on `canTapProfile = isRevealedOrClosed`. Waiting branch (pre-submit) keeps View-not-Pressable.

## WARN
- AC6 label pluralization edge case: `MemberStatsStrip.tsx:27,32` labels "Entry"/"Round" singular only when count === 1; count === 0 → "Entries"/"Rounds". Minor — matches common UX but not strictly what most apps do.
- AC10 tap target on JournalNoteCard name: `components/feed/JournalNoteCard.tsx:89` wraps name in Pressable with `hitSlop={8}`. Name text is ~13pt tall; total ~29pt height, below 44pt. Avatar tap (SoloShareCard 56pt) and TableNightCard stacked avatars (32pt + hitSlop 6 → 44pt) are fine. JournalNoteCard name is the miss.
- Taste summary: `lib/memberSummary.ts:22-62` implements the 6 approved rules accurately — including entryCount<3 fallback, singular/plural noun, mutual exclusion between steady/strong and generous/tough, max 3 clauses. But: rule 2 uses `Averages X.X · N entries` even when `entry_count === 1` (should say "1 entry" — covered). `entry_count === 0` path (non-private entries = 0) would fall through to "New to the table · 0 entries so far" — acceptable.
- PostgREST `!inner` + nested `.eq` pattern (`index.ts:140-145, 214-217`): valid PostgREST v2, but novel in this repo. Builder acknowledged needing to confirm against real Supabase. Not broken on paper, untested against real data.

## FAIL
- Recent-activity double-counting round entries: `supabase/functions/member-profile/index.ts:258-265` fetches `entries` without `.is('table_night_id', null)`. When a user rates in a Round, the system creates BOTH a `table_night_participants` row AND an `entries` row with `table_night_id` populated (confirmed in `supabase/functions/table-night/index.ts:246-258`). The screen will show both an ENTRY row and a ROUND row for the same meal in the recent activity list. Spec AC8 says "**solo entries** authored by this user in this Table AND Rounds where this user was a participant." The existing `table-activity` edge function already applies `.is('table_night_id', null)` (`supabase/functions/table-activity/index.ts:97`) — this is the established precedent. Fix: add `.is('table_night_id', null)` to the `entries` query at `index.ts:261-264`.
- Stats `entry_count` conflates solo entries with round entries: `index.ts:169-177, 190` aggregates every non-private entry regardless of `table_night_id`, so a user who participated in 5 Rounds and logged 0 solo shares shows "5 Entries · 5 Rounds" — meaningless overlap. The UI explicitly labels the tile "Entries" (plural of the same word used for the solo-share activity kind), so showing round contributions there is misleading. Apply the same `.is('table_night_id', null)` filter to the stats entry pull. Top-5 is acceptable as-is (spec ambiguous for that list), but stats + recent activity clearly want solo-only.

## Overall
Blocking issues are narrow: both FAILs trace to a single missing predicate (`table_night_id IS NULL`) on the entries queries. Everything else — authorization, UI composition, taste-summary rules, tap wiring, error states, theme tokens — is clean and matches the `restaurant-history` pattern faithfully. Fix the two entry-query filters and this ships. Also recommend manual curl-test of the three 403 branches before merge since the builder couldn't run a local Supabase.

### Review 2
Date: 2026-04-16
Verdict: APPROVE
Score: 14 PASS / 3 WARN / 0 FAIL

## Changes verified
- FAIL #1 fixed (stats + Top 5 entry query): `supabase/functions/member-profile/index.ts:176` adds `.is('table_night_id', null)`. The stats tile "Entries" now reflects solo shares only; Top 5 is sourced from the same filtered `allEntries` set so it inherits the filter (acceptable — spec was ambiguous on Top 5 and the stricter filter is consistent with `table-activity` precedent).
- FAIL #2 fixed (recent activity entry query): `supabase/functions/member-profile/index.ts:266` adds `.is('table_night_id', null)`. Round contributions now appear only as ROUND rows via the separate `table_nights` query (`:209-221`); no double-counting.
- WARN (JournalNoteCard name tap target): `components/feed/JournalNoteCard.tsx:89-92` hitSlop is now `{ top: 16, bottom: 16, left: 8, right: 8 }`. Name text ~13pt + 32pt vertical slop → ~45pt, clears 44pt AC10 threshold. Horizontal 8pt matches the original.

## Regression scan
- Stats path: `allEntries` drives `entryCount`, `avg`, `stdDev`, and Top 5 — all correctly narrowed to solo entries. Rounds still counted independently via `roundRows`; `round_count` unaffected.
- Comments updated honestly (`:168-170`, `:259-260`) to flag the filter semantics for future readers.
- No type changes, no signature changes, no downstream hook/screen updates needed. `useMemberProfile` returns the same shape; UI renders identical tiles with correct values.
- No new FAILs introduced.

## Remaining WARNs (carried from Review 1, unaddressed but non-blocking)
- AC6 pluralization: `MemberStatsStrip.tsx` labels "Entry"/"Round" singular only when count === 1; count === 0 → plural. Minor, common UX, not blocking.
- Taste summary `entry_count === 0` edge path falls through to "New to the table · 0 entries so far" — acceptable copy.
- PostgREST `!inner` + nested `.eq` pattern still untested against real Supabase (builder's note stands). Matches `restaurant-history`; on-paper correct. Recommend curl-testing in staging before prod merge, as Review 1 suggested.

## Overall
Both FAILs cleanly fixed with the single `.is('table_night_id', null)` predicate on both entry queries, matching the `table-activity` precedent. JournalNoteCard hitSlop now clears 44pt vertically. No regressions, no new issues. Ship it — just curl-test the three 403 branches against staging since no local Supabase was available.

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-16
- Final verdict: APPROVE (14 PASS / 3 WARN / 0 FAIL on Review 2)
- Notes: Shipped after one revise cycle. Review 1 flagged two FAILs — both traced to a missing `.is('table_night_id', null)` predicate on the edge function's entries queries (stats + recent activity). Fix was a 2-line change matching the `table-activity` precedent. Also bumped `JournalNoteCard` author name hitSlop to clear the 44pt tap-target AC. Remaining WARNs (pluralization edge, `entry_count === 0` copy, untested PostgREST `!inner` syntax) are non-blocking; recommend curl-testing the three 403 auth branches against staging before prod merge since no local Supabase was available during build.
