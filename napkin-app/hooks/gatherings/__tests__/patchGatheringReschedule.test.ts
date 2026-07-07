/**
 * patchGatheringReschedule — unit tests (TICKET-127 AC8).
 *
 * The host re-date reset applied optimistically to the gathering feed card:
 *   • counters naming the new date  → seat flips to 'in', counter chip dropped.
 *   • the host's seat                → stays 'in' (they chose the new date).
 *   • every other prior 'in' seat    → reset to null (unanswered).
 *   • 'out' seats + other counters   → untouched.
 *   • gather_on = new date, rescheduled_from = old date.
 * The table-activity cache is InfiniteData whose pages are `{ rows }` envelopes.
 */

// The hook module imports callEdgeFn + useAuth (env-dependent) — mock them so the
// pure patch fn imports without standing up the client.
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn(() => ({ user: null })) }));

import { patchGatheringReschedule } from '../useRescheduleGathering';
import type { GatheringCardActivity } from '@/hooks/tables/useTableActivity';

const HOST = 'user-host';
const A = 'user-a';
const B = 'user-b';
const C = 'user-c';

const OLD = '2026-07-12';
const NEW = '2026-07-19';

function makeGathering(overrides: Partial<GatheringCardActivity> = {}): GatheringCardActivity {
    return {
        type: 'gathering',
        id: 'g-1',
        sort_date: '2026-07-04T00:00:00Z',
        table_id: 't-1',
        restaurant: { id: 'r-1', name: 'Kono', city: 'Hong Kong', photo_url: null },
        host_user_id: HOST,
        host_name: 'Hattie Host',
        note: null,
        gather_on: OLD,
        status: 'proposed',
        supper_id: null,
        seats: [
            { user_id: HOST, display_name: 'Hattie Host', avatar_url: null, is_host: true, response: 'in' },
            { user_id: A, display_name: 'Ada', avatar_url: null, is_host: false, response: 'in' },
            { user_id: B, display_name: 'Ben', avatar_url: null, is_host: false, response: 'counter' },
            { user_id: C, display_name: 'Cy', avatar_url: null, is_host: false, response: 'out' },
        ],
        in_count: 2,
        viewer_response: 'in',
        counters: [{ user_id: B, display_name: 'Ben', counter_on: NEW }],
        source_url: null,
        source_type: null,
        rescheduled_from: null,
        created_at: '2026-07-04T00:00:00Z',
        ...overrides,
    };
}

function makeInfinite(rows: unknown[][]) {
    return {
        pages: rows.map((r) => ({ rows: r, next_cursor: null, has_more: false })),
        pageParams: rows.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
    };
}

describe('patchGatheringReschedule', () => {
    it('flips a matching counter to in, keeps the host in, resets other ins, keeps out, moves the date', () => {
        const data = makeInfinite([[makeGathering()]]);

        const result = patchGatheringReschedule(data, 'g-1', HOST, NEW, OLD) as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        const byId = Object.fromEntries(card.seats.map((s) => [s.user_id, s.response]));
        expect(byId[B]).toBe('in'); // countered the new date → confirmed
        expect(byId[HOST]).toBe('in'); // host chose the new date → stays in
        expect(byId[A]).toBeNull(); // prior 'in' reset
        expect(byId[C]).toBe('out'); // out persists

        expect(card.gather_on).toBe(NEW);
        expect(card.rescheduled_from).toBe(OLD);
        expect(card.in_count).toBe(2); // the flipped counter + the host
        expect(card.counters).toEqual([]); // the matching counter was consumed
    });

    it('keeps counters for OTHER dates and leaves their seats countering', () => {
        const g = makeGathering({
            seats: [
                { user_id: HOST, display_name: 'Hattie Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: A, display_name: 'Ada', avatar_url: null, is_host: false, response: 'counter' },
                { user_id: B, display_name: 'Ben', avatar_url: null, is_host: false, response: 'counter' },
            ],
            counters: [
                { user_id: A, display_name: 'Ada', counter_on: '2026-08-01' }, // other date
                { user_id: B, display_name: 'Ben', counter_on: NEW }, // matches move
            ],
            in_count: 1,
        });
        const data = makeInfinite([[g]]);

        const result = patchGatheringReschedule(data, 'g-1', HOST, NEW, OLD) as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        const byId = Object.fromEntries(card.seats.map((s) => [s.user_id, s.response]));
        expect(byId[B]).toBe('in');
        expect(byId[A]).toBe('counter'); // untouched — different date
        expect(byId[HOST]).toBe('in'); // host chose the new date → stays in
        expect(card.counters).toEqual([{ user_id: A, display_name: 'Ada', counter_on: '2026-08-01' }]);
    });

    it('recomputes the viewer_response from the patched seats', () => {
        // Viewer is A, who was 'in' on the old date → reset to unanswered.
        const data = makeInfinite([[makeGathering({ viewer_response: 'in' })]]);
        const result = patchGatheringReschedule(data, 'g-1', A, NEW, OLD) as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;
        expect(card.viewer_response).toBeNull();
    });

    it('leaves other rows and non-gathering kinds untouched', () => {
        const solo = { type: 'solo_share', id: 'e-1' };
        const other = makeGathering({ id: 'g-2' });
        const data = makeInfinite([[solo, makeGathering(), other]]);

        const result = patchGatheringReschedule(data, 'g-1', HOST, NEW, OLD) as typeof data;

        expect(result.pages[0].rows[0]).toBe(solo);
        const untouched = result.pages[0].rows[2] as GatheringCardActivity;
        expect(untouched.gather_on).toBe(OLD);
        expect(untouched.rescheduled_from).toBeNull();
    });

    it('is a no-op on undefined data and shapes without pages', () => {
        expect(patchGatheringReschedule(undefined, 'g-1', HOST, NEW, OLD)).toBeUndefined();
        const notPaged = { rows: [makeGathering()] };
        expect(patchGatheringReschedule(notPaged, 'g-1', HOST, NEW, OLD)).toBe(notPaged);
    });
});
