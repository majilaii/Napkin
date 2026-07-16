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

import { patchGatheringRsvp, patchGatheringCard } from '../useRsvpGathering';
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
        restaurant: {
            id: 'r-1',
            name: 'Kono',
            city: 'Hong Kong',
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
        },
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
        counters: [],
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

    it('counter: sets viewer_response=counter, adds a counter chip, drops from in_count', () => {
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

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'counter', '2026-07-19') as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        expect(card.viewer_response).toBe('counter');
        expect(card.seats.find((s) => s.user_id === VIEWER)?.response).toBe('counter');
        expect(card.in_count).toBe(1); // host only — the viewer left 'in'
        expect(card.counters).toEqual([
            { user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' },
        ]);
    });

    it('counter → in clears the viewer counter chip and re-counts in', () => {
        const countered = makeGathering({
            viewer_response: 'counter',
            in_count: 1,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'counter' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
            counters: [{ user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' }],
        });
        const data = makeInfinite([[countered]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'in') as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        expect(card.viewer_response).toBe('in');
        expect(card.in_count).toBe(2);
        expect(card.counters).toEqual([]); // viewer's counter dropped
    });

    it('counter: re-countering a new date replaces the viewer counter, keeps others', () => {
        const countered = makeGathering({
            viewer_response: 'counter',
            in_count: 1,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'counter' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: 'counter' },
            ],
            counters: [
                { user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' },
                { user_id: OTHER, display_name: 'Otto Other', counter_on: '2026-07-20' },
            ],
        });
        const data = makeInfinite([[countered]]);

        const result = patchGatheringRsvp(data, 'g-1', VIEWER, 'counter', '2026-07-25') as typeof data;
        const card = result.pages[0].rows[0] as GatheringCardActivity;

        expect(card.counters).toContainEqual({ user_id: OTHER, display_name: 'Otto Other', counter_on: '2026-07-20' });
        expect(card.counters).toContainEqual({ user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-25' });
        expect(card.counters).toHaveLength(2);
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

// ── patchGatheringCard — the single-object brain (TICKET-136, [ARCH-REVIEW-2]) ──
// The detail cache (gatherings.detail) patches one card object directly through
// this helper; the InfiniteData path maps rows through the SAME helper. These
// tests assert the per-card body in isolation so the two surfaces can't drift.
describe('patchGatheringCard', () => {
    it('sets viewer_response, patches the viewer seat, recomputes in_count', () => {
        const card = patchGatheringCard(makeGathering(), VIEWER, 'in');
        expect(card.viewer_response).toBe('in');
        expect(card.seats.find((s) => s.user_id === VIEWER)?.response).toBe('in');
        expect(card.in_count).toBe(2); // host + viewer
    });

    it('in → out decrements in_count', () => {
        const answered = makeGathering({
            viewer_response: 'in',
            in_count: 2,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'in' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
        });
        const card = patchGatheringCard(answered, VIEWER, 'out');
        expect(card.viewer_response).toBe('out');
        expect(card.in_count).toBe(1); // host only
    });

    it('counter: adds the viewer counter chip and drops them from in_count', () => {
        const answered = makeGathering({
            viewer_response: 'in',
            in_count: 2,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'in' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
        });
        const card = patchGatheringCard(answered, VIEWER, 'counter', '2026-07-19');
        expect(card.viewer_response).toBe('counter');
        expect(card.seats.find((s) => s.user_id === VIEWER)?.response).toBe('counter');
        expect(card.in_count).toBe(1);
        expect(card.counters).toEqual([
            { user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' },
        ]);
    });

    it('counter → in clears the viewer counter chip', () => {
        const countered = makeGathering({
            viewer_response: 'counter',
            in_count: 1,
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'counter' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
            counters: [{ user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' }],
        });
        const card = patchGatheringCard(countered, VIEWER, 'in');
        expect(card.viewer_response).toBe('in');
        expect(card.in_count).toBe(2);
        expect(card.counters).toEqual([]);
    });

    it('re-countering keeps other members counters, replaces the viewer entry', () => {
        const countered = makeGathering({
            counters: [
                { user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-19' },
                { user_id: OTHER, display_name: 'Otto Other', counter_on: '2026-07-20' },
            ],
        });
        const card = patchGatheringCard(countered, VIEWER, 'counter', '2026-07-25');
        expect(card.counters).toContainEqual({ user_id: OTHER, display_name: 'Otto Other', counter_on: '2026-07-20' });
        expect(card.counters).toContainEqual({ user_id: VIEWER, display_name: 'Vera Viewer', counter_on: '2026-07-25' });
        expect(card.counters).toHaveLength(2);
    });

    it('is the exact brain patchGatheringRsvp maps rows through (single-source parity)', () => {
        const base = makeGathering();
        const direct = patchGatheringCard(base, VIEWER, 'counter', '2026-07-19');
        const viaInfinite = patchGatheringRsvp(
            makeInfinite([[base]]),
            'g-1',
            VIEWER,
            'counter',
            '2026-07-19',
        ) as ReturnType<typeof makeInfinite>;
        expect(viaInfinite.pages[0].rows[0]).toEqual(direct);
    });
});
