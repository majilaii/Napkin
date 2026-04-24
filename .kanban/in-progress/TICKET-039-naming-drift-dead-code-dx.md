---
id: TICKET-039
title: "Cleanup — naming drift, dead code, query-key registry, shared invoke helper"
priority: medium
status: in-progress
created: 2026-04-24
updated: 2026-04-24
tags: [cleanup, dx, refactor]
---

# Cleanup — naming drift, dead code, query-key registry, shared invoke helper

## Problem

Bug patrol (2026-04-24) surfaced a cluster of consistency/DX debt that isn't individually critical but together slows every new feature and creates the next generation of bugs.

### Findings covered

- **P2-1 — dead code.**
  - `napkin-app/hooks/tables/useTableNight.ts:113-125` — `useStartTableNight` signature doesn't match edge function shape; would 400 if called. No callers.
  - `napkin-app/hooks/tables/useSubmitTake.ts` — duplicate of `useRateTableNight`. No callers.
  - `supabase/functions/table-members/` — entire function not referenced by any hook. App uses `table-management?action=add_member`.
  - `supabase/functions/table-management/index.ts:44, 122` — fragile path parsing (`url.pathname.split('/').pop()`). For `table-management?action=...` returns `"table-management"`; for `table-management/UUID` returns the UUID.
  - `napkin-app/hooks/feed/townMock.ts` — mock data file, unclear if imported.

- **P2-4 — `member_id` vs `user_id` naming drift.**
  - `table_members.member_id` (all other tables: `user_id`).
  - Caused TICKET-034's P0-2 (broken `entry_photos` RLS).
  - Causes repeated human errors when writing RLS, joins, or edge functions.

- **P2-5 — `table_night` vs `round` drift.**
  - DB: `table_nights`, `table_night_participants`, `table_night_id`.
  - Edge function path: `table-night/`, actions `start`, `rate`.
  - Hooks: `useTableNight`, `useRateTableNight`, `useStartRound` (renamed), `useSubmitTake` (dead), `useAddTake` (live).
  - UI copy: "Round".
  - `CLAUDE.md` declares the alias but the inconsistency still trips up every new contributor.

- **P2-6 — query key literals drift from the central registry.**
  - `lib/queryKeys.ts` exists but hooks also use literals like `['atlas']`, `['feed']`, `['tableActivity']`, `['users', 'search']`, `['users', 'profile']`, `['users', 'following']`, `['users', 'followList']` for prefix-match invalidations.
  - If a key helper changes, literals don't.

- **P2-7 + P1-12 — invoke helper drift.**
  - Half the hooks use `supabase.functions.invoke`, half use raw `fetch()`. Raw `fetch()` is used for GET-with-query-params (invoke is POST-only by default).
  - Half the hooks explicitly pass `Authorization: Bearer <token>`; half don't (invoke auto-attaches).
  - Two different error shapes to unwrap.
  - Every hook reimplementing JSON parsing, error propagation, session resolution.

- **P2-22 — `hooks/feed/townMock.ts` potentially orphaned.**

## Notes

### Design decisions

- **Dead code: delete, don't deprecate.** If a file has no callers, it goes. Do not soften with "keep in case we need it."
- **`member_id` kept; alias documented.** Renaming `table_members.member_id` → `user_id` is a major schema change with every RLS policy affected. Instead: (a) document the exception in `CLAUDE.md`, (b) create a SQL view `v_table_members_compat` that aliases `member_id AS user_id` for read paths, (c) in new RLS policies use the helper function pattern (see TICKET-034's `can_view_entry`) to avoid hand-writing `tm.xxx_id` every time.
- **`table_night` kept; alias doctrine documented.** Renaming `table_nights` → `rounds` is also a major migration that would break every migration file and a lot of hook names. Instead: make CLAUDE.md's existing note more prominent; delete the dead `useSubmitTake` / `useStartTableNight` to reduce surface area; keep edge function paths as-is; rename client hooks to match UI language (`useRateTableNight` → `useRateRound`, `useStartTableNight` → `useStartRound` done) over time through mechanical refactors.
- **Query key registry: enforce prefix-helpers.** Every invalidation prefix becomes a function in `queryKeys.ts`: e.g., `queryKeys.users.profileAll = () => ['users', 'profile'] as const`, and `queryKeys.users.profile = (id: string) => [...queryKeys.users.profileAll(), id] as const`. Grep the codebase; every literal becomes a call.
- **Shared `callEdgeFn` helper.** `napkin-app/lib/edgeInvoke.ts::callEdgeFn(name, { action?, method?, params?, body?, signal? })` — wraps `fetch()` for GETs and `supabase.functions.invoke` for POSTs, auto-attaches session, returns `{ data, error }` unified shape. Used by every hook. The error side feeds the `unwrapInvokeError` from TICKET-037.
- **Lint rule (optional).** ESLint custom rule or a grep assertion: flag any direct `supabase.functions.invoke` or raw `fetch` to an edge function URL outside `edgeInvoke.ts`. Enforces the pattern.

### Dependencies

- TICKET-037 lands `unwrapInvokeError`. This ticket builds `callEdgeFn` on top, and migrates every hook.
- TICKET-036 introduces `client_nonce` on entries and wants to use the registry keys. Compatible.

### Risk

- Low-medium. Mechanical refactors; the risk is a missed callsite. Grep exhaustively, run `tsc --noEmit` after each file migration, and exercise every screen.

---

## Product Spec

### User Stories

- As a **developer adding a feature**, I want one obvious way to call an edge function and one obvious query-key helper, so I don't reinvent the wheel and introduce the next drift bug.
- As a **reader of the codebase**, I want to not trip on `member_id` vs `user_id` vs `table_night` vs `round` every time I write a join.

### Acceptance Criteria

#### Dead code purge

- [ ] Delete `napkin-app/hooks/tables/useSubmitTake.ts`. Grep for imports; confirm zero.
- [ ] Delete `useStartTableNight` from `useTableNight.ts:113-125`. Grep for imports; confirm zero.
- [ ] Delete `supabase/functions/table-members/` entirely. Confirm no hook invokes it. Update `supabase/config.toml` if the function is listed there.
- [ ] `napkin-app/hooks/feed/townMock.ts` — grep for imports. If zero, delete. If some, note them and separate-ticket a real-data migration.
- [ ] Clean up `table-management/index.ts:44, 122` path parsing — standardize on `?action=` query-param routing (consistent with the rest), drop the `pathname.split('/').pop()` fragility.

#### `member_id` doctrine

- [ ] Add a section to `CLAUDE.md` under "Schema conventions" calling out `table_members.member_id` as the one intentional exception to `user_id` naming. Explain why (legacy, not worth the migration cost) and how new code should handle it (use the helper view or just remember).
- [ ] Create SQL view `public.v_table_members (table_id, user_id, role, joined_at, ...)` that selects `member_id AS user_id` from `table_members`. Use in any new read-only context that wants to treat the column as `user_id`.
- [ ] Grep every existing migration's RLS policies for `tm.user_id` / `table_members ... user_id` typo; fix to `member_id`. (Already covered by TICKET-034 for `entry_photos`; this is the systemic pass.)

#### `table_night` / `round` doctrine

- [ ] Update `CLAUDE.md`'s Terminology section to be crisper: DB = `table_night`, UI/hooks = `round`. Edge function path = `table-night/` (unchanged). New code should use `round` in UI, edge-function call sites, and hook names.
- [ ] Rename `useRateTableNight` → `useRateRound`. Update all callsites.
- [ ] Audit component names — if any client component file has `TableNight` in the name but only renders a Round UI, rename (optional, do as found).
- [ ] Do NOT rename DB tables or edge-function path. Too expensive for the value.

#### Query key registry

- [ ] Add prefix helpers to `lib/queryKeys.ts` for every area that currently uses literal prefixes:
  ```ts
  queryKeys.users.profileAll = () => ['users', 'profile'] as const;
  queryKeys.users.profile = (id: string) => [...queryKeys.users.profileAll(), id] as const;
  queryKeys.users.followListAll = () => ['users', 'followList'] as const;
  queryKeys.users.followList = (userId: string, kind: 'followers' | 'following') => [...];
  queryKeys.atlas.all = () => ['atlas'] as const;
  queryKeys.atlas.index = (tableId: string) => [...queryKeys.atlas.all(), 'index', tableId] as const;
  queryKeys.atlas.city = (tableId: string, city: string) => [...];
  queryKeys.feed.all = (userId: string) => ['feed', userId] as const;  // already exists; confirm
  queryKeys.tables.activityAll = () => ['tableActivity'] as const;
  ```
- [ ] Grep the codebase for `queryKey: ['` (literal array keys) — every one becomes a call to `queryKeys.xxx.*`. Exceptions allowed only with a `// eslint-disable` + comment.
- [ ] Confirm every invalidation matches a real key helper, not a prefix literal.

#### Shared invoke helper

- [ ] New file `napkin-app/lib/edgeInvoke.ts`:
  ```ts
  export async function callEdgeFn<T>(
    name: string,
    opts?: { action?: string; method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown; signal?: AbortSignal }
  ): Promise<T> {
    // Resolve session, build URL, do fetch/invoke, return parsed body, throw structured error.
  }
  export function unwrapInvokeError(err: unknown): { code: string; message: string; details?: unknown } { ... }
  ```
- [ ] Migrate every hook that calls an edge function to use `callEdgeFn`. Expected list:
  - `hooks/feed/useFeed.ts`
  - `hooks/restaurants/useRestaurantPage.ts`
  - `hooks/restaurants/useUserRestaurantHistory.ts`
  - `hooks/search/useRestaurantSearch.ts`
  - `hooks/tables/useTables.ts`, `useCreateTable.ts`, `useLeaveTable.ts`, `useAddMember.ts`, `useTableActivity.ts`, `useTableAtlas.ts`, `useTableAtlasCity.ts`, `useTableNight.ts` (all actions)
  - `hooks/users/useFollow.ts`, `useUnfollow.ts`, `useUserProfile.ts`, `useUserSearch.ts`, `useFollowList.ts`, `useUserDiary.ts`
  - `hooks/wishlist/*`, `hooks/lists/*`, `hooks/posts/*`, `hooks/entries/*`, `hooks/members/*`
- [ ] Delete raw `fetch()` to edge-function URLs outside `edgeInvoke.ts`.
- [ ] Delete explicit `headers: { Authorization: ... }` from every hook that uses invoke — session JWT auto-attaches.
- [ ] Add a CI check (grep assertion) that fails if any file outside `edgeInvoke.ts` contains `supabase.functions.invoke` or an edge-function URL in a `fetch(`.

#### Testing plan

- [ ] `tsc --noEmit` clean after refactor.
- [ ] Every screen smoke-tested: feed, journal, Tables tab, Table activity, Round, restaurant page, profile (own + stranger), wishlist, list, search, auth.
- [ ] Grep assertion CI check passes.
- [ ] No new query keys; invalidation behavior unchanged.

### Non-goals

- Do not rename `member_id` in the schema. Too expensive.
- Do not rename `table_nights` in the schema. Too expensive.
- Do not rewrite edge function error handling (that's TICKET-037).
- Do not add new features.

### Definition of Done

- All dead code deleted; no orphans; `tsc --noEmit` clean.
- `callEdgeFn` used everywhere.
- Query key registry is the only source of query keys.
- CLAUDE.md updated with the two naming doctrines.
- Build log lists every file touched.
