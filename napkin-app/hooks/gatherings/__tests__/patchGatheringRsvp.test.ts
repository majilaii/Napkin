/**
 * patchGatheringRsvp — unit tests (TICKET-095).
 *
 * The optimistic patch for RSVP'ing on a gathering feed card. The table-activity
 * cache is InfiniteData whose pages are `{ rows }` ENVELOPES — the patch must
 * map page.rows, never page.map (that exact mistake caused a prod bug).
 */

// useRsvpGathering imports callEdgeFn (→ lib/supabase, env-dependent) and
// useAuth (→ providers → lib/supabase). Mock both so the pure patch fn can be
// imported without standing up the client. Types from useTableActivity are
// type-only imports — erased at compile time, no mock needed.
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn(() => ({ user: null })) }));

import { patchGatheringRsvp } from '../useRsvpGathering';
import type { GatheringCardActivity } from '@/hooks/tables/useTableActivity';

const VIEWER = 'user-viewer';
const HOST = 'user-host';
const OTHER = 'user-other';

function makeGathering(overrides: Partial<GatheringCardActivity> = {}): GatheringCardActivity {
    return {
        type: 'gathering',
        id: 'g-1',
        sort_date: '2026-07-04T00:00:00Z',
        table_id: 't-1',
        restaurant: { id: 'r-1', name: 'Kono', city: 'Hong Kong', photo_url: null },
        host_user_id: HOST,
        host_name: 'Clara Host',
        note: null,
        gather_on: '2026-07-12',
        status: 'proposed',
        supper_id: null,
        seats: [
            { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
            { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: null },
            { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
        ],
        in_count: 1,
        viewer_response: null,
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

describe('patchGatheringRsvp', () => {
    it('sets viewer_response, patches the viewer seat, recomputes in_count', () => {
        const data = makeInfinite([[makeGathering()]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'in') as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        expect(card.viewer_response).toBe('in');
        expect(card.seats.find((s) => s.user_id === VIEWER)?.response).toBe('in');
        expect(card.in_count).toBe(2); // host + viewer
    });

    it('changing in → out decrements in_count', () => {
        const answered = makeGathering({
            viewer_response: 'in',
            in_count: 2,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'in' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
        });
        const data = makeInfinite([[answered]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'out') as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        expect(card.viewer_response).toBe('out');
        expect(card.in_count).toBe(1); // host only
    });

    it('leaves other rows and non-gathering kinds untouched', () => {
        const soloRow = { type: 'solo_share', id: 'e-1', content: 'great pasta' };
        const otherGathering = makeGathering({ id: 'g-2' });
        const data = makeInfinite([[soloRow, makeGathering(), otherGathering]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'in') as typeof data;

        expect(result.pages[0].rows[0]).toBe(soloRow); // identity preserved
        const untouched = result.pages[0].rows[2] as GatheringCardActivity;
        expect(untouched.viewer_response).toBeNull();
        expect(untouched.in_count).toBe(1);
    });

    it('patches the card across later pages (walks every { rows } envelope)', () => {
        const data = makeInfinite([[{ type: 'solo_share', id: 'e-1' }], [makeGathering()]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'in') as typeof data;
        const card = result.pages[1].rows[0] as GatheringCardActivity;

        expect(card.viewer_response).toBe('in');
    });

    it('is a no-op on undefined data and shapes without pages', () => {
        expect(patchGatheringRsvp(undefined, 'g-1', VIEWER, 'in')).toBeUndefined();
        const notPaged = { rows: [makeGathering()] };
        expect(patchGatheringRsvp(notPaged, 'g-1', VIEWER, 'in')).toBe(notPaged);
    });

    it('tolerates a page without rows (envelope defensive)', () => {
        const weird = {
            pages: [{ next_cursor: null, has_more: false }, { rows: [makeGathering()], next_cursor: null, has_more: false }],
            pageParams: [null, 'c-1'],
        };
        const result = patchGatheringRsvp(weird, 'g-1', VIEWER, 'in') as typeof weird;
        expect(result.pages[0]).toBe(weird.pages[0]);
        expect((result.pages[1].rows![0] as GatheringCardActivity).viewer_response).toBe('in');
    });
});
