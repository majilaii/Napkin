import { assert, assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    handleSimilarAction,
    loadSimilarRestaurants,
    rankSimilarRestaurants,
    type SimilarCandidate,
    type SimilarClient,
} from './similar.ts';

const VIEWER = 'viewer-1';
const ORIGIN = { lat: 51.5, lng: -0.1 };

/** Candidate placed `north`/`east` metres from ORIGIN. */
function place(
    id: string,
    north: number,
    east: number,
    extra: Partial<SimilarCandidate> = {},
): SimilarCandidate {
    const lat = ORIGIN.lat + north / 111_320;
    const lng = ORIGIN.lng + east / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
    return {
        id,
        name: id,
        city: 'London',
        cuisine: null,
        price_level: null,
        photo_url: null,
        photo_source: null,
        places_photo_attribution_html: null,
        lat,
        lng,
        place_types: null,
        merged_into: null,
        verification: 'verified',
        created_by: 'someone-else',
        ...extra,
    };
}

const source = place('source', 0, 0, { cuisine: 'Thai', place_types: ['restaurant', 'thai_restaurant', 'bar'] });

Deno.test('ranks cuisine > type > nearby, each tier by distance', () => {
    const rows = rankSimilarRestaurants(source, [
        place('near-plain', 100, 0),
        place('type-far', 1_500, 0, { place_types: ['bar', 'food'] }),
        place('type-close', 900, 0, { place_types: ['thai_restaurant'] }),
        place('cuisine-far', 2_500, 0, { cuisine: 'thai' }),
        place('cuisine-close', 2_000, 0, { cuisine: 'THAI' }),
    ], { viewerId: VIEWER });

    assertEquals(rows.map((r) => r.id), [
        'cuisine-close', 'cuisine-far', 'type-close', 'type-far', 'near-plain',
    ]);
    assertEquals(rows.map((r) => r.match), ['cuisine', 'cuisine', 'type', 'type', 'nearby']);
});

Deno.test('generic cuisines and place types never count as a match', () => {
    const generic = place('generic-source', 0, 0, {
        cuisine: 'Restaurant',
        place_types: ['restaurant', 'food', 'point_of_interest', 'establishment', 'store'],
    });
    const rows = rankSimilarRestaurants(generic, [
        place('same-generic', 200, 0, { cuisine: 'restaurant', place_types: ['restaurant', 'food', 'store'] }),
        place('poi', 300, 0, { cuisine: 'Point Of Interest', place_types: ['point_of_interest'] }),
    ], { viewerId: VIEWER });

    assertEquals(rows.map((r) => r.match), ['nearby', 'nearby']);
});

Deno.test('drops anything farther than 5 km', () => {
    const rows = rankSimilarRestaurants(source, [
        place('inside', 4_900, 0),
        place('outside', 5_100, 0, { cuisine: 'Thai' }),
    ], { viewerId: VIEWER });

    assertEquals(rows.map((r) => r.id), ['inside']);
});

Deno.test('excludes self, merged aliases, coordinate-less rows and strangers’ unverified ghosts', () => {
    const rows = rankSimilarRestaurants(source, [
        place('source', 0, 0, { cuisine: 'Thai' }),
        place('alias', 50, 0, { merged_into: 'elsewhere' }),
        place('no-coords', 60, 0, { lat: null }),
        place('their-ghost', 70, 0, { verification: 'unverified' }),
        place('my-ghost', 80, 0, { verification: 'unverified', created_by: VIEWER }),
        place('open', 90, 0),
    ], { viewerId: VIEWER });

    assertEquals(rows.map((r) => r.id), ['my-ghost', 'open']);
});

Deno.test('caps at six rows and keeps integer distances', () => {
    const rows = rankSimilarRestaurants(source, [
        place('a', 1_234.5, 0), place('b', 1_000, 0), place('c', 900, 0), place('d', 800, 0),
        place('e', 700, 0), place('f', 600, 0), place('g', 500, 0), place('h', 400, 0),
    ], { viewerId: VIEWER });

    assertEquals(rows.length, 6);
    assertEquals(rows.map((r) => r.id), ['h', 'g', 'f', 'e', 'd', 'c']);
    for (const row of rows) assert(Number.isInteger(row.distance_m));
    const b = rankSimilarRestaurants(source, [place('b', 1_000, 0)], { viewerId: VIEWER })[0];
    assert(Math.abs(b.distance_m - 1_000) <= 1, `expected ~1000 m, got ${b.distance_m}`);
});

Deno.test('returns nothing when the source has no coordinates', () => {
    const blind = { ...source, lat: null };
    assertEquals(rankSimilarRestaurants(blind, [place('x', 10, 0)], { viewerId: VIEWER }), []);
});

interface Call {
    method: string;
    args: unknown[];
}

function fakeClient(rows: SimilarCandidate[]): { client: SimilarClient; calls: Call[] } {
    const calls: Call[] = [];
    const from = (table: string) => {
        calls.push({ method: 'from', args: [table] });
        let eqId: unknown = null;
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'ilike', 'neq', 'is', 'gte', 'lte', 'or', 'order', 'limit']) {
            builder[method] = (...args: unknown[]) => {
                calls.push({ method, args });
                return builder;
            };
        }
        builder.eq = (column: string, value: unknown) => {
            calls.push({ method: 'eq', args: [column, value] });
            if (column === 'id') eqId = value;
            return builder;
        };
        builder.maybeSingle = () =>
            Promise.resolve({ data: rows.find((r) => r.id === eqId) ?? null, error: null });
        builder.then = (resolve: (value: { data: unknown; error: unknown }) => void) =>
            resolve({ data: rows, error: null });
        return builder;
    };
    return { client: { from }, calls };
}

Deno.test('loadSimilarRestaurants follows a stale alias, fences visibility and projects rows', async () => {
    const canonical = place('canonical', 0, 0, { cuisine: 'Thai' });
    const { client, calls } = fakeClient([
        place('alias', 0, 0, { merged_into: 'canonical' }),
        canonical,
        place('twin', 300, 0, { cuisine: 'thai', price_level: 2, photo_url: 'p', photo_source: 'places' }),
    ]);

    const rows = await loadSimilarRestaurants(client, VIEWER, 'alias');

    assertEquals(rows.length, 1);
    assertEquals(rows[0], {
        id: 'twin',
        name: 'twin',
        cuisine: 'thai',
        city: 'London',
        price_level: 2,
        photo_url: 'p',
        photo_source: 'places',
        places_photo_attribution_html: null,
        distance_m: 300,
        match: 'cuisine',
    });
    const ids = calls.filter((c) => c.method === 'eq' && c.args[0] === 'id').map((c) => c.args[1]);
    assertEquals(ids, ['alias', 'canonical']);
    const fences = calls.filter((c) => c.method === 'or').map((c) => c.args[0]);
    // source read ×2 (alias hop) + cuisine-tier pool + general pool.
    assertEquals(fences, Array(4).fill(`verification.eq.verified,created_by.eq.${VIEWER}`));
    assertEquals(
        calls.filter((c) => c.method === 'ilike').map((c) => c.args),
        [['city', 'London'], ['cuisine', 'thai'], ['city', 'London']],
    );
    assertEquals(calls.filter((c) => c.method === 'from').length, 4);
    // The general pool is a deterministic slice: best-known first, then id.
    assertEquals(
        calls.filter((c) => c.method === 'order').map((c) => c.args[0]),
        ['google_rating_count', 'id'],
    );
});

Deno.test('loadSimilarRestaurants returns [] for a source without a city', async () => {
    const { client, calls } = fakeClient([place('lonely', 0, 0, { city: null })]);
    assertEquals(await loadSimilarRestaurants(client, VIEWER, 'lonely'), []);
    assertEquals(calls.filter((c) => c.method === 'from').length, 1);
});

Deno.test('handleSimilarAction wraps rows in the data envelope and rejects a missing id', async () => {
    const { client } = fakeClient([source, place('twin', 200, 0, { cuisine: 'Thai' })]);

    assertStrictEquals(await handleSimilarAction(client, VIEWER, {}), null);

    const res = await handleSimilarAction(client, VIEWER, { restaurant_id: 'source' });
    assert(res instanceof Response);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.data.rows.map((r: { id: string }) => r.id), ['twin']);
});
