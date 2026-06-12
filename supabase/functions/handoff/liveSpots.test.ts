/**
 * liveSpots.test.ts — TICKET-077
 *
 * Tests loadLiveSpots, the SINGLE source of truth for what a share shows
 * (live read at view time; shared by handoff/share-page/resolve-url).
 *
 * The security-critical pieces are exercised here against a fake supabase
 * client (no live DB / network):
 *   - verified-only filter (unverified rows never surface, even live)
 *   - ordering: wishlist created_at DESC; list ranked→position ASC, else created_at DESC
 *   - owner-rating enrichment (the OWNER's most-recent rating per restaurant)
 *   - sharer_name = first token of the owner's CURRENT display_name
 *   - list_name = the list's CURRENT title (null for wishlist)
 *   - deleted/unowned list → null (caller tombstones, never crashes)
 *
 * The fake client records the filters each query applied so we can assert that
 * loadLiveSpots filters verification='verified' and orders correctly, then
 * returns rows the test stages. It mirrors the real PostgREST chain shape:
 * from(table).select(...).eq(...).is(...).not(...).in(...).order(...).maybeSingle().
 */

import {
    assertEquals,
    assertStrictEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { loadLiveSpots, type LiveSpotsClient } from './snapshot.ts';

// ── Fake supabase client ──────────────────────────────────────────────────────

interface QueryLog {
    table: string;
    eq: Record<string, unknown>;
    is: Record<string, unknown>;
    not: Array<[string, string, unknown]>;
    in: Record<string, unknown[]>;
    order: Array<{ column: string; ascending: boolean }>;
}

/**
 * Build a fake client.
 * `tables` maps a table name → the rows that query should resolve to. For
 * single-row reads (lists, profiles) the handler calls .maybeSingle() and gets
 * rows[0] ?? null. For multi-row reads it awaits the builder (thenable) → { data }.
 * `log` collects every query's applied filters for assertions.
 */
function fakeClient(tables: Record<string, any[]>): { client: LiveSpotsClient; log: QueryLog[] } {
    const log: QueryLog[] = [];

    const makeBuilder = (table: string) => {
        const entry: QueryLog = { table, eq: {}, is: {}, not: [], in: {}, order: [] };
        log.push(entry);
        const rows = tables[table] ?? [];

        const builder: any = {
            select: () => builder,
            eq: (col: string, val: unknown) => { entry.eq[col] = val; return builder; },
            is: (col: string, val: unknown) => { entry.is[col] = val; return builder; },
            not: (col: string, op: string, val: unknown) => { entry.not.push([col, op, val]); return builder; },
            in: (col: string, vals: unknown[]) => { entry.in[col] = vals; return builder; },
            order: (column: string, opts: { ascending: boolean }) => {
                entry.order.push({ column, ascending: opts.ascending });
                return builder;
            },
            maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
            // Multi-row reads await the builder directly (PostgREST builders are thenable).
            then: (resolve: (v: { data: any[]; error: null }) => void) =>
                resolve({ data: rows, error: null }),
        };
        return builder;
    };

    return { client: { from: (table: string) => makeBuilder(table) }, log };
}

const OWNER = 'owner00-0000-4000-8000-000000000001';

// ── Wishlist shares (listId = null) ───────────────────────────────────────────

Deno.test('loadLiveSpots(wishlist): verified-only filter + created_at DESC order applied', async () => {
    const { client, log } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'Berenjak', city: 'London', cuisine: 'Persian', verification: 'verified' } },
            { restaurant_id: 'r2', restaurant: { id: 'r2', name: 'Kono', city: 'NY', cuisine: 'Japanese', verification: 'verified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky Ng' }],
    });

    const live = await loadLiveSpots(client, OWNER, null);

    // The wishlist_items query must filter verification='verified' and order created_at DESC.
    const wlQuery = log.find((q) => q.table === 'wishlist_items')!;
    assertEquals(wlQuery.eq['restaurant.verification'], 'verified');
    assertEquals(wlQuery.eq['user_id'], OWNER);
    assertEquals(wlQuery.is['deleted_at'], null);
    assertEquals(wlQuery.order, [{ column: 'created_at', ascending: false }]);

    assertEquals(live!.list_name, null);
    assertEquals(live!.spots.map((s) => s.name), ['Berenjak', 'Kono']);
});

Deno.test('loadLiveSpots(wishlist): drops unverified rows (defence-in-depth even after SQL filter)', async () => {
    // The fake returns an unverified row as if SQL leaked it — buildSnapshotInput must drop it.
    const { client } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'Berenjak', city: 'London', cuisine: 'Persian', verification: 'verified' } },
            { restaurant_id: 'r2', restaurant: { id: 'r2', name: 'Ghosty', city: null, cuisine: null, verification: 'unverified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky' }],
    });

    const live = await loadLiveSpots(client, OWNER, null);
    assertEquals(live!.spots.map((s) => s.name), ['Berenjak']);
});

Deno.test('loadLiveSpots(wishlist): owner rating enrichment — owner most-recent rating per restaurant; misses null', async () => {
    const { client, log } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'Berenjak', city: 'London', cuisine: 'Persian', verification: 'verified' } },
            { restaurant_id: 'r2', restaurant: { id: 'r2', name: 'Kono', city: 'NY', cuisine: 'Japanese', verification: 'verified' } },
        ],
        // entries ordered created_at DESC by the query → first per restaurant wins.
        entries: [
            { restaurant_id: 'r1', rating: 4.6, created_at: '2026-06-10T00:00:00Z' },
            { restaurant_id: 'r1', rating: 3.0, created_at: '2026-06-01T00:00:00Z' },
        ],
        profiles: [{ display_name: 'Jacky' }],
    });

    const live = await loadLiveSpots(client, OWNER, null);

    // The entries query must scope to the OWNER and only the listed restaurant_ids.
    const entriesQuery = log.find((q) => q.table === 'entries')!;
    assertEquals(entriesQuery.eq['user_id'], OWNER);
    assertEquals(entriesQuery.in['restaurant_id'], ['r1', 'r2']);

    assertEquals(live!.spots[0].rating, 4.6); // most-recent wins
    assertStrictEquals(live!.spots[1].rating, null); // no rating row → null
});

Deno.test('loadLiveSpots(wishlist): sharer_name = first token of CURRENT display_name', async () => {
    const { client } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'A', city: null, cuisine: null, verification: 'verified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky Ng' }],
    });
    const live = await loadLiveSpots(client, OWNER, null);
    assertEquals(live!.sharer_name, 'Jacky');
});

Deno.test('loadLiveSpots(wishlist): missing profile → sharer_name falls back to "someone"', async () => {
    const { client } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'A', city: null, cuisine: null, verification: 'verified' } },
        ],
        entries: [],
        profiles: [],
    });
    const live = await loadLiveSpots(client, OWNER, null);
    assertEquals(live!.sharer_name, 'someone');
});

Deno.test('loadLiveSpots(wishlist): empty verified set → empty spots (valid, NOT null)', async () => {
    const { client, log } = fakeClient({
        wishlist_items: [],
        profiles: [{ display_name: 'Jacky' }],
    });
    const live = await loadLiveSpots(client, OWNER, null);
    assertEquals(live!.spots.length, 0);
    assertEquals(live!.list_name, null);
    // No spots → skip the entries query entirely (no rating lookup).
    assertEquals(log.some((q) => q.table === 'entries'), false);
});

// ── List shares (listId set) ──────────────────────────────────────────────────

const LIST_ID = 'list000-0000-4000-8000-0000000000aa';

Deno.test('loadLiveSpots(list, ranked): position ASC order + list ownership filter + list_name from CURRENT title', async () => {
    const { client, log } = fakeClient({
        lists: [{ id: LIST_ID, title: 'Tokyo trip', ranked: true }],
        list_entries: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'First', city: 'Tokyo', cuisine: 'Sushi', verification: 'verified' } },
            { restaurant_id: 'r2', restaurant: { id: 'r2', name: 'Second', city: 'Tokyo', cuisine: 'Ramen', verification: 'verified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky' }],
    });

    const live = await loadLiveSpots(client, OWNER, LIST_ID);

    const listQuery = log.find((q) => q.table === 'lists')!;
    assertEquals(listQuery.eq['id'], LIST_ID);
    assertEquals(listQuery.eq['owner_id'], OWNER); // ownership gate

    const entriesQuery = log.find((q) => q.table === 'list_entries')!;
    assertEquals(entriesQuery.eq['restaurant.verification'], 'verified');
    assertEquals(entriesQuery.eq['list_id'], LIST_ID);
    assertEquals(entriesQuery.order, [{ column: 'position', ascending: true }]);

    assertEquals(live!.list_name, 'Tokyo trip');
    assertEquals(live!.spots.map((s) => s.name), ['First', 'Second']);
});

Deno.test('loadLiveSpots(list, unranked): created_at DESC order', async () => {
    const { client, log } = fakeClient({
        lists: [{ id: LIST_ID, title: 'date spots', ranked: false }],
        list_entries: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'Newest', city: 'London', cuisine: 'Persian', verification: 'verified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky' }],
    });

    await loadLiveSpots(client, OWNER, LIST_ID);
    const entriesQuery = log.find((q) => q.table === 'list_entries')!;
    assertEquals(entriesQuery.order, [{ column: 'created_at', ascending: false }]);
});

Deno.test('loadLiveSpots(list): deleted / not-owned list → null (caller tombstones, no crash)', async () => {
    const { client } = fakeClient({
        lists: [], // list row missing (deleted) OR owner_id mismatch → maybeSingle null
        profiles: [{ display_name: 'Jacky' }],
    });
    const live = await loadLiveSpots(client, OWNER, LIST_ID);
    assertStrictEquals(live, null);
});

Deno.test('loadLiveSpots(list): existing list with all-unverified entries → empty spots (valid page, not null)', async () => {
    const { client } = fakeClient({
        lists: [{ id: LIST_ID, title: 'Tokyo trip', ranked: true }],
        list_entries: [], // SQL verified filter returned nothing
        entries: [],
        profiles: [{ display_name: 'Jacky' }],
    });
    const live = await loadLiveSpots(client, OWNER, LIST_ID);
    assertEquals(live!.spots.length, 0);
    assertEquals(live!.list_name, 'Tokyo trip');
});

// ── Spot shape (carries restaurant_id for resolve nonce + pin validation) ─────

Deno.test('loadLiveSpots: spots carry restaurant_id (consumed by nonce derivation + pin guard)', async () => {
    const { client } = fakeClient({
        wishlist_items: [
            { restaurant_id: 'r1', restaurant: { id: 'r1', name: 'A', city: null, cuisine: null, verification: 'verified' } },
        ],
        entries: [],
        profiles: [{ display_name: 'Jacky' }],
    });
    const live = await loadLiveSpots(client, OWNER, null);
    assertEquals(live!.spots[0].restaurant_id, 'r1');
});
