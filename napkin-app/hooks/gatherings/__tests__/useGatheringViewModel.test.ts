/**
 * useGatheringViewModel — unit tests (TICKET-136).
 *
 * The pure derivations (seat filters, alignment tally + in_count-beats guard,
 * waiting line, murmur fallback, source label, date-moved breadcrumb) shared by
 * GatheringCard and GatheringDetail. Divergence here would be a silent
 * correctness bug across two surfaces, so this locks the math. The view-model is
 * a pure function (no hooks) — callable directly, no renderHook / mocks needed.
 */
import { useGatheringViewModel } from '../useGatheringViewModel';
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
        counters: [],
        source_url: null,
        source_type: null,
        rescheduled_from: null,
        created_at: '2026-07-04T00:00:00Z',
        ...overrides,
    };
}

describe('useGatheringViewModel', () => {
    it('splits seats into ins / outs / waiting; viewer flagged as host correctly', () => {
        const vm = useGatheringViewModel(makeGathering(), HOST);
        expect(vm.isHost).toBe(true);
        expect(vm.isProposed).toBe(true);
        expect(vm.ins.map((s) => s.user_id)).toEqual([HOST]);
        expect(vm.waiting.map((s) => s.user_id).sort()).toEqual([OTHER, VIEWER].sort());
        expect(vm.waitingLine).toBe('waiting on 2 more');
    });

    it('single waiting member names them; viewer is "you"', () => {
        const g = makeGathering({
            seats: [
                { user_id: HOST, display_name: 'Clara Host', avatar_url: null, is_host: true, response: 'in' },
                { user_id: VIEWER, display_name: 'Vera Viewer', avatar_url: null, is_host: false, response: 'in' },
                { user_id: OTHER, display_name: 'Otto Other', avatar_url: null, is_host: false, response: null },
            ],
        });
        expect(useGatheringViewModel(g, VIEWER).waitingLine).toBe('waiting on Otto');
    });

    it('alignment shows when a counter clusters (>=2) AND beats in_count', () => {
        const g = makeGathering({
            in_count: 1,
            counters: [
                { user_id: VIEWER, display_name: 'Vera', counter_on: '2026-07-19' },
                { user_id: OTHER, display_name: 'Otto', counter_on: '2026-07-19' },
            ],
        });
        const vm = useGatheringViewModel(g, HOST);
        expect(vm.bestCounterDate).toBe('2026-07-19');
        expect(vm.bestCounterN).toBe(2);
        expect(vm.showAlignment).toBe(true);
    });

    it('alignment hidden when the cluster does NOT beat in_count', () => {
        const g = makeGathering({
            in_count: 2, // two already in — a 2-vote counter ties, does not beat
            counters: [
                { user_id: VIEWER, display_name: 'Vera', counter_on: '2026-07-19' },
                { user_id: OTHER, display_name: 'Otto', counter_on: '2026-07-19' },
            ],
        });
        expect(useGatheringViewModel(g, HOST).showAlignment).toBe(false);
    });

    it('date-moved breadcrumb only until the viewer re-answers', () => {
        const moved = makeGathering({ rescheduled_from: '2026-07-10', viewer_response: null });
        expect(useGatheringViewModel(moved, VIEWER).showDateMoved).toBe(true);
        const answered = makeGathering({ rescheduled_from: '2026-07-10', viewer_response: 'in' });
        expect(useGatheringViewModel(answered, VIEWER).showDateMoved).toBe(false);
    });

    it('source label only when a URL is present; underscores humanised', () => {
        expect(useGatheringViewModel(makeGathering(), VIEWER).sourceLabel).toBeNull();
        const pinned = makeGathering({ source_url: 'https://x/1', source_type: 'google_maps' });
        expect(useGatheringViewModel(pinned, VIEWER).sourceLabel).toBe('pinned from google maps');
    });

    it('murmur falls back to the host ask (viewer vs host phrasing)', () => {
        expect(useGatheringViewModel(makeGathering(), HOST).murmur).toBe('you want to gather the table');
        expect(useGatheringViewModel(makeGathering(), VIEWER).murmur).toBe('Clara wants to gather the table');
        expect(useGatheringViewModel(makeGathering({ note: 'dumplings?' }), VIEWER).murmur).toBe('dumplings?');
    });

    it('canClear / supperCancelled reflect dispatched-with-dead-supper for the host', () => {
        const dead = makeGathering({ status: 'dispatched', supper_id: null });
        const vm = useGatheringViewModel(dead, HOST);
        expect(vm.supperCancelled).toBe(true);
        expect(vm.canClear).toBe(true);
        // A non-host never sees the clear affordance.
        expect(useGatheringViewModel(dead, VIEWER).canClear).toBe(false);
    });
});
