---
id: TICKET-035
title: "Pagination contracts — unify cursor envelope across paginated endpoints"
priority: critical
status: in-progress
created: 2026-04-24
updated: 2026-04-24
tags: [backend, edge-functions, correctness, scaling]
---

# Pagination contracts — unify cursor envelope across paginated endpoints

## Problem

The bug patrol (2026-04-24) found that pagination is **silently broken or inconsistent** across four endpoints. There is no shared envelope, no shared cursor shape, and at least two endpoints produce duplicates or gaps under realistic load.

### P0-3: `useUserDiary` pagination is dead on arrival

- Server returns: `supabase/functions/user-profile/index.ts:870` → `{ rows, next_cursor: nextCursor }`.
- Client reads: `napkin-app/hooks/users/useUserDiary.ts:61` → `lastPage.nextCursor`.
- `nextCursor` is always `undefined`, so `getNextPageParam` returns `undefined` → infinite query stops after page 1.
- Users with > 30 logs cannot scroll past the first page of their own diary.
- The `yearSummary` field declared in `DiaryPage` (`useUserDiary.ts:23`) is never populated by the server.

### P0-4: `useTableActivity` pagination produces duplicates and gaps

**Server:** `supabase/functions/table-activity/index.ts:102, 339, 424-437`

The handler pulls up to `limit` (20) solo entries AND up to `limit` rounds **independently**, each with `.range(offset, offset + limit - 1)`, then merges and sorts in memory by `sort_date`. This means:

1. A page can contain up to 40 items, not 20. The client assumes exactly `PAGE_SIZE`.
2. Offset is interpreted per source stream, not on the merged stream. Example: a Table with 30 solo entries and 5 rounds — offset=0 returns 5 rounds + 20 solo, offset=20 returns 0 rounds + 10 solo. The merged-and-sorted stream across pages has ordering discontinuities (page N's oldest item may be newer than page N+1's newest).
3. Scrolling produces both duplicates and gaps depending on the solo/round ratio.

**Client:** `napkin-app/hooks/tables/useTableActivity.ts:142-145`
```ts
getNextPageParam: (lastPage, allPages) => {
    if (lastPage.length < PAGE_SIZE) return undefined;
    return allPages.length * PAGE_SIZE;
}
```
This assumes each page is exactly `PAGE_SIZE`. It's wrong by design.

### P2-18: `useFeed` has no pagination

`supabase/functions/feed/index.ts:112` — `.limit(200)` across all Tables the user is in, single-shot. Client: `napkin-app/hooks/feed/useFeed.ts` — single `useQuery`, no cursor.

For a user in 5+ active Tables with daily logging, that's only ~40 days of feed. No cursor. Users will hit the cliff and think their old logs disappeared.

### P2-19: `table-atlas` city-page unbounded

`supabase/functions/table-atlas/index.ts` — both `city-index` and `city-page` are unbounded. A Table with 300+ distinct restaurants across one city will stall at load.

### Cross-cutting issue: no shared envelope

- `wishlist` uses `{ rows, next_cursor }` (correct pattern, snake_case).
- `user-profile` diary uses `{ rows, next_cursor }` on the server, `nextCursor` on the client (broken).
- `table-activity` uses a bare array + numeric offset (no envelope, wrong).
- `feed` uses a bare array (no pagination).

Three different shapes, zero enforcement, and a silent bug on the one shape that exists.

## Notes

### Design decisions

- **Canonical envelope** for every paginated edge function:
  ```ts
  type Page<Row> = {
    rows: Row[];
    next_cursor: string | null;  // null = no more pages
    has_more: boolean;            // redundant with next_cursor but cheap safety
  };
  ```
- **Cursor shape:** an opaque string, base64(`${sort_date_iso}|${tiebreak_id}`). Tiebreak by row id to resolve same-timestamp rows. Server is authoritative on what's inside.
- **Snake_case in wire shape everywhere.** Client hooks translate to camelCase in their TS types if desired but MUST read the snake_case wire shape.
- **Merge-in-SQL, not in memory.** For `table-activity`, UNION the two streams in SQL with a unified `sort_date` column and apply `LIMIT + cursor` there. The handler does not post-filter.
- **Client helper.** Introduce `lib/pagination.ts::useCursorPagedQuery(name, params)` that wraps `useInfiniteQuery` with the canonical `getNextPageParam = (last) => last.next_cursor ?? undefined`. Every paginated hook uses it. No open-coded `allPages.length * PAGE_SIZE`.
- **No numeric offsets.** Convert every existing offset-paginated endpoint to cursor-based.

### Open questions

- For `table-activity` specifically, do we need a SQL view `v_table_activity` (UNION of entries + rounds with a common `sort_date`), or inline the UNION in the edge function query? View is cleaner but adds a schema artifact. Architect to decide in tech design.
- For `feed`, the existing 200-cap was presumably an intentional safety limit. Keep the hard upper bound on the server side (refuse `limit > 50`) but enable pagination beyond it.

### Dependencies

- None blocking. Coordinates loosely with TICKET-034 (same edge functions touched); merge order doesn't matter so long as each ticket's migration runs cleanly.

### Risk

- **Breaking API change** on `table-activity`, `user-profile?action=diary`, `feed`. Every consumer must migrate at the same time. No versioning needed because these endpoints have exactly one client (this app). Land the edge function change + the client hook change in the same PR.
- Unseen-marker logic (`hooks/tables/useLastSeenAt.ts`) reads from `tableActivity` cache — confirm it still works when cache becomes an infinite query for `useFeed`.

---

## Product Spec

### User Stories

- As a **user with a long diary**, I want to scroll past 30 entries, because there's no point in logging if I can't look back.
- As a **Tablemate of an active group**, I want feed/Table scroll to show old entries in date order without duplicates, so the Table history feels coherent.
- As a **user in many Tables**, I want the global feed to load older pages as I scroll, not cut off at an arbitrary point.
- As a **Table with an active Atlas city**, I want the city page to load all restaurants incrementally.

### Acceptance Criteria

#### Shared pagination envelope

- [ ] Document `Page<T>` type in `napkin-app/lib/pagination.ts`:
  ```ts
  export type Page<T> = { rows: T[]; next_cursor: string | null; has_more: boolean };
  ```
- [ ] Document the cursor encoding convention: `base64(${iso_timestamp}|${tiebreak_uuid})` — opaque to clients. Add a doc comment explaining server is authoritative on the shape.
- [ ] Provide `useCursorPagedQuery<T>(opts)` helper that wraps `useInfiniteQuery` with canonical `getNextPageParam = (last) => last.next_cursor ?? undefined`.
- [ ] Document the helper in `CLAUDE.md` under a new "Pagination" subsection; mandate its use for any paginated endpoint.

#### Server — `user-profile?action=diary`

- [ ] Returns `{ rows, next_cursor, has_more }` (snake_case). Drops `yearSummary` field from the response shape; compute client-side if needed.
- [ ] Cursor: `(visited_at, id)` tuple encoded as `base64(iso|uuid)`. Sort: `ORDER BY visited_at DESC, id DESC`.
- [ ] Respects `?limit=` up to a hardcoded max (50); defaults to 30.
- [ ] `napkin-app/hooks/users/useUserDiary.ts` converted to `useCursorPagedQuery`, reads `next_cursor`, deletes `yearSummary` from `DiaryPage` type.

#### Server — `table-activity`

- [ ] Replace the split-offset pattern with a single merged query. Either:
  - Create a SQL view `v_table_activity (id, kind, table_id, sort_date, payload_json)` that UNIONs entries and table_nights with a common sort, OR
  - Inline a UNION query in the edge function against a CTE.
  Architect chooses in tech design.
- [ ] Return `{ rows, next_cursor, has_more }` where `rows` is the unified activity list, ordered by `sort_date DESC, id DESC`.
- [ ] Cursor = `base64(sort_date_iso|id)`. Server decodes, applies `WHERE (sort_date, id) < cursor`, `ORDER BY sort_date DESC, id DESC`, `LIMIT 20`.
- [ ] `napkin-app/hooks/tables/useTableActivity.ts` converted to `useCursorPagedQuery`. Delete the `allPages.length * PAGE_SIZE` logic. Verify unseen-marker math in `useLastSeenAt.ts` still works.
- [ ] Any filter params (`user_id`, `restaurant_id`, etc.) continue to compose with the cursor.

#### Server — `feed`

- [ ] Replace single-shot `.limit(200)` with cursor pagination. Envelope `{ rows, next_cursor, has_more }`.
- [ ] Cursor based on `(visited_at, id)` of the last entry in the page. Page size default 30, hard cap 50.
- [ ] `napkin-app/hooks/feed/useFeed.ts` converted to `useCursorPagedQuery`. Consumer in `app/(tabs)/feed.tsx` (or wherever the feed renders) uses `fetchNextPage` on scroll-end.
- [ ] End-of-feed state renders cleanly when `next_cursor === null`.

#### Server — `table-atlas?action=city-page`

- [ ] Paginate the restaurants array. Envelope `{ rows, next_cursor, has_more }`. Sort by something stable (last-visited-desc + restaurant id as tiebreak — document).
- [ ] Default page size 50, hard cap 100.
- [ ] `napkin-app/hooks/tables/useTableAtlasCity.ts` converted to `useCursorPagedQuery`.
- [ ] Atlas index (`city-index` action) can stay unpaginated if it's small (just a city list). Confirm row count bounds in tech design — if a Table can have 100+ cities, paginate this too.

#### Cross-cutting

- [ ] Grep the codebase for any remaining `allPages.length * PAGE_SIZE` or bare numeric-offset pagination. Convert all to cursor.
- [ ] Grep for `nextCursor` (camelCase reads of the wire shape) anywhere else in hooks; fix to `next_cursor`.
- [ ] Add a TypeScript shared type `CursorPage<T>` in `lib/pagination.ts` so edge-function types and client types stay in sync.

#### Testing plan

- [ ] **Seed data.** On a staging branch, seed one Table with:
  - 80 solo entries across 3 months, and
  - 12 rounds interspersed with the entries.
  Confirm `useTableActivity` produces a strictly monotonically non-increasing `sort_date` when scrolling through all 4 pages (20 per page). Zero duplicates, zero gaps, matches a straight `ORDER BY sort_date DESC` query against the unified view.
- [ ] **Diary.** User with 60+ entries: confirm page 2 loads, items don't repeat, `next_cursor` goes null at the end.
- [ ] **Feed.** User in 3 Tables with 300+ combined entries: confirm `useFeed` now scrolls past 200.
- [ ] **Atlas.** Table with 200+ restaurants in one city: confirm pagination works.
- [ ] **EXPLAIN.** For each endpoint, run `EXPLAIN ANALYZE` on the cursor query at page 0 and at a deep cursor (page 10+). Confirm no seq scans.

### Non-goals

- Do not change the UI on any screen. Render behavior should be identical except "can scroll further."
- Do not modify RLS (TICKET-034).
- Do not add prev-page navigation — one-way forward only.

### Definition of Done

- All listed endpoints use the envelope.
- All listed hooks use `useCursorPagedQuery`.
- Seed-data test above confirms no duplicates or gaps.
- EXPLAIN results in build log.
- CLAUDE.md updated with the pagination subsection.

---

## Technical Design

### Approach

Introduce one canonical pagination envelope — `{ rows, next_cursor, has_more }` — and one client helper — `useCursorPagedQuery` — used by every paginated endpoint. Cursors are opaque base64 strings encoding a `(sort_date, tiebreak_id)` tuple; the server decodes them and applies a keyset predicate `WHERE (sort_date, id) < (cursor_date, cursor_id)` under a `ORDER BY sort_date DESC, id DESC` sort. The four endpoints (`user-profile?action=diary`, `table-activity`, `feed`, `table-atlas?action=city-page`) are migrated in a single bundled deploy since each wire shape is breaking. For `table-activity`, the split-offset in-memory merge is replaced with an **inline SQL UNION** in the edge function — no schema view — giving a single cursor over the merged stream.

### Architecture Decisions

- **Cursor format**: opaque base64 of `${iso}|${uuid}`. Server encodes/decodes. Client treats as a black-box string. Chose opaque over a structured JSON cursor because it's simpler, smaller over the wire, and locks clients out of over-interpreting it. Trade-off: debugging requires base64-decoding by hand.
- **Tuple cursor `(sort_date, id)` not single `sort_date`**: handles same-timestamp rows without dropping or duplicating. Trade-off: composite keyset predicate is mildly more verbose than a scalar `<` filter (but PostgreSQL optimizes `(col1, col2) < (v1, v2)` with a single index seek given a matching composite index).
- **Inline UNION over a `v_table_activity` view for `table-activity`**: keeps the schema surface flat and avoids a migration artifact that only one edge function queries. Trade-off: the UNION is duplicated inside the edge function rather than DRY'd in SQL — acceptable because it only lives in one place. See §2 below.
- **Snake_case on the wire, camelCase at the TypeScript boundary**: consistent with `wishlist` and the rest of the project's RPC shape. The hook's `Page<T>` type uses `next_cursor` / `has_more` verbatim so misreads can't regress to camelCase.
- **Single bundled deploy**: these are breaking changes on endpoints with exactly one consumer (this app). A bundled edge-function + client-hook deploy is simpler than introducing versioned actions.
- **Keep `wishlist` pattern mostly as-is, but upgrade its cursor**: wishlist's current cursor is a bare ISO timestamp on `created_at`. Out of scope for this ticket but flag for later — when the first `wishlist` pagination duplicate appears it'll need the tuple form too. Not blocking.

### 1. Cursor encoding + decoding

**Format**: `base64url(${iso8601}|${uuid})`. Example plaintext: `2026-04-18T21:34:22.123Z|c1a0c9e4-8b2f-4a3d-9e1b-7f2a3b4c5d6e`.

**Shared helper** — put in `supabase/functions/_shared/pagination.ts`:

```ts
// supabase/functions/_shared/pagination.ts
export type CursorTuple = { sort_date: string; id: string };

export function encodeCursor(c: CursorTuple): string {
    return btoa(`${c.sort_date}|${c.id}`);
}

export function decodeCursor(s: string | null | undefined): CursorTuple | null {
    if (!s) return null;
    try {
        const plain = atob(s);
        const pipe = plain.indexOf('|');
        if (pipe < 0) return null;
        const sort_date = plain.slice(0, pipe);
        const id = plain.slice(pipe + 1);
        if (!sort_date || !id) return null;
        return { sort_date, id };
    } catch { return null; }
}

export type Page<Row> = {
    rows: Row[];
    next_cursor: string | null;
    has_more: boolean;
};

// Build an envelope given raw rows + page size. Assumes rows were queried with
// `.limit(pageSize + 1)` so `hasMore = rows.length > pageSize`. Caller passes
// a getter to extract `(sort_date, id)` from the last kept row.
export function buildPage<Row>(
    rows: Row[],
    pageSize: number,
    getCursor: (r: Row) => CursorTuple,
): Page<Row> {
    const has_more = rows.length > pageSize;
    const kept = has_more ? rows.slice(0, pageSize) : rows;
    const last = kept[kept.length - 1];
    const next_cursor = has_more && last ? encodeCursor(getCursor(last)) : null;
    return { rows: kept, next_cursor, has_more };
}
```

**Decoding strategy**: decode in the edge function, not in SQL. No SQL helper function — we don't need it; three of four endpoints already run in TS and the cursor is only touched at the query-building step. Avoids a schema artifact, and EXPLAIN remains straightforward.

**SQL predicate**: for `ORDER BY sort_date DESC, id DESC`, the keyset filter is:

```sql
WHERE (sort_date, id) < ($cursor_sort_date, $cursor_id)
```

In supabase-js this is awkward because the query builder doesn't directly support tuple comparison. Three of the four endpoints must use `.or()` with the decomposed form:

```ts
// Equivalent to (sort_date, id) < (d, i)
query = query.or(
    `sort_date.lt.${d},and(sort_date.eq.${d},id.lt.${i})`
);
```

Wrap this as `applyKeysetFilter(query, column, cursor)` in the shared file so each endpoint calls it identically. For `table-activity` where the query is raw SQL via `rpc()` (see §2), use the tuple predicate directly.

### 2. `table-activity` merged query strategy

**Decision: inline UNION in the edge function, executed via a one-off `rpc()` to a tiny SQL function. No view.**

Rationale:
- A `v_table_activity` view is structurally clean but creates a schema artifact the rest of the code doesn't consume; migrations and RLS alignment become extra work.
- A CTE-with-supabase-js is not possible through the JS client without `.rpc()` anyway; once we're reaching for `rpc()` we may as well keep the SQL scoped to this feature.
- Rounds and entries already have different column sets; the UNION must project a common shape anyway. An inline UNION in an RPC function is the least-surface-area path.

**Shape** — add migration `supabase/migrations/2026xxxx_table_activity_rpc.sql`:

```sql
create or replace function fn_table_activity_page(
    p_table_id uuid,
    p_cursor_date timestamptz,   -- null → first page
    p_cursor_id uuid,            -- null → first page
    p_limit int,                 -- caller passes pageSize + 1
    p_filter_type text,          -- null | 'round' | 'solo_share'
    p_filter_user_id uuid        -- null for no filter
) returns table (
    kind text,                   -- 'entry' | 'table_night'
    id uuid,
    sort_date timestamptz,
    payload jsonb                -- full row as jsonb — edge function hydrates
) language sql stable as $$
    with entries_stream as (
        select
            'entry'::text as kind,
            e.id,
            coalesce(e.visited_at, e.created_at) as sort_date,
            to_jsonb(e) as payload
        from entries e
        where e.table_id = p_table_id
          and e.table_night_id is null
          and (p_filter_type is null or p_filter_type = 'solo_share')
          and (p_filter_user_id is null or e.user_id = p_filter_user_id
               or exists (select 1 from entry_companions ec
                          where ec.entry_id = e.id and ec.user_id = p_filter_user_id))
    ),
    nights_stream as (
        select
            'table_night'::text as kind,
            n.id,
            coalesce(n.revealed_at, n.created_at) as sort_date,
            to_jsonb(n) as payload
        from table_nights n
        where n.table_id = p_table_id
          and n.status in ('rating', 'revealed', 'closed')
          and (p_filter_type is null or p_filter_type = 'round')
          and (p_filter_user_id is null
               or exists (select 1 from table_night_participants p
                          where p.table_night_id = n.id and p.user_id = p_filter_user_id))
    ),
    unified as (
        select * from entries_stream
        union all
        select * from nights_stream
    )
    select kind, id, sort_date, payload
    from unified
    where p_cursor_date is null
       or (sort_date, id) < (p_cursor_date, p_cursor_id)
    order by sort_date desc, id desc
    limit p_limit;
$$;

-- Support index for the keyset scan per-stream
create index if not exists idx_entries_table_solo_sort
    on entries (table_id, coalesce(visited_at, created_at) desc, id desc)
    where table_night_id is null;

create index if not exists idx_table_nights_table_sort
    on table_nights (table_id, coalesce(revealed_at, created_at) desc, id desc);
```

The edge function:
1. Calls `supabase.rpc('fn_table_activity_page', {...})` with `p_limit = PAGE_SIZE + 1`.
2. Iterates returned rows, splitting by `kind`. For each `kind='entry'` row, fetches the existing hydration (profiles, participants, photos, companions, reactions — the same per-entry fan-out as today). For `kind='table_night'`, fetches participants + reactions. Hydration runs on the already-paginated 20-row window, not on unbounded data.
3. Builds the envelope with `buildPage(rows, PAGE_SIZE, r => ({ sort_date: r.sort_date, id: r.id }))`.

**The current `entry_companions`-widening pass is folded into the CTE** (see `entries_stream`): an entry is included if the caller is its author *or* a companion on it, provided it belongs to this Table. This replaces the post-query merge.

**Alternative considered**: a SQL view `v_table_activity`. Documented for traceability but not chosen — a one-off RPC is cheaper to ship, revert, and reason about than adding a view to the schema.

### 3. Client helper — `useCursorPagedQuery`

Put in `napkin-app/lib/pagination.ts`.

```ts
import {
    useInfiniteQuery,
    type QueryKey,
    type UseInfiniteQueryOptions,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type Page<T> = { rows: T[]; next_cursor: string | null; has_more: boolean };

export type CursorPagedQueryArgs<T> = {
    queryKey: QueryKey;
    fetchPage: (cursor: string | null, token: string | null) => Promise<Page<T>>;
    enabled?: boolean;
    staleTime?: number;
};

export function useCursorPagedQuery<T>(args: CursorPagedQueryArgs<T>) {
    return useInfiniteQuery<Page<T>, Error>({
        queryKey: args.queryKey,
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const { data: { session } } = await supabase.auth.getSession();
            return args.fetchPage(
                (pageParam as string | null) ?? null,
                session?.access_token ?? null,
            );
        },
        getNextPageParam: (last) => last.next_cursor ?? undefined,
        enabled: args.enabled ?? true,
        staleTime: args.staleTime ?? 1000 * 60 * 2,
    });
}

// Selector helper — the universal `allPages.flat()` replacement.
export function flattenPages<T>(data: { pages: Page<T>[] } | undefined): T[] {
    return data?.pages.flatMap((p) => p.rows) ?? [];
}
```

The helper owns: session fetching, canonical `getNextPageParam`, default `staleTime`, and the `Page<T>` wire shape. Each hook supplies only `queryKey` + a minimal `fetchPage(cursor, token) => Page<T>` closure — typically 10 lines. The hook file no longer imports `useInfiniteQuery` directly.

### 4. Per-endpoint change list

#### `user-profile?action=diary`

- **Current wire**: `{ data: { rows, next_cursor } }`. Client reads `nextCursor` (wrong). `yearSummary` is declared by client but never sent.
- **New wire**: `{ data: { rows, next_cursor, has_more } }`. Drop `yearSummary` from the type.
- **Cursor**: `(visited_at, id)`. Sort: `ORDER BY visited_at DESC, id DESC` (drop the secondary `created_at` order — the id tiebreak replaces it, and the existing double-order makes cursor math annoying).
- **Query change**: `fetchDiary` returns `Page<DiaryRow>`; use `buildPage()`. Tie-break `id` becomes the entry UUID.
- **Client**: `useUserDiary` switches to `useCursorPagedQuery`. Drop `YearSummary` type from the file. Consumers flatten via `flattenPages(data)`.

#### `table-activity`

- **Current wire**: `{ data: ActivityItem[] }`. Numeric `offset` param.
- **New wire**: `{ data: { rows, next_cursor, has_more } }`. `cursor` body param (string | null). `offset` removed.
- **Migration**: call the new RPC, hydrate the merged page, build the envelope. Filters compose normally — they are RPC args.
- **Client**: `useTableActivity` uses `useCursorPagedQuery`. Delete `allPages.length * PAGE_SIZE`. Consumers in `app/(tabs)/tables.tsx`, `app/looking-back.tsx`, `app/seed-from-solo.tsx` already do `data?.pages?.flat() ?? []` — change to `flattenPages(data)`. Shape of individual items is unchanged, so downstream components don't need edits.
- **Request shape change**: switch from GET-with-query-string to POST-with-JSON-body, to match wishlist/user-profile and carry the cursor cleanly (GET query-string base64 cursors work but stir up URL-length worries on deep-cursor calls later). Explicit breaking change — note in the deploy notes.

#### `feed`

- **Current wire**: `{ data: { entries, trending, windowDays } }`. No pagination.
- **New wire**: `{ data: { rows, next_cursor, has_more, trending, window_days } }`. `rows` replaces `entries`. `trending` and `window_days` stay on the *first* page response; subsequent pages may return `trending: null` to avoid recomputation cost.
- **Reasoning**: trending is computed over the full window and belongs alongside the first page only. Client keeps showing whatever trending it has from page 1 — don't refetch trending on paginate.
- **Cursor**: `(visited_at || created_at, id)`. Default page size 30, hard cap 50. `window_days` still applied as a filter.
- **Client**: `useFeed` becomes `useCursorPagedQuery`. `FeedPayload` becomes `{ entries: FeedEntry[]; trending: TrendingPoster[]; windowDays: number }` computed at the consumer boundary from page[0]. `app/(tabs)/feed.tsx` wires `fetchNextPage` onto the ScrollView's end-reached, uses `flattenPages` for `entries`, and reads `trending` from `data?.pages?.[0]?.trending ?? []`.

#### `table-atlas?action=city-page`

- **Current wire**: `{ data: { city, city_stats, restaurants } }`.
- **New wire**: `{ data: { city, city_stats, rows, next_cursor, has_more } }`. `rows` replaces `restaurants`. Default 50, cap 100.
- **Sort / cursor**: sort tiles by `last_visit_date DESC, restaurant_id DESC`. Cursor is `(last_visit_date, restaurant_id)`.
- **Implementation nuance**: currently restaurants are aggregated in memory across *all* solo entries + rounds in the city (potentially thousands of rows) and only sliced at the end. This must flip — pull restaurants keyset-sorted first (paginated), then per-tile aggregate only the visits for the 50 restaurants in that page. Requires a supporting SQL step: a per-table-per-city restaurant list keyed by `max(visit_date)`, with keyset filter. A small RPC `fn_atlas_city_restaurants(p_table_id, p_city, p_cursor_date, p_cursor_id, p_limit)` that returns `(restaurant_id, last_visit_date)` is the cleanest path. Remaining hydration stays in TS.
- **`city-index` stays unpaginated**: cities-per-table is bounded by dining breadth; a Table with 50+ distinct cities is not realistic for v1. Flag as follow-up if any Table crosses ~30 cities.
- **Client**: `useTableAtlasCity` switches to `useCursorPagedQuery`. Consumers flatten `rows` and read `city_stats` from `pages[0]`.

### 5. Unseen-marker preservation

The unseen-dot logic is already per-card: each card receives `sort_date` + `lastSeenAt` and computes `isUnseen = !lastSeenAt || sort_date > lastSeenAt` locally (see `JournalNoteCard.tsx:90`, `SoloShareCard.tsx:56`, `TableNightCard.tsx:68`). The consumer in `app/(tabs)/tables.tsx` already flattens pages via `activityData?.pages?.flat() ?? []` (line 119).

**Change**: replace `data?.pages?.flat()` with `flattenPages(data)` because the cache shape changes from `Page[] where Page = ActivityItem[]` to `Page<ActivityItem>[] where Page = { rows, next_cursor, has_more }`. The card-level unseen computation is unchanged because individual item shapes are unchanged and `sort_date` still flows through.

`useLastSeenAt` itself does not touch `tableActivity` cache — it reads a separate `tableLastSeen` query. No changes there.

**No selector refactor needed**. `flattenPages` is the one-line adjustment.

### 6. Query key additions / changes

Minimal. The infinite-query key no longer carries cursor (cursor lives in `pageParam`, not the key).

`queryKeys.users.diary`: currently `(userId, cursor)` — strip the cursor overload. Key becomes `['users', 'diary', userId]`. `cursor` was only passed on the URL-driven prefetch path; confirm no external callers rely on it by grepping before deleting.

`queryKeys.atlas.city`: no change — `(tableId, city)` is still the right key; cursor lives in pageParam.

`queryKeys.tables.activity`: no change.

`queryKeys.feed.all`: no change.

**Overlap with TICKET-039**: that ticket also edits `lib/queryKeys.ts`. Keep changes here surgical and additive (single diary-key simplification) so merge conflicts are trivial. Do not reorganize the file.

### 7. Typing strategy

- `Page<T>` lives in `napkin-app/lib/pagination.ts` — the single source on the client.
- A parallel `Page<T>` type lives in `supabase/functions/_shared/pagination.ts` — the single source on the server. The two are structurally identical but intentionally duplicated because we don't have generated types and share no TS compilation across edge-function and app.
- Per-endpoint row types (`DiaryRow`, `ActivityItem`, `FeedEntry`, `AtlasRestaurantTile`) stay in their existing hook files. They are the T in `Page<T>`.
- No shared DTO file. Keeps server and client independently deployable. The envelope invariant is enforced by: (a) both sides importing their own `Page<T>`, (b) a single `useCursorPagedQuery` that typechecks the wire shape on read.
- Add a code comment at the top of `lib/pagination.ts` pointing to the server twin so a future reader spots the duplication as deliberate.

### 8. Migration order / deploy sequencing

**Single bundled deploy.** All four endpoints break their wire shape; each has exactly one client. Shipping them one at a time is strictly worse than shipping together — there is no traffic pattern that benefits from partial rollout, and each endpoint has complete code-owner overlap.

**Order within the PR** (to keep commits reviewable, but shipped as one):

1. Add `supabase/functions/_shared/pagination.ts` + migration for `fn_table_activity_page` + supporting indexes + `fn_atlas_city_restaurants`.
2. Add `napkin-app/lib/pagination.ts` (`useCursorPagedQuery`, `flattenPages`, `Page<T>`).
3. Flip `user-profile?action=diary` — smallest blast radius, simplest keyset. Validates the pattern on the server and the helper on the client in one diagonal slice.
4. Flip `table-atlas?action=city-page` — next simplest, single consumer.
5. Flip `feed` — requires the `trending` split into page-0-only handling.
6. Flip `table-activity` last — biggest change (RPC, hydration refactor, companion-widening fold, request-shape change).
7. Update `CLAUDE.md` with the Pagination subsection. Grep cleanup for residual `nextCursor` / `allPages.length * PAGE_SIZE`.

**Migration safety**: the migration file only adds functions + indexes — no destructive DDL, no RLS change. Can ship in the same PR as the edge-function deploys without a separate DB window.

**Rollback**: revert the PR; the app is back to pre-change. The new SQL function and indexes are inert if not called — safe to leave in place on rollback.

### File Changes

- `supabase/functions/_shared/pagination.ts` — NEW — `Page<T>`, `encodeCursor`, `decodeCursor`, `buildPage`, `applyKeysetFilter`.
- `supabase/migrations/2026xxxx_pagination_rpcs.sql` — NEW — `fn_table_activity_page`, `fn_atlas_city_restaurants`, supporting indexes.
- `supabase/functions/user-profile/index.ts` — MODIFY — `fetchDiary` returns `Page<DiaryRow>`, drops secondary `created_at` sort, wires `buildPage`. Diary action returns envelope.
- `supabase/functions/table-activity/index.ts` — MODIFY — replace split-offset with `rpc('fn_table_activity_page')`, hydrate page rows only, return envelope. Switch from GET to POST.
- `supabase/functions/feed/index.ts` — MODIFY — keyset pagination on entries. Return envelope plus `trending` / `window_days` on page-0 only.
- `supabase/functions/table-atlas/index.ts` — MODIFY — `handleCityPage` paginates via `rpc('fn_atlas_city_restaurants')`; hydrates tiles for the page only. `handleCityIndex` unchanged.
- `napkin-app/lib/pagination.ts` — NEW — `useCursorPagedQuery`, `Page<T>`, `flattenPages`.
- `napkin-app/hooks/users/useUserDiary.ts` — MODIFY — swap to `useCursorPagedQuery`, delete `YearSummary`, consumer reads `next_cursor`.
- `napkin-app/hooks/tables/useTableActivity.ts` — MODIFY — swap to `useCursorPagedQuery`, POST body with `cursor`, drop `PAGE_SIZE * allPages.length`.
- `napkin-app/hooks/feed/useFeed.ts` — MODIFY — swap `useQuery` → `useCursorPagedQuery`. Export `trending` / `windowDays` via a selector or document that consumers read from `pages[0]`.
- `napkin-app/hooks/tables/useTableAtlasCity.ts` — MODIFY — swap to `useCursorPagedQuery`; expose `city_stats` from `pages[0]`.
- `napkin-app/app/(tabs)/tables.tsx` — MODIFY — swap `data?.pages?.flat()` → `flattenPages(data)`.
- `napkin-app/app/(tabs)/feed.tsx` — MODIFY — wire `fetchNextPage` to scroll-end, flatten entries, read trending off page 0.
- `napkin-app/app/looking-back.tsx`, `app/seed-from-solo.tsx` — MODIFY — use `flattenPages`.
- `napkin-app/lib/queryKeys.ts` — MODIFY — simplify `users.diary` to drop cursor overload. Keep changes minimal to avoid TICKET-039 conflicts.
- `CLAUDE.md` — MODIFY — add Pagination subsection under Code Patterns.

### 9. Risks & open questions

- **Deep-cursor performance on `fn_table_activity_page`**: the keyset filter fires after the UNION, so the planner may scan further than ideal before the LIMIT bites. The supporting partial indexes (`idx_entries_table_solo_sort`, `idx_table_nights_table_sort`) are designed to let each stream answer `WHERE table_id = ? AND (sort_date, id) < (?, ?) ORDER BY ... LIMIT 21` as a direct index-range scan. EXPLAIN at page 0 *and* at a deep cursor (40+ pages) is required per the ticket's test plan. If the planner regresses, fall back to `rows from (select ... limit 21) a union all select ... from (select ... limit 21) b order by ... limit 21` to force per-stream bounded scans.
- **Filter composition on `fn_table_activity_page`**: encoding the companion-widening into a CTE means an entry is included when the caller (or the `filter_user_id`, depending on semantics) is a companion. Confirm the intended semantics match the current behavior — the old code widens for the *caller* regardless of `filter_user_id`. Keep the same rule: caller-companion widening is unconditional, and `filter_user_id` scopes the non-widened slice. Double-check during implementation — behavior change here would be invisible in most tests but affect companion-tagged reads.
- **`table-activity` request-shape change (GET → POST)**: strictly a client-side change, but it flips how the edge function routes. Confirm no other tooling (health checks, logging) probes it by GET.
- **`feed` trending on subsequent pages**: deciding to send `null` on page 2+ keeps latency down but is one more thing the consumer must handle. Alternative: keep computing (cheap enough, the window is capped). Defer: start with `null` on page 2+, revisit if consumers want rolling recomputation.
- **`wishlist` cursor upgrade**: out of scope, but it uses a scalar `created_at` cursor with no tiebreak — same bug class. Flagged as follow-up once this ticket's pattern is proven.
- **Open**: do we need to add `Prefer: count=exact` anywhere? No — the envelope intentionally omits a total count because keyset pagination doesn't cheaply know one. If any consumer wants "N of M" UX later, it's a separate count endpoint, not a pagination field.
