/**
 * Pins the drip outage that failed every daily Critics ingestion run from
 * 2026-07-11: a NULL restaurant_id (a place-only entry, or a wishlist_item
 * whose import is still resolving) reached `.in('id', ...)`, postgrest-js sent
 * it as the bare word `null`, and Postgres killed the whole run with
 * `invalid input syntax for type uuid: "null"`.
 *
 * The loaders run through a real supabase-js client whose fetch is a small
 * in-memory PostgREST. Like PostgREST v13 (checked against a local instance),
 * it answers a non-uuid value in a uuid filter with 400 / 22P02.
 *
 * Run with:
 *   deno test --allow-env scripts/critics-ingest/tests/
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// Same pinned build as lib/supabase.ts, so the URL serialisation under test is prod's.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
    distinctRestaurantIds,
    loadDripRestaurants,
    loadUserTouchedRestaurants,
    SCRAPE_STALENESS_DAYS,
} from '../lib/restaurants.ts';

// ── In-memory PostgREST ────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type FilterResult = { rows: Row[] } | { error: Record<string, unknown> };

const UUID_COLUMNS = new Set(['id', 'restaurant_id']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidCastError(value: string): FilterResult {
    return {
        error: { code: '22P02', details: null, hint: null, message: `invalid input syntax for type uuid: "${value}"` },
    };
}

/** Applies one PostgREST query-string filter: the subset the loaders use. */
function applyFilter(rows: Row[], column: string, expr: string): FilterResult {
    const dot = expr.indexOf('.');
    const op = expr.slice(0, dot);
    const operand = expr.slice(dot + 1);
    const values = op === 'in' ? operand.replace(/^\(|\)$/g, '').split(',') : [operand];

    if (UUID_COLUMNS.has(column) && (op === 'eq' || op === 'in')) {
        const bad = values.find((v) => !UUID_RE.test(v));
        if (bad !== undefined) return uuidCastError(bad);
    }

    switch (op) {
        case 'eq':
            return { rows: rows.filter((r) => r[column] === operand) };
        case 'gte':
            // ISO-8601 UTC timestamps compare correctly as strings.
            return { rows: rows.filter((r) => String(r[column]) >= operand) };
        case 'in':
            return { rows: rows.filter((r) => values.includes(String(r[column]))) };
        case 'not':
            if (operand === 'is.null') return { rows: rows.filter((r) => r[column] != null) };
            break;
    }
    throw new Error(`in-memory PostgREST: unsupported filter ${column}=${expr}`);
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeSupabase(tables: Tables) {
    const tablesRead: string[] = [];

    const respond = (input: RequestInfo | URL): Response => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const table = url.pathname.replace(/^\/rest\/v1\//, '');
        tablesRead.push(table);

        let rows = tables[table] ?? [];
        for (const [column, expr] of url.searchParams) {
            if (column === 'select') continue;
            const result = applyFilter(rows, column, expr);
            if ('error' in result) return json(400, result.error);
            rows = result.rows;
        }

        const columns = (url.searchParams.get('select') ?? '').split(',');
        return json(200, rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))));
    };
    // An unsupported filter rejects, the way a failed request would.
    const fetch = (input: RequestInfo | URL) => Promise.resolve(input).then(respond);

    const client = createClient('http://postgrest.test', 'test-service-role-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch },
    });
    return { client, tablesRead };
}

// ── Fixture ────────────────────────────────────────────────────────────────

const PADELLA = '11111111-1111-4111-8111-111111111111';
const BAO = '22222222-2222-4222-8222-222222222222';
const KILN = '33333333-3333-4333-8333-333333333333';
const BRAT = '44444444-4444-4444-8444-444444444444';

const DAY_MS = 24 * 60 * 60 * 1000;

function fixture(): Tables {
    const now = Date.now();
    return {
        restaurants: [PADELLA, BAO, KILN, BRAT].map((id, i) => ({
            id,
            name: ['Padella', 'Bao Soho', 'Kiln', 'Brat'][i],
            address: null,
            external_id: null,
        })),
        entries: [
            { restaurant_id: PADELLA },
            { restaurant_id: null }, // place-only entry
            { restaurant_id: BRAT },
        ],
        wishlist_items: [
            { restaurant_id: null }, // import still resolving
            { restaurant_id: BAO },
            { restaurant_id: KILN },
            { restaurant_id: PADELLA },
        ],
        critic_scrape_attempts: [
            // Recent for nyt: not eligible again yet.
            { restaurant_id: BRAT, publication: 'nyt', last_attempted_at: new Date(now - DAY_MS).toISOString() },
            // Past the staleness window: eligible again.
            {
                restaurant_id: KILN,
                publication: 'nyt',
                last_attempted_at: new Date(now - (SCRAPE_STALENESS_DAYS + 1) * DAY_MS).toISOString(),
            },
            // Recent, but for another publication.
            { restaurant_id: BAO, publication: 'infatuation', last_attempted_at: new Date(now).toISOString() },
        ],
    };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test('in-memory PostgREST rejects a null in a uuid in-filter, as prod did', async () => {
    const { client } = fakeSupabase(fixture());
    const { error } = await client
        .from('restaurants')
        .select('id')
        .in('id', [PADELLA, null as unknown as string]);
    assertEquals(error?.message, 'invalid input syntax for type uuid: "null"');
});

Deno.test('loadDripRestaurants skips NULL restaurant_ids instead of failing the run', async () => {
    const { client } = fakeSupabase(fixture());
    const batch = await loadDripRestaurants(client, 'nyt');
    // BRAT was attempted for nyt yesterday; KILN's attempt is stale.
    assertEquals(ids(batch), [PADELLA, BAO, KILN].sort());
});

Deno.test('loadDripRestaurants scopes recent attempts to the publication', async () => {
    const { client } = fakeSupabase(fixture());
    const batch = await loadDripRestaurants(client, 'infatuation');
    assertEquals(ids(batch), [PADELLA, KILN, BRAT].sort());
});

Deno.test('loadDripRestaurants returns nothing, without a restaurants query, when every reference is NULL', async () => {
    const { client, tablesRead } = fakeSupabase({
        ...fixture(),
        entries: [{ restaurant_id: null }],
        wishlist_items: [{ restaurant_id: null }],
    });
    assertEquals(await loadDripRestaurants(client, 'nyt'), []);
    assertEquals(tablesRead.includes('restaurants'), false);
});

Deno.test('loadUserTouchedRestaurants (backfill) skips NULL restaurant_ids', async () => {
    const { client } = fakeSupabase(fixture());
    const restaurants = await loadUserTouchedRestaurants(client);
    assertEquals(ids(restaurants), [PADELLA, BAO, KILN, BRAT].sort());
});

Deno.test('distinctRestaurantIds drops NULLs and duplicates, keeping first-seen order', () => {
    assertEquals(
        distinctRestaurantIds([
            { restaurant_id: BAO },
            { restaurant_id: null },
            { restaurant_id: PADELLA },
            { restaurant_id: BAO },
        ]),
        [BAO, PADELLA],
    );
});
