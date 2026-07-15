/**
 * TICKET-189 — socials module presentation copy + rail-kicker reduction.
 *
 * CLIENT MIRROR of supabase/functions/_shared/socialsLadder.test.ts (the
 * server-side reducer has its own Deno tests) — the reduction rules must stay
 * byte-compatible: any rung-3 → 'from socials'; else any rung-2 → 'on socials
 * this month'; else 'on socials this week'.
 */
import { reduceRailKicker, socialsSignalLine } from '../socialsPresentation';

function card(partial: Partial<Parameters<typeof socialsSignalLine>[0]>) {
    return {
        rung: 1 as const,
        window: 'week' as const,
        count: 3,
        platform: 'tiktok' as const,
        creator_handle: null,
        ...partial,
    };
}

describe('socialsSignalLine', () => {
    it('rung 1 single platform names the platform + this week', () => {
        expect(socialsSignalLine(card({ rung: 1, window: 'week', count: 4, platform: 'tiktok' })))
            .toBe('4 saved from tiktok this week');
    });

    it('rung 1 mixed platforms → the neutral socials label', () => {
        expect(socialsSignalLine(card({ rung: 1, window: 'week', count: 5, platform: 'socials' })))
            .toBe('5 saved from socials this week');
    });

    it('rung 2 says this month — never a false this week', () => {
        expect(socialsSignalLine(card({ rung: 2, window: 'month', count: 3, platform: 'instagram' })))
            .toBe('3 saved from instagram this month');
    });

    it('rung 3 with a creator handle → clip-as-content provenance', () => {
        expect(
            socialsSignalLine(
                card({ rung: 3, window: null, count: null, platform: 'tiktok', creator_handle: 'topjaw' }),
            ),
        ).toBe('on tiktok · @topjaw');
    });

    it('rung 3 strips a stored leading @ (no double @@)', () => {
        expect(
            socialsSignalLine(
                card({ rung: 3, window: null, count: null, platform: 'instagram', creator_handle: '@chef' }),
            ),
        ).toBe('on instagram · @chef');
    });

    it('rung 3 without a handle → just the platform (older rows have no handle)', () => {
        expect(
            socialsSignalLine(
                card({ rung: 3, window: null, count: null, platform: 'instagram', creator_handle: null }),
            ),
        ).toBe('on instagram');
    });

    it('never renders a count below the floor (rung 3 has no number at all)', () => {
        const line = socialsSignalLine(
            card({ rung: 3, window: null, count: null, platform: 'tiktok', creator_handle: null }),
        );
        expect(line).not.toMatch(/\d/);
    });
});

describe('reduceRailKicker (mixed-rung rails — Codex P1)', () => {
    it('[rung1, rung2] → on socials this month', () => {
        expect(reduceRailKicker([{ rung: 1 }, { rung: 2 }])).toBe('on socials this month');
    });

    it('[rung1, rung3] → from socials', () => {
        expect(reduceRailKicker([{ rung: 1 }, { rung: 3 }])).toBe('from socials');
    });

    it('[rung1, rung1] → on socials this week', () => {
        expect(reduceRailKicker([{ rung: 1 }, { rung: 1 }])).toBe('on socials this week');
    });

    it('rung 3 wins over rung 2 in the same rail', () => {
        expect(reduceRailKicker([{ rung: 2 }, { rung: 3 }, { rung: 1 }])).toBe('from socials');
    });
});
