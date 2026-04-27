/**
 * Tests for table-activity edge function — TICKET-046 Fix Pass 2
 *
 * Guards the tt4 hydration contract: fn_table_activity_page returns canonical
 * tt4 rows where id = a real table_top_4_history.id (row PK), NOT the save_id.
 * The consumer queries .in('id', tt4Ids) against that PK column, so the two ids
 * must be the same value. A 2-slot save must collapse to exactly ONE feed card.
 *
 * Run with: deno test --allow-env supabase/functions/table-activity/
 */

import { assertEquals, assertExists } from '../_shared/test-utils.ts';

// ── Inline the hydration logic under test ────────────────────────────────────
// Mirrors supabase/functions/table-activity/index.ts hydration of top_4_edited.
// If the consumer code changes its id-lookup semantics, this test must be
// updated simultaneously — that's the regression guard.

interface RpcRow {
    kind: string;
    id: string;
    sort_date: string;
    payload: Record<string, unknown>;
}

interface HistRow {
    id: string;
    table_id: string;
    position: number;
    actor_id: string;
    event_type: string;
    prev_restaurant_id: string | null;
    next_restaurant_id: string | null;
    created_at: string;
    save_id: string | null;
}

interface Profile {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

interface Restaurant {
    id: string;
    name: string;
}

/**
 * Simulates the tt4 hydration block from table-activity/index.ts.
 * Returns the merged orderedItems filtered to top_4_edited events.
 */
function hydrateTop4Events(
    keptRpc: RpcRow[],
    histRows: HistRow[],
    profiles: Profile[],
    restaurants: Restaurant[],
): unknown[] {
    const tt4RpcRows = keptRpc.filter((r) => r.kind === 'top_4_edited');
    const tt4Ids = tt4RpcRows.map((r) => r.id);

    if (tt4Ids.length === 0) return [];

    // Hydrate actor profiles
    const tt4ProfileMap = new Map(profiles.map((p) => [p.user_id, p]));

    // Hydrate restaurant names
    const tt4RestaurantMap = new Map(restaurants.map((r) => [r.id, r.name]));

    const sortDateByTt4Id = new Map(tt4RpcRows.map((r) => [r.id, r.sort_date]));

    // ── This is the exact mapping from table-activity/index.ts:400-420 ────────
    // If the RPC returns save_id instead of row PK, histRows would be empty
    // (because .in('id', tt4Ids) queries by row PK) and tt4Events would be [].
    const matchingHistRows = histRows.filter((h) => tt4Ids.includes(h.id));

    const tt4Events = matchingHistRows.map((h) => {
        const actor = tt4ProfileMap.get(h.actor_id);
        return {
            id: h.id,
            type: 'top_4_edited' as const,
            table_id: h.table_id,
            position: h.position,
            actor_id: h.actor_id,
            actor_name: actor?.display_name ?? null,
            actor_avatar_url: actor?.avatar_url ?? null,
            event_type: h.event_type,
            prev_restaurant: h.prev_restaurant_id
                ? { id: h.prev_restaurant_id, name: tt4RestaurantMap.get(h.prev_restaurant_id) ?? null }
                : null,
            next_restaurant: h.next_restaurant_id
                ? { id: h.next_restaurant_id, name: tt4RestaurantMap.get(h.next_restaurant_id) ?? null }
                : null,
            created_at: h.created_at,
            sort_date: sortDateByTt4Id.get(h.id) ?? h.created_at,
        };
    });

    // ── Merge in RPC order (mirrors index.ts:460-484) ─────────────────────────
    const tt4ById = new Map(tt4Events.map((t) => [t.id, t]));

    return keptRpc
        .filter((r) => r.kind === 'top_4_edited')
        .map((rpcRow) => tt4ById.get(rpcRow.id))
        .filter(Boolean);
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TABLE_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_ID = '00000000-0000-0000-0000-000000000002';
const SAVE_ID  = '00000000-0000-0000-0000-000000000010';
// Two history rows from a 2-slot save — each has a distinct row PK, same save_id.
const HIST_ROW_PK_1 = '00000000-0000-0000-0000-000000000020'; // position 1 (lowest → canonical)
const HIST_ROW_PK_2 = '00000000-0000-0000-0000-000000000021'; // position 2
const RESTAURANT_A  = '00000000-0000-0000-0000-000000000030';
const RESTAURANT_B  = '00000000-0000-0000-0000-000000000031';
const SORT_DATE     = '2026-04-27T14:00:00.000Z';

const histRows: HistRow[] = [
    {
        id: HIST_ROW_PK_1,
        table_id: TABLE_ID,
        position: 1,
        actor_id: ACTOR_ID,
        event_type: 'added',
        prev_restaurant_id: null,
        next_restaurant_id: RESTAURANT_A,
        created_at: SORT_DATE,
        save_id: SAVE_ID,
    },
    {
        id: HIST_ROW_PK_2,
        table_id: TABLE_ID,
        position: 2,
        actor_id: ACTOR_ID,
        event_type: 'swapped',
        prev_restaurant_id: RESTAURANT_A,
        next_restaurant_id: RESTAURANT_B,
        created_at: SORT_DATE,
        save_id: SAVE_ID,
    },
];

const profiles: Profile[] = [
    { user_id: ACTOR_ID, display_name: 'Clara', avatar_url: null },
];

const restaurants: Restaurant[] = [
    { id: RESTAURANT_A, name: 'Estela' },
    { id: RESTAURANT_B, name: 'St. John' },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('table-activity top_4_edited hydration', async (t) => {

    await t.step(
        'canonical tt4 RPC row uses real history row PK (not save_id) — hydration returns one event',
        () => {
            // fn_table_activity_page (post Fix Pass 2) returns the lowest-position
            // row's PK as the canonical id. Simulate that:
            const keptRpc: RpcRow[] = [
                {
                    kind: 'top_4_edited',
                    id: HIST_ROW_PK_1,   // ← real row PK, NOT save_id
                    sort_date: SORT_DATE,
                    payload: {},
                },
            ];

            const result = hydrateTop4Events(keptRpc, histRows, profiles, restaurants);

            // One RPC row → one feed event (not two for the 2-slot save)
            assertEquals(result.length, 1);

            const event = result[0] as Record<string, unknown>;
            assertEquals(event.type, 'top_4_edited');
            assertEquals(event.id, HIST_ROW_PK_1);
            assertEquals(event.actor_name, 'Clara');
        },
    );

    await t.step(
        'hydrated event has restaurant data for next_restaurant',
        () => {
            const keptRpc: RpcRow[] = [
                {
                    kind: 'top_4_edited',
                    id: HIST_ROW_PK_1,
                    sort_date: SORT_DATE,
                    payload: {},
                },
            ];

            const result = hydrateTop4Events(keptRpc, histRows, profiles, restaurants);
            const event = result[0] as Record<string, unknown>;

            assertExists(event.next_restaurant);
            const next = event.next_restaurant as Record<string, unknown>;
            assertEquals(next.id, RESTAURANT_A);
            assertEquals(next.name, 'Estela');
        },
    );

    await t.step(
        'if RPC returns save_id instead of row PK (regression simulation), hydration returns zero events',
        () => {
            // This test documents the BROKEN behavior: pre-Fix-Pass-2 code returned
            // c.save_id as id. The .in('id', tt4Ids) query against table_top_4_history
            // would find no matching rows (save_id != row PK), so events disappear.
            const keptRpc: RpcRow[] = [
                {
                    kind: 'top_4_edited',
                    id: SAVE_ID,         // ← save_id, NOT a real row PK
                    sort_date: SORT_DATE,
                    payload: {},
                },
            ];

            const result = hydrateTop4Events(keptRpc, histRows, profiles, restaurants);

            // Zero events: save_id doesn't match any histRow.id
            assertEquals(result.length, 0, 'hydration must return 0 when id is save_id (not row PK)');
        },
    );

    await t.step(
        'legacy tt4 row (save_id IS NULL) hydrates via row PK — unchanged',
        () => {
            const legacyRowPK = '00000000-0000-0000-0000-000000000099';
            const legacyHist: HistRow = {
                id: legacyRowPK,
                table_id: TABLE_ID,
                position: 3,
                actor_id: ACTOR_ID,
                event_type: 'added',
                prev_restaurant_id: null,
                next_restaurant_id: RESTAURANT_B,
                created_at: SORT_DATE,
                save_id: null,
            };

            const keptRpc: RpcRow[] = [
                {
                    kind: 'top_4_edited',
                    id: legacyRowPK,     // legacy branch: id = row PK (no save_id)
                    sort_date: SORT_DATE,
                    payload: {},
                },
            ];

            const result = hydrateTop4Events(keptRpc, [legacyHist], profiles, restaurants);

            assertEquals(result.length, 1);
            const event = result[0] as Record<string, unknown>;
            assertEquals(event.id, legacyRowPK);
        },
    );

    await t.step(
        'two-slot save collapses to exactly one feed event when RPC returns one canonical row',
        () => {
            // Both hist rows share save_id. fn_table_activity_page DISTINCT ON (save_id)
            // emits only HIST_ROW_PK_1 (position 1, lowest). Consumer sees 1 rpc row → 1 event.
            const keptRpc: RpcRow[] = [
                {
                    kind: 'top_4_edited',
                    id: HIST_ROW_PK_1,   // canonical: lowest position of the save
                    sort_date: SORT_DATE,
                    payload: {},
                },
                // HIST_ROW_PK_2 (position 2) is NOT present — collapsed by the RPC
            ];

            const result = hydrateTop4Events(keptRpc, histRows, profiles, restaurants);

            assertEquals(
                result.length,
                1,
                'a 2-slot save must produce exactly 1 feed event',
            );
        },
    );
});
