---
id: TICKET-095
title: "Gather the table — propose a date from a restaurant, RSVP on the Table feed, auto-dispatch a supper on the day"
priority: high
status: in-progress
created: 2026-07-04
updated: 2026-07-04
tags: [tables, suppers, gatherings, schema, edge, feed]
relates_to: [TICKET-061, TICKET-082]
---

# Gather the table

## Problem

The founder's ask, verbatim energy: *"omg I really really want to try this — can we set a date and gather the table."* Today that impulse dies in the feed — you can share a save or set a table after the fact, but there's no way to point at a restaurant, name a day, and let the Table answer. The moment of enthusiasm has nowhere to land, so the plan evaporates in the group chat instead.

TICKET-061's propose · vote · race scope (multiple contenders, voting, availability) is **superseded by this narrower version**: one restaurant, one date, in/out. No contenders, no voting, no when2meet.

## Product Spec

### User Stories

- As a Table member on a restaurant page, I can propose a future date to one of my Tables ("gather the table"), optionally with a one-line note.
- As a Tablemate, I see the gathering as a card in the Table feed and answer **I'm in** / **can't** — and change my answer any time before the day resolves.
- As the host, I can quietly call the gathering off.
- As the Table, if ≥2 of us are in on (or after) the day, a supper (the existing "empty table" primitive) is created automatically with the confirmed roster — the supper card appearing in the feed IS the dispatch. The gathering card then points to it.
- As someone whose plans fell through, a gathering that never reached 2 quietly reads "didn't come together" once the day passes.

### Acceptance Criteria

- [ ] Restaurant page action dock gains `gather` (calendar-outline, lowercase) next to `set a table`, same gating (persisted restaurant + ≥1 Table + supper curtain off).
- [ ] GatherSheet: restaurant name masthead, table chips only when >1 Table, date row (min tomorrow, max +90 days, HKT-validated server-side), optional note ≤140, CTA `gather the table`.
- [ ] Creating posts a `gathering` card to that Table's feed; the host is auto-RSVP'd 'in'.
- [ ] One active proposal per (table, restaurant) — second attempt gets 409 `ALREADY_PROPOSED` and the sheet alerts "already gathering for this spot."
- [ ] Card (proposed): kicker `GATHERING · <SAT · JUL 12>`, murmur (`— note` or `— <host> wants to gather the table`), restaurant name + city, seats row (in = solid, undecided/out = ghosted, host first), `<n> in` meta.
- [ ] Non-host viewers get `I'm in` / `can't`; after answering, `you're in · change` / `can't make it · change`. RSVP is optimistic with rollback.
- [ ] Host sees `call it off` (Alert-confirmed) instead of the RSVP zone; cancelled cards disappear from the feed (excluded server-side).
- [ ] On/after gather_on, the first feed load dispatches: ≥2 confirmed (in ∩ current members) → supper created (host = gathering host, roster = confirmed only), gathering → `dispatched` with `supper_id`; card shows `gathered — see the table →` → `/supper/[id]`.
- [ ] Day fully passed with <2 in → `expired`, card shows muted `didn't come together`. Day-of with <2 stays `proposed` (RSVPs still open that day).
- [ ] Old clients (no `known_kinds` in the request) never receive `gathering` rows — no junk fallback cards.
- [ ] Card body tap → `/restaurant/[id]`.

## UX Decisions

- **Separate GatherSheet, not a SetTableSheet mode.** Set-a-table is "we ate, add takes"; gather is "we might eat, who's in." Different tense, different sheet. Small local duplication over refactoring SetTableSheet.
- **Roster emerges from RSVPs — no crew picker.** The whole Table is the audience; the confirmed roster is whoever said in. (Contrast: set-a-table picks a crew up front.)
- **Date only, no time-of-day.** v1 answers "which day", not "which hour."
- **Min tomorrow, max +90 days.** A gathering is a future plan; same-day plans are just… dinner.
- **Dispatch-on-read, not cron/push.** Push is deferred by doctrine; the supper card materialising in the feed is the notification. `FOR UPDATE SKIP LOCKED` keeps concurrent feed loads from double-dispatching.
- **HKT hardcoded** (`Asia/Hong_Kong`) — friend-test cohort is HK/Macau; per-table timezones are a later ticket (noted in both the SQL fn and the edge fn).
- **Cancelled rows excluded server-side** (`status <> 'cancelled'` in the RPC) — no tombstone cards.
- **One accent on the card (terracotta)**; seats reuse the supper ghosting treatment (0.34) so "filling up" reads identically across both cards.

## Out of Scope

- Voting / multiple contenders (TICKET-061's old scope)
- Availability matrix / when2meet
- Time-of-day
- Reminders / push notifications
- Editing the date — cancel & re-gather instead
- Reactions / comments on gathering cards
- Calendar export

## Technical Design

### Schema — `supabase/migrations/20260704090000_gatherings.sql`

- `gatherings` (id, table_id→tables CASCADE, restaurant_id→restaurants, host_user_id→profiles, note ≤140, gather_on date, status proposed|dispatched|cancelled|expired, supper_id→suppers SET NULL, timestamps).
- `gathering_rsvps` (gathering_id CASCADE, user_id CASCADE, response in|out, timestamps, PK (gathering_id,user_id)).
- Partial unique index `(table_id, restaurant_id) WHERE status='proposed'` (one active proposal per spot) + dispatch-scan index `(table_id, gather_on) WHERE status='proposed'`.
- RLS: SELECT-only for authenticated via `table_members.member_id` (rsvps join through gatherings). NO client write policies — service-role edge fn is the sole writer (supper_members doctrine). Default grants revoked, SELECT/ALL re-granted per role.
- `fn_dispatch_due_gatherings(p_table_id) returns void`, SECDEF, `search_path=public`, plpgsql loop over due proposed rows `FOR UPDATE SKIP LOCKED`; confirmed = 'in' RSVPs ∩ current `table_members`; ≥2 → insert supper (+ supper_members from confirmed) + mark dispatched; day fully passed + <2 → expired. EXECUTE revoked from PUBLIC/anon/authenticated, granted to service_role.
- `fn_table_activity_page` replaced: verbatim body from `20260620000000_supper_v2_table_scope.sql` (grep-verified as the latest replacement) + `gatherings_stream` (kind 'gathering', sort_date = created_at, payload = anchor fields, `status <> 'cancelled'`, p_filter_type/p_filter_user_id handled like suppers_stream) + its UNION ALL leg. Cursor keyset unchanged (applied in the final unified select).

### Edge — new `supabase/functions/gatherings/index.ts`

table-shares-style (cors/json/err helpers, service-role client, auth.getUser, `{data}`/`{error:{code,message}}` envelope). POST actions:
- `create` — validate UUIDs, membership (member_id), restaurant persisted, gather_on parses + strictly after today (HKT) + ≤90 days, note ≤140. Insert gathering + host auto-RSVP 'in'; delete the gathering if the RSVP insert fails (set-table rollback idiom). 23505 on the partial index → 409 `ALREADY_PROPOSED`. Returns the row inside `data` (sibling fields outside `data` get stripped by callEdgeFn).
- `rsvp` — gathering exists + status proposed (else 409 `GATHERING_CLOSED`), caller is a member of its table, upsert on (gathering_id,user_id). Returns `{gathering_id, response}`.
- `cancel` — host only (403 `NOT_HOST`), proposed only. Sets cancelled. Returns `{cancelled:true}`.

### Edge — `supabase/functions/table-activity/index.ts`

1. First page only (no cursor): `rpc('fn_dispatch_due_gatherings')`, log-and-continue on error (feed never 500s on a dispatch hiccup).
2. `known_kinds` back-compat: optional `known_kinds: string[]` in the body; `LEGACY_KINDS = ['entry','table_night','top_4_edited','shared_save','share_digest','restaurant_float','supper']` (the exact pre-095 RPC kind set). Rows whose kind ∉ (known_kinds ?? LEGACY_KINDS) are dropped AFTER the PAGE_SIZE slice; the cursor is still built from the UNFILTERED kept rows so keyset pagination never skips — old clients just render a shorter page.
3. `gathering` hydration mirroring supper hydration: batch-fetch rsvps, current table roster (`table_members.member_id`), profiles (roster ∪ hosts), restaurants. Card shape: `{type:'gathering', id, sort_date, table_id, restaurant, host_user_id, host_name, note, gather_on, status, supper_id, seats[{user_id, display_name, avatar_url, is_host, response}], in_count, viewer_response, created_at}` — seats = every CURRENT member, ordered host → in → undecided → out. Profiles batch-fetched, never PostgREST-embedded off entries.

### Client

- `useTableActivity`: `GatheringSeat` + `GatheringCardActivity` types, `KNOWN_ACTIVITY_KINDS` sent as `known_kinds`.
- `hooks/gatherings/`: `useCreateGathering` (invalidate `tables.activityForTable(table_id)` — server-assigned keyset position), `useRsvpGathering` (optimistic: cancel → snapshot via getQueriesData → `patchGatheringRsvp` over `{rows}` page envelopes → rollback; no blanket invalidation), `useCancelGathering` (mutate + narrow invalidate). No new queryKeys needed — everything rides the existing table-activity keys.
- `components/gatherings/`: `GatherSheet` (Modal + KeyboardAvoidingView position; local future-facing calendar overlay mirroring CalendarModal), `GatheringCard` (SupperCard structural reference; owns its rsvp/cancel mutations per the RestaurantFloatCard precedent).
- `tables.tsx`: `gathering` branch before the solo fallback + timelineItems curtain (hideSuppers — gatherings terminate in suppers).
- `BottomActionBar` + `restaurant/[id].tsx`: `gather` dock action + GatherSheet, gated exactly like set-a-table.

## Notes / Blast Radius

1. **PostgREST embeds** — no existing embed touches `gatherings`/`gathering_rsvps` (new tables). The new hydration batch-fetches profiles/restaurants (no embeds added). Each new FK targets a distinct table (tables, restaurants, profiles, suppers) from a NEW table, so no existing embed becomes ambiguous — `entries`/`suppers` embeds unchanged, no PGRST201 introduced.
2. **Direct SQL** — `fn_table_activity_page` replaced (base verified: `20260620000000_supper_v2_table_scope.sql` is the last migration touching it; grep over migrations confirms). New `fn_dispatch_due_gatherings`. Exactly one new `.rpc()` call site: table-activity first-page dispatch. No other migration/RPC references the changed objects.
3. **RLS** — new tables: member-SELECT-only (member_id doctrine) + service-role-only writes; default grants revoked. `can_view_entry`, `is_supper_member`, and all supper policies untouched. No policy on an existing table changes.
4. **Edge contracts** — new `gatherings` fn (deploy with the migration). `table-activity` gains optional `known_kinds` (additive; absent → LEGACY_KINDS, so old clients see exactly the pre-095 kind set) and the first-page dispatch call (log-and-continue). Both functions must deploy in the same release as the migration.
5. **Query keys / hooks** — `ActivityItem` union widened with `GatheringCardActivity`; `useTableActivity` request body gains `known_kinds`. New hooks under `hooks/gatherings/`. No new queryKeys (rsvp patches the feed cache in place; create/cancel invalidate `tables.activityForTable(tableId)`).
6. **Optimistic patches** — `patchGatheringRsvp` synthesises `viewer_response`, the viewer's `seats[]` entry, and recomputed `in_count`, matching the hydrated card shape field-for-field (seat ordering left to the next refetch — cosmetic only). Unit-tested against `{rows}` page envelopes (the `page.map` prod-bug class).

---

## Build Log

### Files Changed

- `supabase/migrations/20260704090000_gatherings.sql` — new: gatherings + gathering_rsvps schema, RLS, indexes, `fn_dispatch_due_gatherings`, `fn_table_activity_page` replacement (+gatherings_stream).
- `supabase/functions/gatherings/index.ts` — new edge fn: create / rsvp / cancel.
- `supabase/functions/table-activity/index.ts` — first-page dispatch call, `known_kinds` filter (LEGACY_KINDS default), gathering hydration + orderedItems branch.
- `napkin-app/hooks/tables/useTableActivity.ts` — `GatheringSeat`/`GatheringCardActivity` types, union widened, `KNOWN_ACTIVITY_KINDS` sent in the body.
- `napkin-app/hooks/gatherings/useCreateGathering.ts` — new (+ `isAlreadyProposed`).
- `napkin-app/hooks/gatherings/useRsvpGathering.ts` — new (optimistic; exports `patchGatheringRsvp`).
- `napkin-app/hooks/gatherings/useCancelGathering.ts` — new.
- `napkin-app/hooks/gatherings/index.ts` — new barrel.
- `napkin-app/hooks/gatherings/__tests__/patchGatheringRsvp.test.ts` — new (6 tests).
- `napkin-app/components/gatherings/GatherSheet.tsx` — new.
- `napkin-app/components/gatherings/GatheringCard.tsx` — new.
- `napkin-app/components/gatherings/index.ts` — new barrel.
- `napkin-app/components/restaurants/BottomActionBar.tsx` — `showGather`/`onGatherPress` dock action (calendar-outline, "gather").
- `napkin-app/app/restaurant/[id].tsx` — gather action + GatherSheet, same gate as set-a-table.
- `napkin-app/app/(tabs)/tables.tsx` — `gathering` feed branch (before solo fallback) + timelineItems curtain.
- `.kanban/ready/TICKET-095-gather-the-table.md`, `.kanban/backlog/TICKET-094-search-lists.md` — this ticket + the search-lists thinking ticket.

### Tests

- `bash scripts/check-migration-timestamps.sh` — ✓ unique (110 files).
- `deno check` on `gatherings/index.ts` + `table-activity/index.ts` — ✓ clean.
- `npx tsc --noEmit` — only the 4 known pre-existing errors (CandidatePickerPanel.test.ts ×3, ImportLinkSheetNonce.test.ts ×1). Note: a clean worktree also surfaces a pre-existing `app/_layout.tsx` TS2493 unless `.expo/types/router.d.ts` (generated, gitignored) is present — not introduced by this ticket.
- `npm run lint` — 0 errors, 50 warnings (all pre-existing; new gatherings files are warning-free).
- `npm test` — 353/353 pass across 30 suites, including the new `patchGatheringRsvp` suite (6 tests: patch fields, in→out decrement, other-row identity, multi-page walk, undefined/no-pages no-op, rows-less page tolerance).

### Builder Questions

- `in_count` counts 'in' RSVPs **from current members only** (the seats list) so the number a member sees always equals what dispatch would count. An ex-member's stale 'in' is invisible. Flagging as a deliberate interpretation of "`<n> in`".
- The host keeps `call it off` as their only control (host is auto-'in' and cannot RSVP 'out'); a host who can't make their own gathering cancels it. If hosts should be able to flip to 'out' while keeping the proposal alive, that's a small follow-up.
- Dispatched supper's `host_user_id` = the gathering host even if the host wasn't 'in' by dispatch time (spec-as-written; `is_supper_member` treats the host as a member either way, so they can still see it).

---

## Review History

### Review 1 — code-reviewer (cold, vs acceptance criteria)
```
Date: 2026-07-04
Verdict: PASS-WITH-NITS
Score: 11/11 acceptance criteria PASS · 0 P0 · 0 P1 · 2 P2
```
- fn_table_activity_page replacement mechanically diffed against 20260620000000 base: additive only (gatherings_stream CTE + UNION leg). RLS/grants/optimistic-patch/design-compliance all PASS.
- P2 nits: gatherings not in smoke list (deliberate — list additions are postmortem-driven and CI smoke lacks secrets); GatherSheet is light-scheme like sibling sheets.

### Review 2 — adversarial landmine pass (Codex slot; Codex CLI broken on this machine, substituted with an independent Claude pass)
```
Date: 2026-07-04
Verdict: PASS-WITH-NITS
Score: 0 P0 · 2 P1 (1 new, 1 pre-existing) · 7 P2
```
- Cleared under attack: double-dispatch (FOR UPDATE SKIP LOCKED + EvalPlanQual), privilege model (member_id everywhere, service-role-only writes, SECDEF search_path pinned), feed-cannot-500-from-dispatch, HKT boundary math, old-client + auto-revert safety, cache patch coverage across filter variants, no broken callers.

### Post-review fixes (applied by orchestrator, same branch)
- **P1-1 fixed** — GatheringCard: `gathered — see the table →` now only for host / viewers with response `'in'`; everyone else gets a muted `gathered` (the supper roster is confirmed-only; supper-detail 404s non-members).
- **P1-2 fixed** — table-activity `next_cursor` was ALWAYS null (pre-existing on main since TICKET-035: `buildPage(keptRpc…)` on a pre-sliced array → internal has_more always false → Table feed silently hard-capped at 20 items). Fixed by passing the unsliced `pageRows`. Bundled here because this release redeploys table-activity anyway and the known_kinds back-compat story assumes working pagination.
- **P2-1 fixed** — gatherings `cancel` now checks affected rows; a cancel racing dispatch returns 409 GATHERING_CLOSED instead of false success.

### Known/deferred (documented, not fixed)
- RSVP-vs-dispatch TOCTOU: a stale 'in' racing dispatch shows in seats but not the supper roster — cosmetic, self-heals on refetch.
- Dispatch loop is all-or-nothing per table (no per-gathering subtransaction); no poison row exists today, revisit if suppers gains NOT-NULL columns.
- Deleted supper leaves a dispatched card whose link no-ops (supper_id → NULL) — fold into the supper-delete ticket (TICKET-096 candidate).
- Client min-date is device-local tomorrow vs server HKT — accepted for the HK/Macau cohort; failure copy is generic.
