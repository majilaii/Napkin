/**
 * buildGatheringCard — shape-parity test (TICKET-136).
 *
 * The `get` action assembles one gathering card as a single-row parallel of
 * table-activity's batched hydration. This test guards the 7-point parity
 * contract (see buildCard.ts) so the detail read can NEVER drift from the feed
 * card shape. It mirrors the table-activity assembly inline (single-row) as the
 * reference and asserts buildGatheringCard matches it field-for-field — plus
 * targeted assertions for the ex-member drop rule and the host-left case.
 *
 * We import buildCard.ts (pure) — NOT index.ts, which boots serve().
 *
 * Run with: deno test supabase/functions/gatherings/buildCard.test.ts
 */

import { assertEquals } from '../_shared/test-utils.ts';
import {
    buildGatheringCard,
    type GatheringRowInput,
    type ProfileInput,
    type RestaurantInput,
    type RsvpInput,
    type SourceInput,
} from './buildCard.ts';

// ── Reference: the table-activity assembly, mirrored for a single row ────────────
// This is the exact seat/counter/in_count/viewer_response/source math from
// table-activity/index.ts ~989–1056. buildGatheringCard MUST equal this (except
// sort_date, which the design deliberately sets to created_at for `get`).
function referenceAssembly(
    row: GatheringRowInput,
    rsvps: RsvpInput[],
    rosterIds: string[],
    profMap: Map<string, ProfileInput>,
    restaurant: RestaurantInput | null,
    source: SourceInput | undefined,
    viewerId: string,
) {
    const hostUserId = row.host_user_id ?? null;
    const rsvpByUser = new Map<string, string>();
    const countersRaw: { user_id: string; counter_on: string }[] = [];
    for (const r of rsvps) {
        rsvpByUser.set(r.user_id, r.response);
        if (r.response === 'counter' && r.counter_on) {
            countersRaw.push({ user_id: r.user_id, counter_on: r.counter_on });
        }
    }

    const seatRank = (s: { is_host: boolean; response: string | null }) =>
        s.is_host ? 0 : s.response === 'in' ? 1 : s.response == null ? 2 : 3;
    const seats = rosterIds
        .map((uid) => {
            const prof = profMap.get(uid);
            return {
                user_id: uid,
                display_name: prof?.display_name ?? null,
                avatar_url: prof?.avatar_url ?? null,
                is_host: uid === hostUserId,
                response: (rsvpByUser.get(uid) ?? null) as 'in' | 'out' | 'counter' | null,
            };
        })
        .sort((a, b) => seatRank(a) - seatRank(b));

    const inCount = seats.filter((s) => s.response === 'in').length;
    const viewerResponse = (rsvpByUser.get(viewerId) ?? null) as 'in' | 'out' | 'counter' | null;

    const counters = countersRaw
        .filter((c) => rosterIds.includes(c.user_id))
        .map((c) => ({
            user_id: c.user_id,
            display_name: profMap.get(c.user_id)?.display_name ?? null,
            counter_on: c.counter_on,
        }));

    const sourceUrl = source?.url && typeof source.url === 'string' ? source.url : null;
    const sourceType = sourceUrl ? (source?.type ?? null) : null;

    return {
        id: row.id,
        type: 'gathering' as const,
        table_id: row.table_id,
        restaurant: row.restaurant_id ? (restaurant ?? null) : null,
        host_user_id: hostUserId,
        host_name: (hostUserId ? profMap.get(hostUserId)?.display_name : null) ?? null,
        note: row.note ?? null,
        gather_on: row.gather_on,
        status: row.status,
        supper_id: row.supper_id ?? null,
        seats,
        in_count: inCount,
        viewer_response: viewerResponse,
        counters,
        source_url: sourceUrl,
        source_type: sourceType,
        rescheduled_from: row.rescheduled_from ?? null,
        created_at: row.created_at,
    };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const HOST = '00000000-0000-0000-0000-0000000000a1';
const VIEWER = '00000000-0000-0000-0000-0000000000a2';
const OTHER = '00000000-0000-0000-0000-0000000000a3';
const EX_MEMBER = '00000000-0000-0000-0000-0000000000a4';
const REST_ID = '00000000-0000-0000-0000-0000000000b1';
const OTHER_REST = '00000000-0000-0000-0000-0000000000b2';

function baseRow(overrides: Partial<GatheringRowInput> = {}): GatheringRowInput {
    return {
        id: '00000000-0000-0000-0000-0000000000c1',
        table_id: '00000000-0000-0000-0000-0000000000d1',
        restaurant_id: REST_ID,
        host_user_id: HOST,
        note: 'let us gather',
        gather_on: '2026-07-20',
        status: 'proposed',
        supper_id: null,
        rescheduled_from: null,
        created_at: '2026-07-04T10:00:00.000Z',
        ...overrides,
    };
}

const profMap = new Map<string, ProfileInput>([
    [HOST, { user_id: HOST, display_name: 'Clara Host', avatar_url: null }],
    [VIEWER, { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: 'a.png' }],
    [OTHER, { user_id: OTHER, display_name: 'Otto Other', avatar_url: null }],
]);

const restaurant: RestaurantInput = { id: REST_ID, name: 'Kono', city: 'Hong Kong', photo_url: null };

Deno.test('buildGatheringCard — 7-point parity contract', async (t) => {
    await t.step('matches the table-activity reference assembly field-for-field (sort_date aside)', () => {
        const row = baseRow();
        const rsvps: RsvpInput[] = [
            { user_id: HOST, response: 'in', counter_on: null },
            { user_id: VIEWER, response: 'counter', counter_on: '2026-07-22' },
            { user_id: OTHER, response: 'out', counter_on: null },
        ];
        const rosterIds = [HOST, VIEWER, OTHER];
        const source: SourceInput = { type: 'tiktok', url: 'https://tt/1' };

        const card = buildGatheringCard(row, rsvps, rosterIds, profMap, restaurant, source, VIEWER);
        const ref = referenceAssembly(row, rsvps, rosterIds, profMap, restaurant, source, VIEWER);

        // Every field except sort_date must be identical to the feed assembly.
        const { sort_date, ...cardRest } = card;
        assertEquals(cardRest, ref);
        // sort_date is deliberately created_at for `get` (point 7).
        assertEquals(sort_date, row.created_at);
    });

    await t.step('seats = current roster only; sorted host → in → undecided → out', () => {
        const row = baseRow();
        const rsvps: RsvpInput[] = [
            { user_id: OTHER, response: 'out', counter_on: null },
            { user_id: HOST, response: 'in', counter_on: null },
            { user_id: VIEWER, response: null as unknown as string, counter_on: null },
        ];
        const card = buildGatheringCard(row, rsvps, [OTHER, HOST, VIEWER], profMap, restaurant, undefined, VIEWER);
        assertEquals(card.seats.map((s) => s.user_id), [HOST, VIEWER, OTHER]);
        assertEquals(card.seats.map((s) => s.response), ['in', null, 'out']);
    });

    await t.step('ex-member RSVPs + counters drop; in_count counts roster-filtered in only', () => {
        const row = baseRow();
        const rsvps: RsvpInput[] = [
            { user_id: HOST, response: 'in', counter_on: null },
            { user_id: VIEWER, response: 'in', counter_on: null },
            // EX_MEMBER left the table but still has a stale 'in' + a counter.
            { user_id: EX_MEMBER, response: 'in', counter_on: null },
            { user_id: OTHER, response: 'counter', counter_on: '2026-07-25' },
            { user_id: EX_MEMBER, response: 'counter', counter_on: '2026-07-26' },
        ];
        const rosterIds = [HOST, VIEWER, OTHER]; // EX_MEMBER absent
        const card = buildGatheringCard(row, rsvps, rosterIds, profMap, restaurant, undefined, VIEWER);

        // Only 2 'in' seats count (host + viewer) — the ex-member's stale 'in' drops.
        assertEquals(card.in_count, 2);
        assertEquals(card.seats.some((s) => s.user_id === EX_MEMBER), false);
        // Counters keep OTHER, drop the ex-member.
        assertEquals(card.counters.map((c) => c.user_id), [OTHER]);
    });

    await t.step('viewer_response reflects the caller only', () => {
        const row = baseRow();
        const rsvps: RsvpInput[] = [
            { user_id: HOST, response: 'in', counter_on: null },
            { user_id: VIEWER, response: 'out', counter_on: null },
        ];
        const card = buildGatheringCard(row, rsvps, [HOST, VIEWER, OTHER], profMap, restaurant, undefined, VIEWER);
        assertEquals(card.viewer_response, 'out');
        // A viewer with no RSVP → null.
        const card2 = buildGatheringCard(row, rsvps, [HOST, VIEWER, OTHER], profMap, restaurant, undefined, OTHER);
        assertEquals(card2.viewer_response, null);
    });

    await t.step('host_name resolves even when the host LEFT the table', () => {
        const row = baseRow();
        // Roster no longer contains the host.
        const rosterIds = [VIEWER, OTHER];
        const rsvps: RsvpInput[] = [{ user_id: VIEWER, response: 'in', counter_on: null }];
        const card = buildGatheringCard(row, rsvps, rosterIds, profMap, restaurant, undefined, VIEWER);
        assertEquals(card.host_name, 'Clara Host');
        assertEquals(card.host_user_id, HOST);
        // No host seat (host not in roster) — parity with table-activity.
        assertEquals(card.seats.some((s) => s.is_host), false);
    });

    await t.step('source: URL present → source_type set; absent → both null', () => {
        const row = baseRow();
        const rsvps: RsvpInput[] = [{ user_id: HOST, response: 'in', counter_on: null }];
        const withUrl = buildGatheringCard(row, rsvps, [HOST], profMap, restaurant, { type: 'tiktok', url: 'https://x/1' }, HOST);
        assertEquals(withUrl.source_url, 'https://x/1');
        assertEquals(withUrl.source_type, 'tiktok');
        // A source object with no URL → both null (never a bare match leaks a type).
        const noUrl = buildGatheringCard(row, rsvps, [HOST], profMap, restaurant, { type: 'tiktok' }, HOST);
        assertEquals(noUrl.source_url, null);
        assertEquals(noUrl.source_type, null);
        const none = buildGatheringCard(row, rsvps, [HOST], profMap, restaurant, undefined, HOST);
        assertEquals(none.source_url, null);
        assertEquals(none.source_type, null);
    });

    await t.step('restaurant null when the row has no restaurant_id', () => {
        const row = baseRow({ restaurant_id: null });
        const card = buildGatheringCard(row, [], [HOST], profMap, null, undefined, HOST);
        assertEquals(card.restaurant, null);
    });

    await t.step('carries rescheduled_from / note / status / supper_id / gather_on from the row', () => {
        const row = baseRow({
            rescheduled_from: '2026-07-18',
            note: null,
            status: 'dispatched',
            supper_id: '00000000-0000-0000-0000-0000000000e1',
            gather_on: '2026-07-21',
        });
        const card = buildGatheringCard(row, [], [HOST], profMap, restaurant, undefined, HOST);
        assertEquals(card.rescheduled_from, '2026-07-18');
        assertEquals(card.note, null);
        assertEquals(card.status, 'dispatched');
        assertEquals(card.supper_id, '00000000-0000-0000-0000-0000000000e1');
        assertEquals(card.gather_on, '2026-07-21');
        assertEquals(card.type, 'gathering');
    });

    // Sanity: the OTHER_REST/OTHER_REST ids exist only to document that a bare
    // restaurant match must never source a different gathering — the composite
    // lookup is the caller's job; buildGatheringCard just receives the resolved
    // source, so there is nothing further to assert here.
    void OTHER_REST;
});
