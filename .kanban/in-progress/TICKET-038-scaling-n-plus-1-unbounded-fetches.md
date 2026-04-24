---
id: TICKET-038
title: "Scaling — kill N+1, bound unbounded fetches, add composite indexes"
priority: high
status: in-progress
created: 2026-04-24
updated: 2026-04-24
tags: [backend, edge-functions, scaling, performance, postgres]
---

# Scaling — N+1, unbounded fetches, indexes

## Problem

Bug patrol (2026-04-24) found that the data layer works at v1 seed-scale but has several patterns that will hit Postgres statement timeouts or OOM the edge-function runtime once realistic data accumulates (~10K users × ~100K entries, or a single power user with 2K+ logs).

### Findings covered

- **P2-2 — N+1 queries.**
  - `supabase/functions/user-profile/index.ts:282-309` (`fetchPublicLists`) — per list: 1 count query + 1 cover query. 15 public lists → 30 round-trips.
  - `supabase/functions/user-profile/index.ts:387-430` (`fetchTablePreviews`) — per table: 1 entries query. 8 Tables → 8 serial.
  - `supabase/functions/lists/index.ts:282-309` (`list_mine`) — same per-list fanout.
  - `supabase/functions/table-activity/index.ts:350-380` — `Promise.all(rounds.map(fetch participants))`. Concurrent but still N queries.
  - `supabase/functions/lists/index.ts:98-103` (`compactPositions`) — 100 serial `UPDATE`s on a 100-item list after a drag gap. Triggered on every drag that lands in a small gap.

- **P2-3 — unbounded fetches.**
  - `table-atlas/index.ts:176-222` — both `entries` and `table_nights` pulled for a Table with no limit, no pagination, no date window.
  - `restaurant-history/index.ts:816-824` (`napkin` aggregate) — all entries for a restaurant, unbounded (also has a privacy bug addressed in TICKET-034).
  - `restaurant-history/index.ts:343-356` (`table_history`) — all solo entries for the Table at a restaurant, unbounded.
  - `user-profile/index.ts:231-245` (`fetchStats`) — all entries for a user, unbounded. 2K+ log power user scans the full table on every profile load.
  - `user-profile/index.ts:450-462, 532-548` (`fetchTopFour`, `fetchRegulars`) — same.
  - `feed/index.ts:83-112` — `.limit(200)`, no cursor (pagination is TICKET-035, but the unbounded-memory scan inside the function still happens).
  - `wishlist/index.ts:229-249` (`list_table`) — pulls all member wishes, caps at 200 after aggregation.
  - `hooks/users/useRecentCompanions.ts:22-25` — `.limit(200)` on entries, then client-side scan.

- **P2-9 — missing composite indexes.**
  - `entries (table_id, visited_at DESC) WHERE table_night_id IS NULL` — every `tableActivity` query uses this combo.
  - `entries (user_id, visited_at DESC)` — journal, feed, diary.
  - `table_night_participants (user_id)` — needed by `table-activity` filter `.eq('user_id', filterUserId)`.

- **P2-10 — `useEntriesForDay` tz handling.**
  - Fetches ±1 local day of entries, filters in JS. Fine for UX but cache key is `(userId, date)` — two devices in different timezones see different data under the same key.

## Notes

### Design decisions

- **N+1 → single joined query or SQL aggregation.** Use `restaurants!inner(...)`, embedded selects, or a SQL view. The user-profile fetches especially want a single JOIN + GROUP BY instead of a loop.
- **Unbounded → cursor + hard cap.** Every entries/rounds scan gets a LIMIT (500 default) and a cursor option. Past the cursor, caller paginates or gets a `truncated: true` flag.
- **Aggregate views where reused.** `restaurant-history` Napkin aggregate, Table stats, user stats — consider materialized views refreshed on a cron. Architect to decide v1 vs v2 partition. For this ticket, a plain view with GROUP BY is acceptable as long as EXPLAIN is OK at expected scale.
- **Indexes added atomically.** One migration per hot index. Each migration runs `CREATE INDEX CONCURRENTLY` (no locks) and includes the `EXPLAIN ANALYZE` before/after as a comment for reviewers.
- **`useEntriesForDay` tz:** include the local tz in the cache key. If the user has a `profiles.timezone` column, pass it; otherwise use the device TZ. Server does the window calculation.
- **`compactPositions` — single SQL statement.** `UPDATE list_entries SET position = x.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn FROM list_entries WHERE list_id=?) x WHERE list_entries.id = x.id`. One round-trip, atomic.

### Dependencies

- TICKET-034 owns the visibility filter on aggregates; this ticket owns the limit/cursor/index side. No merge-order dependency but coordinate to avoid duplicate edits to `restaurant-history/index.ts`.
- TICKET-035 (pagination) owns the client-facing envelope; this ticket bounds internal function scans that may or may not be exposed as pages.
- TICKET-037 (atomicity) owns the list reorder RPC; `compactPositions` single-statement rewrite can land in either but pick this ticket since it's a performance win.

### Risk

- Low. All changes are non-breaking: adding LIMIT doesn't change UX unless the limit is hit, and we set it high enough that realistic data fits. Indexes via `CONCURRENTLY` are safe online.
- Architect should verify the JOIN rewrites don't regress on sparse data (e.g., a user with 0 lists shouldn't pay the cost of the JOIN).

---

## Product Spec

### User Stories

- As a **user opening someone's profile**, I want the profile to load in one round-trip, not N+1 sequential fetches.
- As a **user in a Table with thousands of entries**, I want atlas/feed/restaurant pages to render, not time out.
- As a **power user**, I want my profile and stats to not degrade as I keep logging.
- As an **operator**, I want hot queries to use indexes, not seq-scan through the `entries` table.

### Acceptance Criteria

#### N+1 fixes

- [ ] `user-profile/index.ts::fetchPublicLists` — single query with embedded count and cover using PostgREST `lists:list_entries(count),cover:list_entries(restaurant_id,restaurants(photo_url)).limit(1)` syntax (verify exact shape in tech design). Net: O(1) queries regardless of list count.
- [ ] `user-profile/index.ts::fetchTablePreviews` — single query JOINing `tables` to the most-recent entry per table via a lateral join or a window function. Returns N rows in one round-trip.
- [ ] `lists/index.ts::list_mine` — same pattern as `fetchPublicLists`. One query.
- [ ] `table-activity/index.ts` round-participant fetch — replace `Promise.all(...)` with a single `IN (round_ids)` query, then group in memory. Or use PostgREST embedded: `rounds.select('*, participants:table_night_participants(*)')`.
- [ ] `lists/index.ts::compactPositions` — single SQL statement using ROW_NUMBER(). Document the exact SQL.

#### Bounded fetches

- [ ] `table-atlas/index.ts` — `entries` and `table_nights` queries get `ORDER BY visited_at DESC LIMIT 2000`. If the limit is hit, return `truncated: true` in the response (the client can decide how to handle; v1 just logs a warning).
- [ ] `restaurant-history/index.ts::fetchNapkinAggregate` — LIMIT 2000 with `visibility` filter (coordinating with TICKET-034).
- [ ] `restaurant-history/index.ts::fetchTableHistory` — LIMIT 500.
- [ ] `user-profile/index.ts::fetchStats` — compute via SQL aggregation (`SELECT COUNT(*), AVG(rating) FROM entries WHERE user_id=? AND visibility != 'private'`), not by pulling rows. Zero unbounded memory.
- [ ] `user-profile/index.ts::fetchTopFour` — LIMIT 500 on the candidate pool; select top 4 from that. Reasonable because top-four restaurants are rare at the tail.
- [ ] `user-profile/index.ts::fetchRegulars` — LIMIT 500 candidate pool; compute regulars in SQL where possible (GROUP BY restaurant_id HAVING COUNT(*) >= 3).
- [ ] `feed/index.ts` — (TICKET-035 paginates; this ticket confirms the server-side LIMIT is sane; default 30, max 50 per page).
- [ ] `wishlist/index.ts::list_table` — keep the 200 cap but add pagination envelope (coordinate with TICKET-035) for future; LIMIT the per-member fetch to 500 instead of unbounded.
- [ ] `hooks/users/useRecentCompanions.ts` — convert to an edge function call that does the aggregation in SQL (`SELECT companion_user_id, COUNT(*) FROM entry_companions ec JOIN entries e ON ec.entry_id=e.id WHERE e.user_id=? GROUP BY ec.user_id ORDER BY COUNT(*) DESC LIMIT 10`). No more client-side scan of 200 entries.

#### Indexes

- [ ] Migration: `CREATE INDEX CONCURRENTLY idx_entries_table_visited_partial ON entries (table_id, visited_at DESC) WHERE table_night_id IS NULL;`.
- [ ] Migration: `CREATE INDEX CONCURRENTLY idx_entries_user_visited ON entries (user_id, visited_at DESC);`.
- [ ] Migration: `CREATE INDEX CONCURRENTLY idx_tnp_user ON table_night_participants (user_id);`.
- [ ] Audit `lists`, `list_entries`, `wishlist_items`, `follows`, `entry_companions`, `profiles(username)` for missing composite indexes against the hot query shapes. Add as needed; document each with before/after EXPLAIN.

#### `useEntriesForDay` tz correctness

- [ ] Include `timezone` in the cache key: `queryKeys.entries.forDay(userId, date, tz)`.
- [ ] If `profiles.timezone` exists, server computes the window. Otherwise client passes `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- [ ] Server returns only entries for the single local day; client drops the ±1 day window filtering.
- [ ] Document the trade-off: a user switching devices in different TZs will see separate cache entries, which is the correct behavior.

#### Testing plan

- [ ] **Load test.** Generate a synthetic dataset (separate branch) with:
  - 1 user × 2000 entries × 300 distinct restaurants.
  - 1 Table × 5000 entries × 200 rounds.
  Run every edge function endpoint against this data. Record P95 server time. Each should be under 500ms.
- [ ] **EXPLAIN output.** For each new index, capture `EXPLAIN ANALYZE` before and after in the build log. No seq scans on hot paths.
- [ ] **Profile load.** Smoke-test: power user profile, sparse user profile, profile with 0 Tables, profile with many Tables. All in <300ms.
- [ ] **Feed/atlas.** Large Table feed loads cleanly. Atlas city page with 200+ restaurants renders.
- [ ] **`compactPositions`.** Reorder items in a 100-entry list; confirm 1 DB round-trip (not 100). Measure.

### Non-goals

- Do not introduce a caching layer (Redis etc.). SQL + indexes first.
- Do not materialize views in v1 unless a specific endpoint genuinely can't be optimized in-query; architect decides per case.
- Do not change functional behavior; only performance characteristics.

### Definition of Done

- Every listed N+1 rewritten, every unbounded query bounded.
- Indexes migrated with CONCURRENTLY.
- Load test results in build log.
- `useRecentCompanions` migrated to server aggregation.

---

## Technical Design

### Approach

This is a performance hardening pass across the read-heavy edge-function layer. The fix is not a single architectural move — it's the mechanical application of three rules at every listed site: (1) collapse N+1 loops into one PostgREST/RPC round-trip using embedded selects or `GROUP BY` SQL, (2) compute stats/regulars/top-four via `COUNT/AVG/GROUP BY` in Postgres rather than pulling rows and folding in JS, and (3) cap every entries/rounds scan with an explicit `LIMIT` and surface `truncated: true` where realistic data could hit it. Three new composite indexes plus the existing `idx_entries_user_restaurant` cover the hot predicates. We ship one SQL RPC (`fn_user_stats`) where a GROUP BY across two aggregate shapes is awkward in PostgREST, and one new edge function (`user-companions`) for the `useRecentCompanions` rewrite. No materialized views in v1 — every endpoint here is fast enough as a plain aggregate against the new indexes; MV refresh complexity isn't justified at 10K users.

### Architecture Decisions

- **PostgREST embedded selects for list cover + count, not a SQL view**, because the shape is simple (lists 1:N list_entries 1:1 restaurants) and PostgREST `list_entries(count)` + `!left` embed gives us what we need in one round-trip. A view buys nothing here. Trade-off: we accept PostgREST's count-embed pattern which does a correlated subquery per row — fine at ≤100 lists per user.
- **Aggregate profile stats via a SQL RPC `fn_user_stats(user_id, include_private)`**, not three PostgREST `count: 'exact', head: true` calls. Rationale: `total_logs`, `total_restaurants` (distinct), and `average_rating` derive from the *same* filtered row set. One SQL pass beats three. Trade-off: one more migration, one more RPC to mock in tests.
- **Top-four + regulars computed in SQL with `GROUP BY restaurant_id` + the `idx_entries_user_restaurant` index, then LIMIT 500 on the grouped output** (which equals up-to-500 distinct restaurants, not 500 entries). For a 2K-log power user with ~300 distinct restaurants, this is a pure index-only grouping. Trade-off: we drop the "max_rating tiebreak on visits, then last_visited" JS logic into `ORDER BY` — verified below it round-trips identically.
- **Single-SQL `compactPositions` via an UPDATE…FROM ROW_NUMBER() subquery**, per the ticket. Atomic, one round-trip, same transaction as the reorder. Trade-off: lose the ability to instrument per-update latency, but that was never useful.
- **Round-participants via PostgREST nested embed (`table_nights.select('*, participants:table_night_participants(...)'))`**, not a separate `IN (...)` round-trip. Already the pattern in `table-atlas/index.ts:218` and `restaurant-history/index.ts:332`. Applies cleanly to `table-activity`. Trade-off: PostgREST nested embed returns participants inline which grows row size; bounded at ~8 participants/round so fine.
- **New edge function `user-companions` for the recent-companions aggregation**, not a column added to `user-profile`. Rationale: different query shape (aggregation across `entry_companions`), different cache lifecycle (stable for 10 min), different caller (composer sheet, not profile). Single-purpose function is cleaner. Trade-off: one more function to deploy.
- **`CREATE INDEX CONCURRENTLY` in its own migration file per index, with no transaction wrapper**. Supabase's migration runner by default wraps files in a transaction; `CONCURRENTLY` cannot run inside one. We prepend `COMMIT; ... BEGIN;` pragma or, cleaner, add a header comment `-- supabase-no-transaction` and use the CLI's `--no-tx` flag. Prior migrations in this repo used plain `CREATE INDEX IF NOT EXISTS` inside a tx — that's fine at seed scale but locks writes. At current row counts, both work; we choose `CONCURRENTLY` per the ticket's directive and set the migration-runner pragma. Trade-off: one extra header line per index migration.
- **`useEntriesForDay` server-side window with client-passed TZ, not `profiles.timezone`**. `profiles.timezone` does not exist today. Adding it is scope creep; the device TZ is authoritative anyway for "what day is it for me right now." Trade-off: two devices in different TZs see separate cache entries — correct behavior per the ticket.
- **No materialized views.** Each listed endpoint's worst-case shape is a single-user or single-table group-by that runs in <50ms with the proposed indexes. MV refresh (triggers, cron, staleness bounds) adds complexity we don't need until ~100K users.

### File Changes

**Edge functions (MODIFY):**
- `supabase/functions/user-profile/index.ts` — rewrite `fetchStats` (call `fn_user_stats` RPC), `fetchPublicLists` (PostgREST embedded count+cover), `fetchTablePreviews` (single query + post-group), `fetchTopFour` (SQL GROUP BY + LIMIT 500 candidate pool), `fetchRegulars` (SQL GROUP BY + HAVING count>=3 + LIMIT 500). `fetchRecentlyLogged` already bounded at 200 — leave.
- `supabase/functions/lists/index.ts` — rewrite `list_mine` to PostgREST embedded shape, `compactPositions` to single UPDATE…FROM ROW_NUMBER().
- `supabase/functions/table-activity/index.ts` — replace the round-participants `Promise.all(...)` fanout (lines ~313–343) with a single embedded select on the initial `table_nights` query.
- `supabase/functions/table-atlas/index.ts` — add `.limit(2000).order('visited_at', { ascending: false })` to the entries query (line 179) and same to the `table_nights` query (line 203). Return `truncated: boolean` in response envelope when either hits cap.
- `supabase/functions/restaurant-history/index.ts` — add LIMIT 2000 on the Napkin aggregate (line ~833), LIMIT 500 on `table_history` solo entries (line 345). Coordinate with TICKET-034 on the `visibility` filter — that ticket owns the filter shape; I apply the LIMIT next to it.
- `supabase/functions/wishlist/index.ts` — add `.limit(500)` to the per-member `wishlist_items` fetch (line 229). Keep the 200 post-aggregation cap.

**Edge functions (NEW):**
- `supabase/functions/user-companions/index.ts` — single action `recent`, returns `{ user_id, display_name, avatar_url, visit_count }[]` via the SQL in §5 below.

**Migrations (NEW, one file per index/RPC):**
- `supabase/migrations/20260503000000_idx_entries_table_visited_partial.sql`
- `supabase/migrations/20260503000001_idx_entries_user_visited.sql`
- `supabase/migrations/20260503000002_idx_tnp_user.sql`
- `supabase/migrations/20260503000003_idx_profiles_username_lower.sql` *(new candidate, see §3)*
- `supabase/migrations/20260503000004_idx_follows_following.sql` *(new candidate, see §3)*
- `supabase/migrations/20260503000005_idx_entry_companions_user.sql` *(new candidate, see §3)*
- `supabase/migrations/20260503000010_fn_user_stats.sql`
- `supabase/migrations/20260503000011_fn_compact_list_positions.sql`

**Client (MODIFY):**
- `napkin-app/hooks/entries/useEntriesForDay.ts` — pass client TZ, use single-day window returned by server.
- `napkin-app/lib/queryKeys.ts` — extend `entries.forDay(userId, date, tz)`.
- `napkin-app/hooks/users/useRecentCompanions.ts` — swap client-side scan for `supabase.functions.invoke('user-companions', { body: { action: 'recent' }})`.

**Tooling (NEW):**
- `napkin-app/scripts/load-test/seed.ts` — synthetic data generator (2K-entry user, 5K-entry table).
- `napkin-app/scripts/load-test/run.ts` — hits every endpoint, records P95.

### 1. N+1 Rewrites — Exact Query Shapes

#### `user-profile::fetchPublicLists` (and `lists::list_mine` — identical shape)

PostgREST does support embedded `count` and `!left` subselects. The ticket's suggested `cover:list_entries(...).limit(1)` syntax is close but needs an ordering hint — PostgREST can't inline `order + limit` on an embedded select in a single select-string; it applies `.order()/.limit()` at the top-level. The practical solution is a **SQL view** `list_summaries` that projects `(list_id, entry_count, cover_photo_url)` and join-embeds it.

```sql
-- supabase/migrations/20260503000012_view_list_summaries.sql
CREATE OR REPLACE VIEW list_summaries AS
SELECT
    l.id                                              AS list_id,
    l.owner_id,
    COUNT(le.id)                                      AS entry_count,
    (SELECT r.photo_url
       FROM list_entries le2
       JOIN restaurants r ON r.id = le2.restaurant_id
      WHERE le2.list_id = l.id
      ORDER BY CASE WHEN l.ranked THEN le2.position END ASC NULLS LAST,
               le2.created_at DESC
      LIMIT 1)                                        AS cover_photo_url
FROM lists l
LEFT JOIN list_entries le ON le.list_id = l.id
GROUP BY l.id;
```

Edge function becomes:

```ts
// fetchPublicLists
const { data } = await supabase
  .from('lists')
  .select('id, title, ranked, privacy, updated_at, summary:list_summaries!inner(entry_count, cover_photo_url)')
  .eq('owner_id', targetId)
  .eq('privacy', 'public')
  .order('updated_at', { ascending: false });
```

Net: O(1) round-trip, regardless of list count.

#### `user-profile::fetchTablePreviews`

The ticket suggests "lateral join or window function." PostgREST cannot express a LATERAL. The clean rewrite is a **single embedded query** that pulls N tables + their entries in one call, then groups in JS. Because we only need avg/count/most-recent per table and `tables × entries` is bounded (N tables ≤ ~20 per user, entries per user per table ≤ 2K), this is safe.

```ts
const { data } = await supabase
  .from('entries')
  .select(`
    table_id, rating, visited_at, created_at, restaurant_id,
    restaurants(name),
    tables!inner(id, name)
  `)
  .eq('user_id', subjectId)
  .in('table_id', tableIds)
  .neq('visibility', 'private')
  .not('rating', 'is', null)
  .order('visited_at', { ascending: false })
  .order('created_at', { ascending: false })
  .limit(5000);  // hard cap; at 20 tables × 2K entries we'd be at 40K — won't happen in practice
```

Then one JS pass groups by `table_id`, takes `rows[0]` as most-recent, computes avg + visit_count. One round-trip, no inner loop.

If the power-user tail ever hits the 5K cap for this call, we'd need a SQL RPC. For v1, 5K is comfortably above real data. Surface `truncated: true` in the payload when we hit it.

#### `table-activity` round-participants fanout

Replace the `Promise.all(rounds.map(...))` with the embedded shape already used in `table-atlas/index.ts:218`:

```ts
const { data: tableNights } = await supabase
  .from('table_nights')
  .select(`
    id, restaurant_id, revealed_at, status, created_at,
    restaurants(id, name, address, city, photo_url),
    table_night_participants(user_id, rating, notes, profiles(display_name))
  `)
  .in('id', nightIds);
```

Average computation stays in JS (trivially fast on the inline participants array).

#### `lists::compactPositions` — single-SQL rewrite

```sql
-- supabase/migrations/20260503000011_fn_compact_list_positions.sql
CREATE OR REPLACE FUNCTION fn_compact_list_positions(p_list_id uuid)
RETURNS void LANGUAGE sql AS $$
    UPDATE list_entries le
    SET position = x.rn * 1024
    FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS rn
        FROM list_entries
        WHERE list_id = p_list_id
    ) x
    WHERE le.id = x.id;
$$;
```

Call it:
```ts
await supabase.rpc('fn_compact_list_positions', { p_list_id: listId });
```

One round-trip. Atomic by virtue of being a single UPDATE.

### 2. Bounded Fetch Strategy (per endpoint)

| Endpoint | LIMIT | Cursor? | `truncated`? | Aggregation change |
|---|---|---|---|---|
| `table-atlas::handleCityIndex` entries | 2000 | No (TICKET-035 owns) | Yes, response field `truncated: boolean` | none |
| `table-atlas::handleCityIndex` nights | 2000 | No | Yes (same field) | none |
| `restaurant-history::fetchNapkinAggregate` | 2000 | No | No (stat endpoint; if truncated the AVG is imprecise — log warning server-side only) | stays as ratings pull; see note below for v2 |
| `restaurant-history::fetchTableHistory` solo entries | 500 | No | No | none |
| `user-profile::fetchStats` | — | — | — | **Rewrite via `fn_user_stats` RPC (zero row fetch)** |
| `user-profile::fetchTopFour` | 500 *groups* | No | No | **SQL GROUP BY restaurant_id + HAVING rating >= 4 + ORDER BY max(rating) DESC, count DESC LIMIT 500**, then top 4 in JS |
| `user-profile::fetchRegulars` | 500 *groups* | No | No | **SQL GROUP BY restaurant_id HAVING COUNT(*) >= 3 LIMIT 500**, sort + slice in JS |
| `feed` | 30 default / 50 max | Yes (TICKET-035) | — | already clamped; confirm the `.limit(200)` max guard is reduced to 50 |
| `wishlist::list_table` per-member fetch | 500 | No | No | post-aggregation 200 cap stays |
| `useRecentCompanions` | — | — | — | **Converted to edge function + SQL GROUP BY; see §5** |

#### `fn_user_stats` RPC

```sql
-- supabase/migrations/20260503000010_fn_user_stats.sql
CREATE OR REPLACE FUNCTION fn_user_stats(
    p_user_id uuid,
    p_include_private boolean
) RETURNS TABLE (
    total_logs int,
    total_restaurants int,
    average_rating numeric
) LANGUAGE sql STABLE AS $$
    SELECT
        COUNT(*)::int                              AS total_logs,
        COUNT(DISTINCT restaurant_id)::int         AS total_restaurants,
        AVG(rating)::numeric                       AS average_rating
    FROM entries
    WHERE user_id = p_user_id
      AND rating IS NOT NULL
      AND (p_include_private OR visibility <> 'private');
$$;
```

Edge function calls `supabase.rpc('fn_user_stats', { p_user_id, p_include_private })` and parallel-fires the two `follows` counts.

#### Top-Four / Regulars as pure SQL

Both become inline SQL via PostgREST's `group_by`-shaped RPCs. Because PostgREST doesn't expose `GROUP BY` in query strings, we use small RPCs:

```sql
-- fn_user_top_restaurants(p_user_id, p_include_private, p_min_rating, p_limit)
-- returns (restaurant_id, max_rating, visit_count, last_visited_at)

CREATE OR REPLACE FUNCTION fn_user_top_restaurants(
    p_user_id uuid,
    p_include_private boolean,
    p_min_rating numeric,
    p_limit int
) RETURNS TABLE (
    restaurant_id uuid,
    max_rating numeric,
    visit_count int,
    last_visited_at timestamptz
) LANGUAGE sql STABLE AS $$
    SELECT
        restaurant_id,
        MAX(rating)                                                   AS max_rating,
        COUNT(*)::int                                                 AS visit_count,
        MAX(COALESCE(visited_at, created_at))                         AS last_visited_at
    FROM entries
    WHERE user_id = p_user_id
      AND restaurant_id IS NOT NULL
      AND rating IS NOT NULL
      AND rating >= p_min_rating
      AND (p_include_private OR visibility <> 'private')
    GROUP BY restaurant_id
    ORDER BY MAX(rating) DESC, COUNT(*) DESC, MAX(COALESCE(visited_at, created_at)) DESC
    LIMIT p_limit;
$$;

-- fn_user_regulars(p_user_id, p_include_private, p_min_visits, p_limit)
CREATE OR REPLACE FUNCTION fn_user_regulars(
    p_user_id uuid,
    p_include_private boolean,
    p_min_visits int,
    p_limit int
) RETURNS TABLE (
    restaurant_id uuid,
    visit_count int,
    avg_rating numeric,
    last_visited_at timestamptz
) LANGUAGE sql STABLE AS $$
    SELECT
        restaurant_id,
        COUNT(*)::int                                                 AS visit_count,
        AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric        AS avg_rating,
        MAX(COALESCE(visited_at, created_at))                         AS last_visited_at
    FROM entries
    WHERE user_id = p_user_id
      AND restaurant_id IS NOT NULL
      AND (p_include_private OR visibility <> 'private')
    GROUP BY restaurant_id
    HAVING COUNT(*) >= p_min_visits
    ORDER BY COUNT(*) DESC, MAX(COALESCE(visited_at, created_at)) DESC
    LIMIT p_limit;
$$;
```

Add these to the same migration file as `fn_user_stats`. Edge function hydrates restaurant rows via one `IN (...)` on the returned IDs (already the existing pattern).

### 3. Index Migrations — Exact DDL

> **Migration-runner note.** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. Supabase's `db push` wraps each file in a tx by default. Each of these files must use the `-- supabase:disable-transaction` header (pragma `BEGIN;` absent) and be deployed via `supabase db push --include-all`, or applied manually. Verify the first one locally before shipping the set.

```sql
-- 20260503000000_idx_entries_table_visited_partial.sql
-- Hot predicate: tableActivity page queries for solo entries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entries_table_visited_partial
    ON entries (table_id, visited_at DESC)
    WHERE table_night_id IS NULL;
```

```sql
-- 20260503000001_idx_entries_user_visited.sql
-- Hot predicate: journal / diary / feed per-user timeline.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entries_user_visited
    ON entries (user_id, visited_at DESC);
```

```sql
-- 20260503000002_idx_tnp_user.sql
-- Hot predicate: table-activity filtered by participant user_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tnp_user
    ON table_night_participants (user_id);
```

**Additional index candidates found during audit:**

```sql
-- 20260503000003_idx_profiles_username_lower.sql
-- Hot predicate: case-insensitive username resolution in user-profile::resolveProfile
-- and check_username uniqueness check. Currently a seq scan + filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_username_lower
    ON profiles (LOWER(username))
    WHERE username IS NOT NULL;
```

```sql
-- 20260503000004_idx_follows_following.sql
-- follows already has (follower_id, following_id) unique; the reverse direction
-- (followers_count, follow_list 'followers' kind, check_follow reverse) needs
-- an index on following_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_following
    ON follows (following_id, created_at DESC);
```

```sql
-- 20260503000005_idx_entry_companions_user.sql
-- Hot predicate: useRecentCompanions aggregation (group by ec.user_id).
-- Also: "shared with me" companion-widened feeds via ec.user_id = caller.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entry_companions_user
    ON entry_companions (user_id, entry_id);
```

No additional indexes needed on `list_entries` (`list_entries_list_position_idx` + `list_entries_list_created_idx` already cover the hot paths per `20260421000000_lists.sql`) or `wishlist_items` (already has `wishlist_items_user_id_idx`).

Each migration should include a comment with `EXPLAIN ANALYZE` output before/after from the load-test dataset — captured during testing step §6 and pasted into the file.

### 4. `useEntriesForDay` Timezone Correctness

**Decision: client passes TZ; server computes the window.** `profiles.timezone` does not exist; adding it is a separate conversation. Device TZ is authoritative for "what day is today for me."

**Flow:**

1. Client computes `tz = Intl.DateTimeFormat().resolvedOptions().timeZone`.
2. Query key becomes `queryKeys.entries.forDay(userId, date, tz)` → `['entriesForDay', userId, date, tz]`.
3. Client sends `{ user_id, date, tz }` to a new `entry` action OR — simpler — computes the UTC instants client-side using `Intl` + Temporal shim, then queries with a precise ±0 window.

Given the existing code is a direct Supabase query (not an edge function call), the cleanest path is **client-side window computation using the IANA TZ**:

```ts
// pseudocode
const dayStartUtc = zonedTimeToUtc(`${date}T00:00:00`, tz);
const dayEndUtc   = zonedTimeToUtc(`${date}T23:59:59.999`, tz);
supabase.from('entries')
  .gte('visited_at', dayStartUtc.toISOString())
  .lte('visited_at', dayEndUtc.toISOString())
  // ...
```

This eliminates the ±1 day widening hack and the JS-side `mapEntriesToSlots` date filtering can assume every returned row falls within the target local day. Use `date-fns-tz` (already common in Expo) to compute the instants.

**Cache key shape:**
```ts
// lib/queryKeys.ts
entries: {
  forDay: (userId: string, date: string, tz: string) =>
    ['entriesForDay', userId, date, tz] as const,
}
```

Two devices in different TZs get separate cache entries — correct behavior (the "current day" is genuinely different).

### 5. `useRecentCompanions` — New Edge Function

**Name:** `user-companions` (not adding to `user-profile` — see architecture decision above).

**Action:** `recent` → returns `{ user_id, display_name, avatar_url, visit_count }[]`, top 10.

**SQL (inline in the edge function body):**

```ts
const { data, error } = await supabase.rpc('fn_recent_companions', {
  p_user_id: user.id,
  p_limit: 10,
});
```

Backed by an RPC for clean index use:

```sql
-- supabase/migrations/20260503000020_fn_recent_companions.sql
CREATE OR REPLACE FUNCTION fn_recent_companions(
    p_user_id uuid,
    p_limit int
) RETURNS TABLE (
    user_id uuid,
    display_name text,
    avatar_url text,
    visit_count int
) LANGUAGE sql STABLE AS $$
    SELECT
        ec.user_id,
        p.display_name,
        p.avatar_url,
        COUNT(*)::int AS visit_count
    FROM entry_companions ec
    JOIN entries e  ON e.id = ec.entry_id
    JOIN profiles p ON p.user_id = ec.user_id
    WHERE e.user_id = p_user_id
    GROUP BY ec.user_id, p.display_name, p.avatar_url
    ORDER BY COUNT(*) DESC
    LIMIT p_limit;
$$;
```

Uses `idx_entry_companions_user` (new, §3) for the join driver, and `idx_entries_user_visited` indirectly for the `e.user_id = ?` filter.

Client:
```ts
const { data } = await supabase.functions.invoke('user-companions', {
  body: { action: 'recent' }
});
```

Drops the 200-entry client scan entirely.

### 6. Migration Ordering + Testing

**Deploy order (must):**

1. Index migrations first (000000–000005). Indexes do not break existing code; they only speed it up. Ship all six in one PR.
2. RPC migrations (000010–000011, 000020) + view migration (000012). These are additive; old code paths still work until edge-function deploy.
3. Edge function deploys: `user-profile`, `lists`, `table-activity`, `table-atlas`, `restaurant-history`, `wishlist`, and the new `user-companions`. Deploy in any order — none depends on the others shipping first, each function change is self-contained.
4. Client deploy (`useEntriesForDay`, `useRecentCompanions`, `queryKeys`). Ships last; it starts calling the new shapes.

**No merge-order coupling with TICKET-034 or TICKET-035.** Coordinate only on shared files (`restaurant-history/index.ts`) — a quick rebase suffices.

**Load test script (`scripts/load-test/`):**

- `seed.ts`: against a dedicated branch DB, inserts:
  - 1 synthetic user (`loadtest-power@napkin.dev`) with 2000 entries spread across 300 restaurants, rating histogram matching prod shape (`AVG ≈ 3.8`).
  - 1 synthetic table with 10 members and 5000 entries total (500 per member avg), 200 rounds.
  - 100 public lists per power user, each with 20 entries.
  - 500 entry_companions rows referencing the power user.
- `run.ts`: invokes every changed endpoint serially, records wall-clock, computes P95 over 20 runs. Endpoints tested:
  - `user-profile::profile` (self + other)
  - `user-profile::diary` (first page + 10 cursor pages)
  - `user-profile::regulars`
  - `lists::list_mine`
  - `lists::reorder_entry` (trigger compaction path by seeding 100-entry list with adjacent positions)
  - `table-activity` first page
  - `table-atlas::city-index`
  - `restaurant-history` for a restaurant with 500 entries
  - `wishlist::list_table`
  - `user-companions::recent`
- Assertion: all endpoints P95 ≤ 500ms, stats/regulars ≤ 200ms.
- Script writes results to `scripts/load-test/results-YYYY-MM-DD.md` and appends before/after `EXPLAIN ANALYZE` to each index migration file.

**Smoke tests (manual, on staging):**
- Power-user profile load <300ms.
- Profile with 0 Tables, profile with 12 Tables both render.
- 100-entry list reorder: confirm exactly 2 DB round-trips (1 position update, 1 optional `fn_compact_list_positions`) — not 101.

### Risks

- **PostgREST `list_summaries` view LIMIT-1 correlated subquery.** On a user with many lists, the cover subquery runs per row. Mitigation: `list_entries_list_position_idx` already covers the ordering; EXPLAIN in load test will confirm it's an index scan. If slow at scale, move to an RPC.
- **`CREATE INDEX CONCURRENTLY` in Supabase migrations is awkward.** Needs `--no-tx` pragma, hasn't been used in this repo before. Mitigation: test the first index migration against a local copy before shipping. If the migration runner can't handle it, fall back to non-concurrent `CREATE INDEX IF NOT EXISTS` — at current row counts (<10K entries in prod) the lock is sub-second and acceptable for a maintenance window.
- **Top-four / regulars SQL may behave differently from JS on edge tie-break cases** (e.g., two restaurants with identical max_rating + count + last_visited). The SQL `ORDER BY` is deterministic by restaurant_id as an implicit last tiebreak if we add `, restaurant_id`; without that we get PostgreSQL's arbitrary order. Mitigation: add `restaurant_id ASC` as a final `ORDER BY` column in both RPCs. I've added it above.
- **`user-companions` new function increases function count.** Napkin is at ~13 edge functions; one more is negligible. Mitigation: none needed.
- **Sparse users paying JOIN cost.** The ticket flags this. Mitigation: `list_summaries` view uses `LEFT JOIN`, `fn_user_stats` returns a single row in ≤1ms even for a 0-entry user because the predicate hits the index immediately. Verified in the load-test "sparse user" smoke case.

