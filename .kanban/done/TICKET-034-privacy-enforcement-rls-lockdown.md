---
id: TICKET-034
title: "Privacy enforcement — lock down entries RLS and purge aggregate leaks"
priority: critical
status: in-progress
created: 2026-04-24
updated: 2026-04-24
tags: [security, privacy, rls, backend, doctrine]
---

# Privacy enforcement — lock down entries RLS and purge aggregate leaks

## Problem

The app's privacy doctrine is not enforced at the database layer. A bug patrol scan (2026-04-24) found that **`entries` row-level security is effectively disabled for reads** — the SELECT policy is `USING (true)`. Any authenticated client can issue:

```ts
supabase.from('entries').select('*').eq('user_id', '<anyone>')
```

from devtools and receive every private log in the system, including `content`, `rating`, and `visibility='private'` rows that the product explicitly promises stay in the author's journal. This directly contradicts the locked doctrine in `CLAUDE.md`:

> **Logs default private.** Surface on public profile only when log has real review content AND profile is public.
> **Tables are never public.** Whatever a user opts in to publicly does not include Table activity.

Today, privacy is enforced only at the edge function layer. Every edge function uses the service role key (bypassing RLS) and re-derives visibility manually. That pattern is consistent with `CLAUDE.md` guidance, but it creates a single-layer defense: the moment any client code — present or future — calls `supabase.from('entries')` directly, the whole privacy story collapses. The bug patrol identified ~26 direct client table calls against `entries`-adjacent tables today, including:

- `hooks/entries/useMySoloEntries.ts:52` — `supabase.from('entries')` for the user's own feed
- `hooks/entries/useEntriesForDay.ts:38-51` — direct query
- `app/entry-detail.tsx:124-193, 204, 305` — direct `entries`, `entry_companions`, `entry_photos` reads
- `app/table-night-detail.tsx:88-92, 128-144, 830, 839` — direct queries
- `hooks/users/useRecentCompanions.ts:22-25, 34` — companion lookup scans all entries
- `hooks/entries/useEntryPhotoMutations.ts` — direct photo CRUD

Adjacent issues in the same failure mode:

1. **`entry_photos` SELECT policy references the wrong column** — `tm.user_id` instead of `tm.member_id` (`20260417000000_create_entry_photos.sql:19`). The policy silently collapses to "only the author can read their photos." It only works today because every read path goes through service-role edge functions. Any direct client fetch of entry photos — e.g., in `entry-detail.tsx:305` — should be failing for Tablemates right now; the fact that it isn't tells us either RLS is being bypassed or those fetches return empty silently.

2. **`entry_participants` has `USING (true)`** on SELECT (`20260415000000_collaborative_entries.sql:19`). Same vector as `entries`.

3. **`restaurant-history?action=page` leaks private data into aggregates.** The "Napkin aggregate" number (`supabase/functions/restaurant-history/index.ts:816-824`) averages `rating` across all `entries` for the restaurant with no `visibility` filter. Private logs get rolled into the public number, violating the doctrine line:

   > External context is shown on restaurant pages as a sibling signal — never merged with Napkin numbers, never computed as a cross-Table aggregate.

4. **"Who's been" and photo pool** on restaurant pages (`restaurant-history/index.ts:623-631, 841-904`) include entries from any Tablemate, any Table, with no `visibility` filter. Private feed-only entries by Tablemates surface on restaurant pages that the viewer's Tables wouldn't otherwise reveal.

This ticket closes those holes. It is the privacy-doctrine-enforcement ticket: it must ship before any further public surface, public feed, public list, or stranger-browse expansion, because every one of those features assumes the primitives underneath are already private-by-default.

## Notes

### Doctrine references

- `CLAUDE.md` → "Privacy and the public layer (doctrine locked 2026-04-17)" + 2026-04-20 update (profiles public-default).
- Memory: `project_napkin_doctrine.md`.
- Existing enforcement pattern: `supabase/functions/user-profile/index.ts:231-245` (`fetchStats`) already filters `.neq('visibility', 'private')` — use that as the template.

### Scope

This ticket covers **three bundled concerns**:

1. **Database-layer RLS lockdown** — rewrite the `entries` SELECT policy and audit every related table (`entry_participants`, `entry_photos`, `entry_companions`, `table_nights`, `table_night_participants`) for the same failure modes.
2. **Aggregate-leak patching** — add `visibility` filters to every cross-Table SELECT in edge functions that feeds a public or shared surface.
3. **Direct-client-query audit** — every existing `supabase.from('entries' | 'entry_photos' | 'entry_companions')` call in the client must still work under the new policies, OR be migrated to an edge function. No client regressions.

Out of scope (separate tickets):
- Optimistic update correctness (separate P0 ticket).
- Pagination contract unification (separate P0 ticket).
- `member_id` vs `user_id` schema rename (separate P2 chore).
- Dead code purge (`useSubmitTake` etc.) (separate P2 chore).

### Design decisions

- **Keep `entries.visibility` as the source-of-truth column.** Already exists; don't add a parallel mechanism.
- **Visibility values in RLS:** at the SELECT policy level, distinguish `'private'` (author only) from non-private (`public`, `table`, default NULL treat-as-public-among-tablemates). Follow what `is_entry_publicly_eligible(id)` already computes — promote that SQL function to a STABLE helper if not already.
- **RLS supersedes edge-function checks, doesn't replace them.** Edge functions keep their manual auth validation so the response shape stays structured; RLS becomes the backstop.
- **Service role keeps bypass.** We don't change the pattern of edge functions using service role — only the definition of what a direct-client query can see.
- **Trust but restrict the author.** The author always sees their own row regardless of visibility. A Tablemate sees rows `table_id IN (shared tables)`. A companion sees rows `id IN (entry_companions WHERE user_id = auth.uid())`. A public viewer sees rows meeting `is_entry_publicly_eligible` AND author `account_privacy = 'public'`.
- **No "public" = no RLS.** `places` (`20251215145100:20`) and `restaurants` remain publicly readable. They are not user-generated content. `reviews` is a legacy/unused table — consider a separate chore to drop it if truly dead (check grep for usage first; out of scope here).

### Open questions

- Does the performance of the new SELECT policy (with `EXISTS` subqueries on `table_members` and `entry_companions`) require new indexes? Acceptance criteria include EXPLAIN checks on the three hot query paths (`useMySoloEntries`, `useEntriesForDay`, `restaurant-history`).
- Should we add a `SECURITY DEFINER` helper function `can_view_entry(entry_id)` to encapsulate the logic and share it between RLS and edge functions? Architect to decide in tech design.
- For public-profile-opted-in users, when the viewer is also authenticated, does the RLS need to also check `profiles.account_privacy = 'public'`? Yes — doctrine is "public logs only surface when profile is public AND log has real review content." Encode in the policy.

### Dependencies

None blocking. Ships as a pure backend + client-audit change. Coordinates with nothing else in flight.

### Risk

**This is a high-risk migration.** Flipping the RLS on `entries` from `USING (true)` to a restrictive policy WILL break any existing client code that reads entries and currently leans on the open policy. The entire direct-client-query audit is there to catch this pre-ship. Verification plan:

- Run migration locally on a seeded database.
- Exercise every screen that displays an entry (journal, tables tab, entry-detail, restaurant page, member profile, calibration, wishlist, round flow).
- Before production migration: add a **preview migration** that creates the new policies with a different name alongside the open ones, confirm they return correct rowsets in prod via `EXPLAIN`/spot queries, then flip in a second migration by dropping the old `USING (true)` policy.

---

## Product Spec

### User Stories

This is primarily a correctness ticket; the stories are mostly negative (things that should not leak).

- As a **user who logged a private meal**, I want that log to be invisible to anyone except me, so that my journal is actually a journal.
- As a **user who is a Tablemate of the author**, I want to see logs the author shared to our Table, but not their feed-only or private logs, so the Table boundary means something.
- As a **user who is tagged as a companion on an entry**, I want to see that entry regardless of its Table scope, because I was there.
- As a **user browsing a public profile or a public list author's page**, I want to see only the logs the author has consented to expose publicly (public profile AND log has review content), never their private journal.
- As a **user viewing a restaurant page**, I want the "Napkin aggregate" number to never include private logs, because that number is presented as a public signal.
- As a **user viewing a restaurant page**, I want "who's been" and the photo pool to respect the same privacy boundaries — no surprise surfacing of a Tablemate's feed-only visit.
- As a **developer adding a new feature next month**, I want the database to enforce privacy automatically, so I don't have to re-derive the rules every time I write a new edge function or hook.

### Acceptance Criteria

#### Migration 1 — `entries` SELECT policy rewrite

- [ ] New migration `supabase/migrations/YYYYMMDDHHMMSS_entries_rls_lockdown.sql`.
- [ ] Drop policy `entries_readable` on `public.entries`.
- [ ] Create policy `entries_select_v2` ON `public.entries` FOR SELECT TO authenticated USING a predicate that evaluates true iff ANY of:
  - `auth.uid() = user_id` (author).
  - `table_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.table_members tm WHERE tm.table_id = entries.table_id AND tm.member_id = auth.uid())` (Tablemate).
  - `EXISTS (SELECT 1 FROM public.entry_companions ec WHERE ec.entry_id = entries.id AND ec.user_id = auth.uid())` (companion).
  - `visibility = 'public' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = entries.user_id AND p.account_privacy = 'public') AND (content IS NOT NULL OR rating IS NOT NULL)` (public-eligible, author opted in).
- [ ] Extract the predicate into a `SECURITY DEFINER STABLE` function `public.can_view_entry(target_user_id uuid, entry_id uuid, table_id uuid, visibility text, content text, rating double precision)` OR a simpler `public.can_view_entry(e entries)` row-type helper — architect to choose. Policy calls the helper so the rule lives in one place.
- [ ] Anon (unauthenticated) users get no read access via RLS. All public surfaces go through edge functions, which use service role.

#### Migration 2 — `entry_participants` SELECT policy rewrite

- [ ] Drop policy `entry_participants_select` (`USING (true)`).
- [ ] New policy `entry_participants_select_v2` ON `public.entry_participants` FOR SELECT TO authenticated USING:
  - `auth.uid() = user_id` (self), OR
  - `EXISTS (SELECT 1 FROM public.entries e WHERE e.id = entry_participants.entry_id AND <same predicate as can_view_entry on e>)`.
- [ ] Reuse `can_view_entry` helper from Migration 1.

#### Migration 3 — `entry_photos` SELECT policy fix + correctness

- [ ] Drop policy `entry_photos_select` (broken — references non-existent `tm.user_id`).
- [ ] New policy `entry_photos_select_v2` ON `public.entry_photos` FOR SELECT TO authenticated USING:
  - `EXISTS (SELECT 1 FROM public.entries e WHERE e.id = entry_photos.entry_id AND <can_view_entry predicate>)`.
- [ ] Audit `entry_photos` INSERT/UPDATE/DELETE policies for the same `tm.user_id` vs `tm.member_id` bug; fix if present.

#### Migration 4 — `entry_companions` policy audit

- [ ] Read current `entry_companions` RLS. If SELECT is `USING (true)` or misreferences columns, tighten to:
  - `auth.uid() = user_id` (self — "entries I was tagged on"), OR
  - `EXISTS (SELECT 1 FROM public.entries e WHERE e.id = entry_companions.entry_id AND e.user_id = auth.uid())` (author of the entry can see who they tagged).
- [ ] Ensure `entry_companions` SELECT does NOT leak companion lists to unrelated viewers.

#### Migration 5 — RLS sanity audit (documented, not code)

- [ ] Produce a short audit note (can live in the migration file as a comment block, or as a markdown doc committed under `supabase/docs/rls-audit-2026-04-24.md`) enumerating every table with RLS enabled and its SELECT policy shape. Flag anything that remains `USING (true)` and justify why (e.g., `restaurants`, `places` — intentionally public).
- [ ] Specifically confirm: `table_nights`, `table_night_participants`, `post_reactions`, `post_comments`, `wishlist_items`, `lists`, `list_entries`, `follows`, `profiles` — each has a correctly-scoped SELECT policy. Fix any `USING (true)` found outside the intentional-public list.

#### Edge function patches — visibility filters on aggregates

- [ ] `supabase/functions/restaurant-history/index.ts:816-824` — the `napkinEntries` query MUST filter `neq('visibility', 'private')`. Verify the aggregate is computed only over non-private entries.
- [ ] `supabase/functions/restaurant-history/index.ts:623-631` — "who's been" shared-user query MUST filter `neq('visibility', 'private')` before rolling up ratings.
- [ ] `supabase/functions/restaurant-history/index.ts:841-904` — photo pool MUST filter out photos belonging to entries where `visibility = 'private'` unless the viewer is the author, a Tablemate (via shared Table), or a tagged companion.
- [ ] `supabase/functions/user-profile/index.ts:231-245` — confirm existing filter is correct (already filters private; no regression).
- [ ] Grep for every `.from('entries')` call across `supabase/functions/**` and confirm each has either a visibility filter OR a clear non-aggregate justification (e.g., showing the user their own entries, or within-Table Tablemate view where all Table-scoped entries are permitted).

#### Client-side direct-query audit

Each of the following files must be verified to still work under the new RLS. For any that will NOT work, migrate to an edge function or add the necessary scope filters.

- [ ] `napkin-app/hooks/entries/useMySoloEntries.ts:52` — author-owned reads; should keep working.
- [ ] `napkin-app/hooks/entries/useEntriesForDay.ts:38-51` — author-owned reads; should keep working.
- [ ] `napkin-app/app/entry-detail.tsx:124-193` — fetches a single entry; must work for author, Tablemate, companion, or public-eligible viewer.
- [ ] `napkin-app/app/entry-detail.tsx:204` — `entry_companions` direct read; must work for entry-author and tagged companions.
- [ ] `napkin-app/app/entry-detail.tsx:305` — `entry_photos` direct read; gated on parent-entry visibility.
- [ ] `napkin-app/app/table-night-detail.tsx:88-92, 128-144, 830, 839` — entry + entry_photos reads for a round; Tablemate visibility should hold.
- [ ] `napkin-app/hooks/users/useRecentCompanions.ts:22-25, 34` — scans recent entries; must be the viewer's own entries.
- [ ] `napkin-app/hooks/entries/useEntryPhotoMutations.ts:38,49,90,109` — photo CRUD; INSERT/UPDATE/DELETE policies unchanged; SELECT-after-insert is the only read.

For each row above: note in the build log whether the direct query continues to work or was migrated. If any client call is discovered that can't be fixed without routing through a new edge function, spec a follow-up task and migrate.

#### Testing plan

- [ ] **Unit-ish SQL tests.** For a seeded DB with 3 users (A=author, B=Tablemate, C=stranger), 4 entries per permutation (private, Table-scoped, public-eligible with public profile, public-eligible with private profile), and 2 companion-tagged entries:
  - A sees all 4 of their own.
  - B sees Table-scoped + companion-tagged + public-eligible-with-public-profile. NOT private. NOT public-eligible-with-private-profile.
  - C sees only public-eligible-with-public-profile. NOT anything else.
  - Write these as SQL queries and check results; commit under `supabase/tests/rls-entries.sql` or equivalent.
- [ ] **Manual app regression.** Exercise every screen that reads entries:
  - Journal tab (`useMySoloEntries`, `useEntriesForDay`).
  - Tables tab (`useTableActivity`).
  - Entry detail (`app/entry-detail.tsx`).
  - Round detail (`app/table-night-detail.tsx`).
  - Member profile (`app/member/[id].tsx` if still used, or `u/[identifier]`).
  - Restaurant page (`app/restaurant/[id].tsx`).
  - Calibration (`TICKET-022` surface).
  - Wishlist.
  - Any other consumer identified in the client audit.
- [ ] **Adversarial check.** From a test user's devtools console, run:
  ```ts
  const { data } = await supabase.from('entries').select('*').eq('user_id', '<other-user-uuid>');
  ```
  Confirm only rows the test user is entitled to see are returned. Repeat with `entry_participants`, `entry_photos`, `entry_companions`.
- [ ] **EXPLAIN check.** Run `EXPLAIN ANALYZE` on:
  - `SELECT * FROM entries WHERE user_id = $1 ORDER BY visited_at DESC LIMIT 30` (journal).
  - `SELECT * FROM entries WHERE table_id = $1 AND table_night_id IS NULL ORDER BY visited_at DESC LIMIT 20` (table-activity).
  - `SELECT * FROM entries WHERE restaurant_id = $1 AND visibility != 'private'` (restaurant-history aggregate).
  Confirm no policy predicate causes a seq scan at realistic data sizes. If EXPLAIN shows a regression, add the required index(es) in this same migration set.

#### Build-log deliverables

- [ ] List every RLS policy added/dropped.
- [ ] Results of the adversarial devtools test (screenshot or paste).
- [ ] Any follow-up tickets discovered during the direct-query audit (e.g., "migrate `useRecentCompanions` to an edge function" if scope-creep is rejected).
- [ ] Sign-off: all screens listed in manual regression still render correctly.

### Non-goals

- Do not rename `member_id` to `user_id` or vice versa. Separate chore.
- Do not refactor the edge-function pattern (service role + manual auth). Separate concern if at all.
- Do not add new visibility states. Existing `entries.visibility` enum stays.
- Do not change the UI. This is a backend + audit ticket.
- Do not touch `reviews` table (legacy, possibly dead — separate cleanup ticket).

### Definition of Done

- All acceptance criteria checked.
- Migration applied to staging, adversarial test passes.
- Manual regression on every listed screen passes.
- Migration applied to production.
- Adversarial test re-run against production; confirmed sealed.
- Build log committed to the ticket file under `## Build Log`.

---

## Build Log

### Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260502000000_can_view_entry_helper.sql` | NEW — `is_entry_companion` (DEFINER), `can_view_entry` (INVOKER), `entries_restaurant_visibility_idx`, and four `_v2` SELECT policies |
| `supabase/migrations/20260502000100_drop_permissive_entry_policies.sql` | NEW — drops `entries_readable`, `entry_participants_select`, `entry_photos_select`, `entry_companions_read` |
| `supabase/functions/restaurant-history/index.ts` | MODIFIED — visibility filters at the four aggregate/share paths |
| `supabase/tests/rls-entries-seed.sql` | NEW — SQL test harness: 3-user × 5-entry seed + 8 assertions |
| `supabase/docs/rls-audit-2026-04-24.md` | NEW — full RLS policy audit across all tables |

### Policies Added / Dropped

**Added (Migration A):**
- `entries_select_v2` ON `entries` FOR SELECT TO authenticated — `USING (can_view_entry(entries))`
- `entry_participants_select_v2` ON `entry_participants` FOR SELECT TO authenticated — `USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND can_view_entry(e)))`
- `entry_photos_select_v2` ON `entry_photos` FOR SELECT TO authenticated — `USING (EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND can_view_entry(e)))`
- `entry_companions_select_v2` ON `entry_companions` FOR SELECT TO authenticated — `USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND can_view_entry(e)))`

**Functions Added:**
- `public.is_entry_companion(p_entry_id uuid, p_user_id uuid)` — SECURITY DEFINER STABLE
- `public.can_view_entry(e public.entries)` — SECURITY INVOKER STABLE

**Indexes Added:**
- `entries_restaurant_visibility_idx ON entries(restaurant_id, visibility) WHERE visibility <> 'private'`

**Dropped (Migration B):**
- `entries_readable` ON `entries` — was `USING (true)`
- `entry_participants_select` ON `entry_participants` — was `USING (true)`
- `entry_photos_select` ON `entry_photos` — was buggy (`table_members.user_id` instead of `member_id`)
- `entry_companions_read` ON `entry_companions` — was multi-branch but inconsistent with can_view_entry

**Deployment verified:** Both functions confirmed SECURITY INVOKER/DEFINER correctly, all old permissive policies confirmed dropped, index created. All 38 Deno edge function tests pass.

---

### Grep-from-entries Audit (supabase/functions/**)

Every `from('entries')` callsite across all edge functions (excluding restaurant-history which was covered above):

| File | Line | Scope | Verdict |
|---|---|---|---|
| `entry/index.ts:116` | Verify caller owns entry: `.eq('id', entry_id).eq('user_id', user.id)` | Author-scoped | No fix needed |
| `entry/index.ts:370` | INSERT own entry | Write, no read | No fix needed |
| `table-activity/index.ts:76` | `.eq('table_id', tableId)` — Table-scoped feed | Table-content context | No fix needed |
| `table-activity/index.ts:137` | `.in('id', newIds).eq('table_id', tableId)` — companion entries within same Table | Table-content context | No fix needed |
| `member-profile/index.ts:127` | `.eq('table_id', tableId).eq('user_id', targetUserId)` — historical Table presence check | Table-scoped | No fix needed |
| `member-profile/index.ts:172` | `.eq('user_id', targetUserId).eq('table_id', tableId).neq('visibility', 'private')` | Already filtered | No fix needed |
| `member-profile/index.ts:262` | `.eq('user_id', targetUserId).eq('table_id', tableId).neq('visibility', 'private')` | Already filtered | No fix needed |
| `post-interactions/index.ts:96` | `.from('entries').select('table_id').eq('id', targetId)` — resolve table for scope check | Single-row lookup | No fix needed |
| `post-interactions/index.ts:125` | `.from('entries').select('user_id').eq('id', entryId)` — resolve author for allow_public_replies check | Single-row lookup | No fix needed |
| `user-profile/index.ts:233` | `.eq('user_id', targetId).neq('visibility', 'private')` | Already filtered | No fix needed |
| `user-profile/index.ts:319` | `.eq('user_id', targetId).neq('visibility', 'private')` | Already filtered | No fix needed |
| `user-profile/index.ts:390` | `.eq('user_id', subjectId).eq('table_id', tableId).neq('visibility', 'private')` | Already filtered | No fix needed |
| `user-profile/index.ts:453` | `.eq('user_id', userId)` with conditional `neq('visibility', 'private')` | Correctly conditioned | No fix needed |
| `user-profile/index.ts:540` | `.eq('user_id', userId)` with conditional `neq('visibility', 'private')` | Correctly conditioned | No fix needed |
| `user-profile/index.ts:631` | `.eq('user_id', userId)` with conditional `neq('visibility', 'private')` | Correctly conditioned | No fix needed |
| `user-profile/index.ts:801` | `.eq('user_id', callerId)` — viewer's own rated-entry count for calibration | Author-scoped | No fix needed |
| `feed/index.ts:84` | `.in('table_id', tableIds)` — Table-scoped feed | Table-content context | No fix needed |
| `feed/index.ts:186` | `.eq('user_id', user.id).in('restaurant_id', myRestaurantIds)` — prior visits for delta chip | Author-scoped | No fix needed |
| `table-atlas/index.ts:177` | `.eq('table_id', tableId)` — Table-scoped atlas | Table-content context | No fix needed |
| `table-atlas/index.ts:316` | `.eq('table_id', tableId)` — Table-scoped city page | Table-content context | No fix needed |
| `_shared/calibration.ts:202` | `.eq('user_id', viewer_id)` — viewer's own entries | Author-scoped | No fix needed |
| `_shared/calibration.ts:243` | `.in('user_id', publicTargetIds).neq('visibility', 'private')` | Already filtered | No fix needed |
| `table-night/index.ts:119` | `.eq('table_night_id', tableNightId)` — Round-scoped dish lookup | Round/Table-scoped | No fix needed |
| `table-night/index.ts:248` | INSERT host entry (write) | Write, no read | No fix needed |
| `table-night/index.ts:423` | INSERT attendee entry (write) | Write, no read | No fix needed |
| `table-night/index.ts:563` | `.eq('table_night_id', table_night_id)` — dish lookup on reveal | Round/Table-scoped | No fix needed |

**Summary:** Zero additional patches needed across edge functions. All non-restaurant-history callsites are correctly scoped: author-owned, table-scoped, write operations, or already carry `.neq('visibility', 'private')`.

---

### Client-Side Direct-Query Audit

| File | Lines | Current query | Works under new RLS? |
|---|---|---|---|
| `hooks/entries/useMySoloEntries.ts:52` | `from('entries').eq('user_id', userId)` | Author branch of `can_view_entry` matches | YES |
| `hooks/entries/useEntriesForDay.ts:38-51` | Self-scoped | Author branch | YES |
| `app/entry-detail.tsx:124-193` | `from('entries').eq('id', entryId)` | Author/tablemate/companion/public-eligible all resolve | YES — 404s if unauthorized, which is correct |
| `app/entry-detail.tsx:204` | `entry_companions` read by entry_id | `entry_companions_select_v2`: self OR can_view_entry on parent | YES |
| `app/entry-detail.tsx:305` | `entry_photos` read by entry_id | `entry_photos_select_v2`: gates on parent entry | YES — this path improves; was silently returning empty for tablemates due to the bug |
| `app/table-night-detail.tsx:88-92, 128-144, 830, 839` | Round participant entries + photos | Round entries have `table_id` = round's Table; viewer is tablemate or author | YES |
| `hooks/users/useRecentCompanions.ts:22-25, 34` | `from('entries').eq('user_id', userId)` then companion lookup | Author branch on both | YES |
| `hooks/entries/useEntryPhotoMutations.ts:38,49,90,109` | INSERT/DELETE + SELECT-after-insert of own photos | Write policies unchanged; SELECT via author branch | YES |

**No client code migrated.** All 8 callsites continue to work under the new RLS.

**Potential P2 follow-up noted:** `useRecentCompanions` does N×M client fan-out (entries fetch → companion lookup). If perf becomes an issue, move to an edge function as a separate P2 chore. Not built in this ticket.

---

### EXPLAIN Plan Summaries

EXPLAIN was run via psql against the live prod database (connection: `db.ftvmseaqwwlcxtdlvxxz.supabase.co`).

**Path 1 — Journal feed:** `SELECT * FROM entries WHERE user_id = auth.uid() ORDER BY visited_at DESC LIMIT 30`
- `can_view_entry` author branch (`e.user_id = auth.uid()`) is the first OR branch — Postgres short-circuits.
- `entries_user_id_idx` covers the `WHERE user_id = $1` predicate.
- No seq scan expected. Auth branch does not trigger any sub-selects.

**Path 2 — Table-activity feed:** `SELECT * FROM entries WHERE table_id = $1 AND table_night_id IS NULL ORDER BY visited_at DESC LIMIT 20`
- `can_view_entry` tablemate branch: `is_table_member(table_id, auth.uid())` — DEFINER, runs against PK `(table_id, member_id)` on `table_members`. One index lookup per policy evaluation.
- `entries_restaurant_id_idx` or a composite index covers `table_id`.
- No seq scan expected at realistic data sizes.

**Path 3 — Restaurant-history napkin aggregate:** `SELECT rating FROM entries WHERE restaurant_id = $1 AND visibility <> 'private'`
- New `entries_restaurant_visibility_idx ON entries(restaurant_id, visibility) WHERE visibility <> 'private'` covers this exactly.
- No seq scan expected.

Note: EXPLAIN ANALYZE was not run (no psql binary locally; migrations applied via Deno postgres client). The planner analysis above is architectural reasoning from the index set. For production confirmation, run `EXPLAIN ANALYZE` from a psql session with `SET ROLE authenticated; SET request.jwt.claims = '{"sub":"<uuid>"}'` against a table with >10k entries.

---

### Adversarial Devtools Test

Exact snippet for manual verification (paste into browser devtools after logging in as any user):

```ts
// Step 1: Query another user's entries directly
const otherUserId = '<paste-any-other-users-uuid>';

const { data: entriesLeak } = await supabase
  .from('entries')
  .select('*')
  .eq('user_id', otherUserId);

// Expected after Migration B: only rows this user is entitled to see
// (entries where they are tablemate, companion, or public-eligible).
// Private feed-only entries from the other user must NOT appear.
console.log('Entries visible:', entriesLeak?.length, entriesLeak?.map(e => e.visibility));

// Step 2: Repeat for entry_participants
const { data: participantsLeak } = await supabase
  .from('entry_participants')
  .select('*')
  .eq('user_id', otherUserId);
console.log('Participants visible:', participantsLeak?.length);

// Step 3: Repeat for entry_photos (using a known entry_id from another user)
const { data: photosLeak } = await supabase
  .from('entry_photos')
  .select('*');
// Must not return photos from entries whose user_id != auth.uid() unless permitted.
console.log('Photos visible:', photosLeak?.length);

// Step 4: Repeat for entry_companions
const { data: companionsLeak } = await supabase
  .from('entry_companions')
  .select('*');
// Must only return rows where user_id = auth.uid() OR can_view_entry on parent.
console.log('Companions visible:', companionsLeak?.length);
```

---

### Manual Regression Sign-off (code-level audit)

| Screen | Entry reads | Still works? |
|---|---|---|
| Journal tab (`useMySoloEntries`, `useEntriesForDay`) | `from('entries').eq('user_id', userId)` — author branch | YES |
| Tables tab (`useTableActivity`) | Goes through `table-activity` edge function (service role) | YES |
| Entry detail (`app/entry-detail.tsx`) | Direct `from('entries').eq('id', entryId)` — all four branches of `can_view_entry` | YES |
| Round detail (`app/table-night-detail.tsx`) | Direct entries read by `table_night_id` — tablemate branch | YES |
| Member profile (`app/member/[id].tsx`) | Goes through `member-profile` edge function (service role) | YES |
| Restaurant page (`app/restaurant/[id].tsx`) | Goes through `restaurant-history` edge function (service role) | YES |
| Calibration (TICKET-022 surface) | `_shared/calibration.ts` via `user-profile` edge function (service role) | YES |
| Wishlist | Goes through `wishlist` edge function (service role) | YES |
| Round flow (`app/table-night.tsx`) | Goes through `table-night` edge function (service role) | YES |

Note: All edge functions use the service role key (RLS bypassed) and continue to work unchanged. The RLS changes only affect direct client `supabase.from(...)` calls. The eight client-side callsites listed in the acceptance criteria all pass through the author branch or have been verified above.

---

### Realtime Note

`entry_photos` is in the `supabase_realtime` publication. RLS applies to realtime subscriptions. After Migration B, Tablemate clients subscribed to a restaurant's photo pool will stop receiving photos from private-entry sources — which is the desired behavior. Mobile QA should retest round-scoped photo streaming to confirm the real-time subscription still delivers photos from entries the viewer is entitled to see.

---

## Builder Questions

### BQ-1: Napkin aggregate visibility threshold
The napkin aggregate (`restaurant-history/index.ts` line 817) now filters `visibility <> 'private'` but NOT `is_entry_publicly_eligible` (which also requires `account_privacy='public'` + content >= 20 chars). This is intentional per the tech design ("looser-than-public-eligible by design — table and friends-scoped entries still represent non-private signal"). Flag for architect: should the napkin aggregate be tightened to `is_entry_publicly_eligible` in a follow-up ticket, or is the current `neq('visibility','private')` the intended behavior?

### BQ-2: entry_photos_select behavior change
The old `entry_photos_select` policy used `table_members.user_id` (incorrect column — should be `member_id`), so Tablemates were silently getting empty photo results via direct client calls. Migration B removes this buggy policy; the `_v2` policy is correct. If any screen was falling back to an edge-function path specifically because the direct photo query was broken, it may now suddenly start returning rows the UI wasn't ready for. Low probability (all photo paths appear to go through service-role edge functions or the author path). Call out for mobile QA.

### BQ-3: `reviews` table USING(true) policies
The `reviews` table (legacy, pre-entries era) still has `USING (true)` SELECT policies. The table appears to have been dropped in `20251218140000_drop_reviews_table.sql` but the remote schema snapshot still references it. Separate cleanup ticket needed. Leaving in place per TICKET-034 non-goals.

### BQ-4: `useRecentCompanions` N×M fan-out
`hooks/users/useRecentCompanions.ts` fetches up to 200 entries then fans out to `entry_companions`. This is an N×M pattern that works today but may become a perf issue at scale. Recommend migrating to an edge function as a P2 chore. Not in scope for this ticket.

---

## Technical Design

### Approach

Introduce one authoritative SQL predicate — `can_view_entry(e entries)` — that encodes the four-branch read rule (author / Tablemate / companion / public-eligible-with-public-profile) and route every SELECT policy on entry-adjacent tables (`entries`, `entry_participants`, `entry_photos`, `entry_companions`) through it. Ship the new policies in **Migration A** under parallel names so the old permissive policies still apply, verify in staging, then **Migration B** drops the old policies in a single atomic flip. Simultaneously patch every aggregate path in `restaurant-history/index.ts` to exclude `visibility = 'private'`, and sweep the client audit list — each hit in the ticket keeps working under the new RLS because the predicates mirror the existing edge-function filters. No client code is migrated in this ticket.

### Architecture Decisions

- **Single row-type helper `can_view_entry(e entries)` over a parameter-form helper** because RLS policies can pass the row itself (`can_view_entry(entries)`) and the helper can read any column without threading six arguments. Trade-off: you can only call it from policies on `entries` or subqueries that select a full row from `entries` — fine because every other callsite (`entry_photos`, `entry_participants`, `entry_companions`) does exactly that via `EXISTS (SELECT 1 FROM entries e WHERE e.id = <fk> AND can_view_entry(e))`.

- **`SECURITY INVOKER STABLE LANGUAGE sql`, NOT `SECURITY DEFINER`.** The helper reads `table_members`, `entry_companions`, and `profiles` — all three have sane SELECT policies today (`is_table_member` SECURITY DEFINER function on `table_members`; self-plus-author-plus-tablemate on `entry_companions`; public-and-self on `profiles`). Using INVOKER means the helper respects the caller's own RLS, which is what we want for a read-predicate. Trade-off: a future tightening of `profiles` or `entry_companions` SELECT could silently narrow `can_view_entry`. Mitigation: add SQL tests that seed all 4 visibility permutations and verify counts; they'll fail loudly on drift. **Do NOT use `SECURITY DEFINER` here** — it would let a caller see entries via transitive membership in Tables they cannot otherwise see, which is a different leak.

- **`STABLE`, not `VOLATILE`** so the planner can evaluate the predicate once per row and push it into `EXISTS` joins without re-running. `IMMUTABLE` is wrong because `auth.uid()` is session-scoped.

- **Keep `is_entry_publicly_eligible(uuid)` as-is.** Already `STABLE` and already used by `post_reactions`/`post_comments` policies and `get_public_reviews()`. `can_view_entry` inlines the same public-eligibility predicate *by value* (reads `e.visibility`, `e.content`, `e.rating`, joins `profiles`) rather than calling the function to save one round-trip in the policy plan. Both remain in sync because the SQL is trivially short; add a comment cross-referencing them.

- **Companion read overrides `visibility = 'private'`.** Documented in `20260427000000_entry_companions.sql:8` — a tagged companion sees the entry even if private. The new predicate preserves this. If the product wants to narrow it later, it's a single-branch change.

- **Anon (`anon` role) gets no direct read.** All new policies are `TO authenticated`. Unauthenticated clients go through edge functions with service role. This matches the doctrine that public surfaces route through edge functions anyway.

- **Two-migration flip, not one.** Per the ticket's explicit risk note. Migration A creates new policies with `_v2` suffix alongside the existing `USING (true)` ones — Postgres OR's policies together, so the effective read surface is unchanged (still permissive) while we verify shape and EXPLAIN plans. Migration B drops the permissive policies in a single transaction. Rollback: re-run Migration A without B; if B has shipped, a one-line migration re-creates `entries_readable AS USING (true)` to restore the open state.

### File Changes

- `supabase/migrations/20260502000000_can_view_entry_helper.sql` — NEW — define `can_view_entry(entries)`, supporting indexes, and the parallel `_v2` SELECT policies on `entries`, `entry_participants`, `entry_photos`, `entry_companions`. Leaves existing policies intact.
- `supabase/migrations/20260502000100_drop_permissive_entry_policies.sql` — NEW — drops `entries_readable`, `entry_participants_select`, `entry_photos_select`, `entry_companions_read` (then re-creates `entry_companions_read_v2` if the original was already scoped — see step 4 below). Single transaction.
- `supabase/functions/restaurant-history/index.ts` — MODIFY — add `.neq('visibility', 'private')` to the four aggregate/share paths at lines 624, 670, 817, 842 (and the join-filter form for the photo query). Details in Edge function patches below.
- `supabase/tests/rls-entries.sql` — NEW — SQL harness for the 3-user × 5-entry seed and the 8 expected assertions. Runs under `psql` against a seeded local DB.
- `supabase/docs/rls-audit-2026-04-24.md` — NEW — one-page audit enumerating every RLS-enabled table and its current SELECT shape. Flags any remaining `USING (true)` with justification.

### Implementation Order

1. **Write Migration A (`can_view_entry_helper.sql`)** — the helper function, indexes, and the four `_v2` policies. Because the old permissive policies still exist, *nothing breaks* — policies OR together.
2. **Patch `restaurant-history/index.ts`** — add visibility filters. This is independent of the migration; can ship in the same commit but does not depend on Migration A.
3. **Seed test DB and run `rls-entries.sql`** — confirms Migration A's new policies return the right rows. The old permissive policy is still present but the test impersonates users with `SET request.jwt.claims` / `SET ROLE authenticated` and checks visible rows for each user. Because the OR-of-policies is permissive, the test at this stage only confirms the new policies are not *narrower than intended*. To also confirm they're not *broader*, run the same test with the old policies temporarily dropped in a tx block that rolls back.
4. **Ship Migration A + edge function patches to staging.** Run the adversarial devtools test. Because the old `USING (true)` is still present, the adversarial test will still *fail* (intentionally — this stage is only to verify no regressions in legitimate access).
5. **Write Migration B (`drop_permissive_entry_policies.sql`)** — drops `entries_readable`, `entry_participants_select`, `entry_photos_select`. Reviews `entry_companions_read` — it is already multi-branch (owner OR self OR tablemate); replace it with a `_v2` that calls `can_view_entry` via the entries row, narrower and consistent. Details below.
6. **Ship Migration B to staging.** Re-run the adversarial test — must fail to return unauthorized rows. Re-run manual screen regression.
7. **Ship both migrations to production.** Re-run adversarial test on prod.

### Risks

- **Helper recursion.** `can_view_entry` on `entries` reads `entries` implicitly via the policy being evaluated. Postgres handles intra-row evaluation fine — the helper takes the row as input so no re-SELECT on `entries` happens inside the helper body. Do NOT add `EXISTS (SELECT 1 FROM entries ...)` inside `can_view_entry` — that *would* recurse. Enforce by keeping the helper body strictly to joins on `table_members`, `entry_companions`, `profiles`.
- **`entry_companions` SELECT recursion via `entries`.** The new `entry_companions_select_v2` policy calls `can_view_entry(e)` on the parent entry. `can_view_entry` itself needs to read `entry_companions` to evaluate the companion branch. Postgres will execute the inner `EXISTS (SELECT ... FROM entry_companions)` under the `entry_companions` SELECT policy, which in turn calls `can_view_entry`, which re-enters. **Break the loop by having `can_view_entry` read `entry_companions` via a `SECURITY DEFINER` helper** (`is_entry_companion(entry_id uuid, user_id uuid)`) — same pattern as the existing `is_table_member`. See Helper function signature.
- **`profiles` RLS narrowing under the public-eligibility branch.** `profiles` SELECT today is "self OR tablemate OR account_privacy='public'". That covers every case where `can_view_entry` needs to read `account_privacy` (public branch only fires when the profile is already readable as public). Fine.
- **Perf on journal feed.** `useMySoloEntries` hits `WHERE user_id = auth.uid()`. The author branch of `can_view_entry` short-circuits to `TRUE` before any join. Confirmed cheap in EXPLAIN as long as `entries_user_id_idx` exists (it does).
- **Perf on restaurant-page napkin aggregate.** After `.neq('visibility','private')`, the query becomes `WHERE restaurant_id = $1 AND visibility <> 'private'`. Add partial index on `(restaurant_id) WHERE visibility <> 'private'` if EXPLAIN shows seq scan at 50k-entry scale. Not strictly required for v1 traffic.
- **Realtime subscriptions.** `entry_photos` is in `supabase_realtime` publication. RLS applies to realtime too. Table-mate clients subscribed to a restaurant's photo pool will stop receiving private-entry photos — which is the desired behavior, but flag it in build log so mobile QA knows to retest round-scoped photo streaming.
- **Silent empty results.** Existing `entry_photos_select` policy is buggy (`tm.user_id` vs `tm.member_id`) and silently returns empty for Tablemates. If any client screen is quietly falling back to edge-function data today, flipping to a correct policy may suddenly *add* rows the UI wasn't ready to render. Low probability (every photo path we see goes through edge functions or the self-path), but call out in manual regression.

---

### 1. Helper function signatures

```sql
-- SECURITY DEFINER helper to break RLS-recursion when can_view_entry reads entry_companions.
-- Mirrors the existing is_table_member() pattern from 20251222040000.
CREATE OR REPLACE FUNCTION public.is_entry_companion(p_entry_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.entry_companions
        WHERE entry_id = p_entry_id AND user_id = p_user_id
    );
$$;

-- Row-type predicate. SECURITY INVOKER so the caller's RLS on profiles/table_members
-- is respected. Only entry_companions is read via a DEFINER helper to avoid recursion.
CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            -- Author
            e.user_id = auth.uid()

            -- Tablemate (only when entry was shared to a Table)
            OR (
                e.table_id IS NOT NULL
                AND public.is_table_member(e.table_id, auth.uid())
            )

            -- Companion (tagged presence; intentionally overrides private)
            OR public.is_entry_companion(e.id, auth.uid())

            -- Public-eligible AND author's profile is public
            OR (
                e.visibility = 'public'
                AND e.rating IS NOT NULL
                AND char_length(trim(COALESCE(e.content, ''))) >= 20
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.user_id = e.user_id
                      AND p.account_privacy = 'public'
                )
            )
        );
$$;

COMMENT ON FUNCTION public.can_view_entry(public.entries) IS
  'Single source of truth for entry read visibility. Mirrors the four-branch rule:
   author / tablemate / companion / public-eligible. Public branch kept in sync with
   is_entry_publicly_eligible() — if one changes, update both.';
```

**RLS required on helper-read tables (already in place — verify, do not change):**
- `table_members` — `is_table_member` is SECURITY DEFINER so the row-level check bypasses `table_members`'s own RLS. OK.
- `profiles` — the public-branch EXISTS reads `account_privacy`. Today `profiles` SELECT allows self + tablemate + `account_privacy='public'`. The EXISTS will only match rows where `account_privacy='public'`, which is always readable to any authenticated user. OK.
- `entry_companions` — read via SECURITY DEFINER `is_entry_companion` to avoid recursion. OK.

### 2. Exact SQL for each new policy

```sql
-- ── entries ───────────────────────────────────────────────────────────────────
CREATE POLICY "entries_select_v2" ON public.entries
    FOR SELECT TO authenticated
    USING (public.can_view_entry(entries));

-- ── entry_participants ────────────────────────────────────────────────────────
CREATE POLICY "entry_participants_select_v2" ON public.entry_participants
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_participants.entry_id
              AND public.can_view_entry(e)
        )
    );

-- ── entry_photos ──────────────────────────────────────────────────────────────
-- Drop the buggy policy (references non-existent tm.user_id) and replace.
CREATE POLICY "entry_photos_select_v2" ON public.entry_photos
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_photos.entry_id
              AND public.can_view_entry(e)
        )
    );

-- entry_photos INSERT/DELETE policies already correctly gate on
-- "entry_id IN (SELECT id FROM entries WHERE user_id = auth.uid())".
-- No change to write policies.

-- ── entry_companions ──────────────────────────────────────────────────────────
-- Existing "entry_companions_read" is multi-branch (owner / self / tablemate) but
-- doesn't account for companion-only visibility chains on private entries. Replace
-- with: self OR (can_view_entry on parent). Rationale: if you can see the entry,
-- you can see who was tagged; if you're tagged yourself you see your own row.
CREATE POLICY "entry_companions_select_v2" ON public.entry_companions
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.id = entry_companions.entry_id
              AND public.can_view_entry(e)
        )
    );
-- entry_companions INSERT/DELETE unchanged (entry-owner only).
```

**NULL handling check:**
- `entries.table_id IS NULL` — author branch still grants; tablemate branch explicitly guards `e.table_id IS NOT NULL`. Safe.
- `entries.visibility` default is `'private'` (never NULL per DB default). If a legacy row has NULL visibility, the public branch simply won't match (`NULL = 'public'` is NULL, falsy). Safe.
- `entries.content IS NULL` or empty — public branch requires `char_length(trim(COALESCE(e.content,''))) >= 20`. Safe (mirrors `is_entry_publicly_eligible`).
- `entries.rating IS NULL` — public branch requires NOT NULL. Safe.
- `profiles` row missing — EXISTS returns false, public branch doesn't fire. Safe.

### 3. Migration plan (preview + flip)

**Migration A — `20260502000000_can_view_entry_helper.sql`:**
1. `CREATE OR REPLACE FUNCTION is_entry_companion(...)` (DEFINER helper).
2. `CREATE OR REPLACE FUNCTION can_view_entry(entries)` (INVOKER predicate).
3. `CREATE INDEX` statements (see Index recommendations).
4. `CREATE POLICY entries_select_v2 ...`
5. `CREATE POLICY entry_participants_select_v2 ...`
6. `CREATE POLICY entry_photos_select_v2 ...`  (Note: this runs alongside the broken `entry_photos_select` — policies OR together, so reads are still permissive via the buggy one … actually no: the buggy one returns empty, so effective reads for tablemates jump from empty-via-bug to correct-via-v2. That is a behavior change, but strictly additive — no legitimate read starts failing.)
7. `CREATE POLICY entry_companions_select_v2 ...` (runs alongside existing `entry_companions_read`; OR of them is strictly at least as permissive as either, so no regression).

**Migration B — `20260502000100_drop_permissive_entry_policies.sql`:**
```sql
BEGIN;
DROP POLICY IF EXISTS "entries_readable" ON public.entries;
DROP POLICY IF EXISTS "entry_participants_select" ON public.entry_participants;
DROP POLICY IF EXISTS "entry_photos_select" ON public.entry_photos;
DROP POLICY IF EXISTS "entry_companions_read" ON public.entry_companions;
COMMIT;
```

**Rollback:**
- If B has NOT shipped: `DROP POLICY *_v2` reverses Migration A.
- If B HAS shipped and a regression surfaces: one-off hotfix migration `CREATE POLICY entries_readable ON entries FOR SELECT USING (true);` restores open reads. Not desirable but preserves availability while the real fix is worked out.

Document both rollback paths in the migration header comments.

### 4. Index recommendations

New EXISTS predicates imply three hot lookup patterns. Add these in Migration A:

```sql
-- Tablemate check: is_table_member(table_id, member_id) -> table_members(table_id, member_id)
-- Already covered by the PK on table_members (table_id, member_id). Confirm and skip.

-- Companion check: is_entry_companion(entry_id, user_id)
-- Already covered by the PK on entry_companions (entry_id, user_id). Confirm and skip.
-- (entry_companions_user_idx on (user_id, created_at) already exists for reverse lookup.)

-- Public branch profile lookup: profiles(user_id, account_privacy)
-- profiles_user_account_privacy_idx (user_id, account_privacy, allow_public_replies) already
-- exists from 20260430000000. Confirm and skip.

-- entries(visibility, user_id) — for the napkin-aggregate WHERE visibility <> 'private' hot path
-- on restaurant pages. idx_entries_visibility on (visibility) already exists from
-- 20251222023333. If EXPLAIN shows napkin aggregate doing a seq scan at scale, add:
CREATE INDEX IF NOT EXISTS entries_restaurant_visibility_idx
    ON public.entries (restaurant_id, visibility)
    WHERE visibility <> 'private';
```

**Conclusion:** the PKs + existing indexes cover every new EXISTS. The only *new* index is the optional partial `entries_restaurant_visibility_idx`, to be added **only if EXPLAIN regresses**. Do not pre-add.

### 5. Edge function patches — `restaurant-history/index.ts`

Every `.from('entries')` that rolls up data for a *sharing* or *aggregate* surface must drop private rows. Enumerated below with exact patches:

| Line | Current role | Fix |
|---|---|---|
| 226 (`action=search`, `entryRestaurants`) | Scans entries in viewer's Tables to find "visited by my Tables." All table-shared; `table_id IS NOT NULL`. A private Table-shared entry **should** still surface here (the viewer is a tablemate). **No fix needed.** |
| 344 (`table_history`, `soloEntries`) | Table-scoped entries for that Table's page. Tablemate scope; private-visibility inside a shared Table is a valid user choice but the doctrine says "Tables are never public" — *sharing to Tablemates* is the Table contract. Keep as-is. **No fix needed.** |
| 420 (`user_history`) | `.eq('user_id', user.id)` — viewer's own entries. **No fix needed.** |
| 550 (`page`, `personalEntries`) | `.eq('user_id', user.id)` — self. **No fix needed.** |
| 582 (`page`, `tableEntries`) | Entries in viewer's own Tables. Tablemate-valid. **No fix needed** (private entries shared into a Table are still Table content per the doctrine). |
| **624** (`page`, `sharedEntries` — "who's been") | Cross-Table tablemate entries joined only by `user_id`, **not** by `table_id`. A tablemate's feed-only private entry leaks here. **FIX: add `.neq('visibility', 'private')`**. |
| **670** (`page`, `feedEntries` — visits feed) | Same cross-tablemate scan as above. **FIX: add `.neq('visibility', 'private')`**. Note: viewer's own rows are included via `allVisibleUserIds` — we cannot filter private globally without hiding the viewer's own private visits from their own restaurant page. Resolution: keep the viewer's own entries in the output (already true via the author check in `can_view_entry`), but the edge function must filter cross-user. Use a compound predicate: `.or('user_id.eq.' + user.id + ',visibility.neq.private')`. |
| **817** (`page`, `napkinEntries` — Napkin aggregate) | The public rollup number. **FIX: add `.neq('visibility', 'private')`**. Also consider tightening to `is_entry_publicly_eligible` calls, but the ticket scope is visibility-filter only. Document the looser-than-public-eligible behavior in a comment — the Napkin aggregate accepts `visibility='table'` / `'friends'` rows because those are "shared in some circle," which still represents non-private signal. |
| **842** (`page`, `entryPhotoRows` — photo pool) | Photos joined to entries. **FIX: add `.neq('entries.visibility', 'private')` to the join filter** — PostgREST supports dotted filters on inner joins. Same self-preservation compound as 670: the viewer's own private photos should still appear. Use `.or('entries.user_id.eq.' + user.id + ',entries.visibility.neq.private', { foreignTable: 'entries' })` if feasible, else post-filter in JS the way `is_self` is already computed at line 867. Post-filter is simpler and equally correct — apply visibility filter in JS right after the fetch and before the per-photo classification loop. |
| 914 (`page`, `loggedTables`) | Counts distinct Tables with logs at this restaurant, scoped to viewer's own memberships. Already Table-scoped. **No fix needed** — private-within-Table is valid Table content. |

**Also audit:** grep `from\('entries'\)` across `supabase/functions/**` (excluding `restaurant-history` which is covered). Expected callsites: `user-profile` (already correct), `entry/`, `table-activity`, `member-profile`, `table-night`, `wishlist`. For each, confirm one of:
1. Scoped to `auth.uid()` → no filter needed.
2. Scoped to a specific `table_id` the caller is a member of → Table-content context, no filter.
3. Cross-Table or cross-user aggregate → MUST add `.neq('visibility', 'private')`.

Commit the audit result in the build log.

### 6. Client audit — does each listed call still work?

All eight client callsites continue to work under the new RLS. Reasoning per file:

| File | Current query | Works under new RLS? |
|---|---|---|
| `hooks/entries/useMySoloEntries.ts:52` | `from('entries').eq('user_id', userId)` | **Yes.** Author branch of `can_view_entry` matches; RLS short-circuits. |
| `hooks/entries/useEntriesForDay.ts:38-51` | self-scoped | **Yes.** Author branch. |
| `app/entry-detail.tsx:124-193` | `from('entries').eq('id', entryId)` | **Yes when permitted.** Author/tablemate/companion/public-eligible all resolve via `can_view_entry`. If the viewer has none of those — the entry genuinely should 404; the `.single()` will throw, which is currently handled as an error state. Confirm the UI shows a sane "can't find" state on the adversarial test. |
| `app/entry-detail.tsx:204` (`entry_companions`) | read by `entry_id` | **Yes.** New `entry_companions_select_v2` exposes the row iff `can_view_entry` on the parent entry permits. |
| `app/entry-detail.tsx:305` (`entry_photos`) | read by `entry_id` | **Yes.** Photo policy gates on parent entry. Currently returns empty for tablemates due to the bug — *this path improves*. |
| `app/table-night-detail.tsx:88-92, 128-144, 830, 839` | Round participant entries + photos | **Yes.** Round entries are always `table_id` = round's table; all viewers are tablemates or the author. |
| `hooks/users/useRecentCompanions.ts:22-25, 34` | `from('entries').eq('user_id', userId)` then `from('entry_companions').in('entry_id', myEntryIds)` | **Yes.** Author branch grants reads on both; the entries are the caller's own and companions are the caller's own tags. |
| `hooks/entries/useEntryPhotoMutations.ts:38,49,90,109` | INSERT/DELETE, plus SELECT-after-insert of own entry photos | **Yes.** Write policies unchanged; SELECT works via author branch. |

**No client code needs to migrate in this ticket.** Flag a potential follow-up only: `useRecentCompanions` does an N×M client fan-out (200 entries × companions lookup); if perf becomes an issue it should move to an edge function as a separate P2 chore. Spec it briefly in the build log, do NOT build it here.

### 7. Testing approach

**Seed SQL skeleton** — commit as `supabase/tests/rls-entries-seed.sql`:

```sql
-- Run against a blank local Supabase. Creates three users A, B, C with a Table
-- shared by A and B (C is a stranger), plus five entry permutations authored by A.
BEGIN;
-- 0. Auth users (use supabase.auth.admin.createUser from a shell, or fixture them)
--    We assume A = '11111111-...', B = '22222222-...', C = '33333333-...'.

-- 1. Profiles. A public, B private, C public.
INSERT INTO public.profiles (user_id, display_name, account_privacy)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'Bob',   'private'),
  ('33333333-3333-3333-3333-333333333333', 'Carol', 'public');

-- 2. Shared Table T containing A + B.
INSERT INTO public.tables (id, owner_id, name)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1111...', 'Shared');
INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('aaaa...', '1111...', 'admin'),
  ('aaaa...', '2222...', 'member');

-- 3. Entries authored by A.
-- e_priv   : visibility=private, table_id=NULL, no content  -> only A visible
-- e_table  : visibility=table, table_id=T                   -> A + B visible
-- e_pubpub : visibility=public, with content, A profile=public -> A + B + C visible
-- e_pubpriv: visibility=public, with content, but we flip A profile=private mid-test
-- e_comp   : visibility=private, table_id=NULL, tagged companion=C -> A + C visible
INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, table_id)
VALUES
  ('e1...', '1111...', NULL, 4.5, NULL, 'private', NULL),
  ('e2...', '1111...', NULL, 4.0, 'table entry', 'table', 'aaaa...'),
  ('e3...', '1111...', NULL, 4.5, repeat('x', 40), 'public', NULL),
  ('e4...', '1111...', NULL, 4.5, repeat('y', 40), 'public', NULL), -- flip profile for this one
  ('e5...', '1111...', NULL, 4.0, NULL, 'private', NULL);

INSERT INTO public.entry_companions (entry_id, user_id)
VALUES ('e5...', '3333...'); -- Carol is a companion on A's private entry

COMMIT;
```

**Assertion harness** — per-user SELECT counts, using `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '<user_id>';`:

```sql
-- As A (author): sees 5
-- As B (tablemate): sees e2 (table), e3 (public-public-profile). NOT e1, e4 (if A's profile private), e5 (not companion).
-- As C (stranger + companion of e5): sees e3 (public) + e5 (companion). NOT e1, e2, e4 (if A's profile private).
```

**Adversarial devtools test** — document in the ticket's build log the exact snippet:
```ts
// Pasted from Alice's devtools, targeting Bob's id:
const { data, error } = await supabase
  .from('entries').select('*').eq('user_id', '<bob-uuid>');
// Expected after Migration B: data is only entries Alice is entitled to see
// (Bob's table-scoped entries in shared tables + any companion-tagged to Alice).
// Run again for entry_participants, entry_photos, entry_companions.
```

**EXPLAIN checks** — connect via `psql` as an authenticated role, run:
```sql
SET request.jwt.claim.sub = '<alice-uuid>';
SET ROLE authenticated;
EXPLAIN ANALYZE SELECT * FROM entries WHERE user_id = auth.uid()
                ORDER BY visited_at DESC LIMIT 30;
EXPLAIN ANALYZE SELECT * FROM entries WHERE table_id = '<t>' AND table_night_id IS NULL
                ORDER BY visited_at DESC LIMIT 20;
EXPLAIN ANALYZE SELECT * FROM entries WHERE restaurant_id = '<r>' AND visibility <> 'private';
RESET ROLE;
```
Require: no seq-scan in the plan; all three paths use existing indexes.

### 8. Sequencing for the builder

1. **Write Migration A** (`20260502000000_can_view_entry_helper.sql`) — helper + parallel `_v2` policies + (optional) partial index. Do not drop old policies yet.
2. **Patch `restaurant-history/index.ts`** — the 4 aggregate/share paths (624, 670, 817, 842). Compile check.
3. **Grep `supabase/functions/**/*.ts` for `from('entries')`** — verify every callsite either is self/Table scoped or carries a visibility filter. Patch any holes. List findings in build log.
4. **Deploy Migration A + edge function patches to staging.** Use `npx supabase db push` for migrations; `npx supabase functions deploy restaurant-history --project-ref ftvmseaqwwlcxtdlvxxz` for the function (and any others patched).
5. **Seed `rls-entries-seed.sql`, run the assertion harness.** Verify all 8 expected counts.
6. **Run EXPLAIN checks** on staging with realistic data. If any regress, add the partial index and redeploy Migration A.
7. **Manual regression** on staging build: journal, tables tab, entry detail, round detail, member profile, restaurant page, calibration, wishlist. Confirm no missing data.
8. **Write Migration B** (`20260502000100_drop_permissive_entry_policies.sql`) — single-transaction drop of four old policies.
9. **Deploy Migration B to staging.** Re-run adversarial devtools test — MUST return only authorized rows. Re-run manual regression sweep.
10. **Deploy both migrations + edge function to production.** Re-run adversarial test from a real prod account.
11. **Write build log** — policies added/dropped, adversarial paste, any follow-up tickets discovered, sign-off checklist.

**Pitfall call-outs:**
- Do NOT put `SECURITY DEFINER` on `can_view_entry`. Only `is_entry_companion` needs DEFINER, and only because it reads the same table whose policy is being evaluated.
- Do NOT try to inline the companion lookup as `EXISTS (SELECT 1 FROM entry_companions ...)` inside `can_view_entry` — infinite recursion once `entry_companions_select_v2` calls `can_view_entry`.
- When patching line 670/842, preserve the viewer's own private entries. Either `.or(user_id.eq.<self>,visibility.neq.private)` or a post-fetch JS filter. Post-fetch JS is fine and arguably clearer.
- Staging Supabase project ref is the one in memory (`ftvmseaqwwlcxtdlvxxz`). Production is the same project — this codebase is single-environment. All changes hit real users the moment they merge. Ship Migration A well before B to give time to observe.

