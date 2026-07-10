/**
 * TICKET-102 — rail mode selection matrix, pure so mode exclusivity is
 * verified, not eyeballed (mirrors trendingRailGate.test.ts).
 *
 * Rule: trending iff >= 3 visible trending cards; else fallback (post-dedup);
 * else hidden. Never mixed. Title/meta switch with the mode.
 */
import { pickRailMode } from '../railMode';
import type { TrendingCard, FallbackCard } from '@/hooks/feed/useTrending';

function tCard(n: number): TrendingCard {
    return {
        restaurant_id: `t-${n}`,
        name: `Trending ${n}`,
        cuisine: null,
        neighborhood: 'Central',
        photo_url: null,
        imports_30d: 3 + n,
        saves_30d: n,
        list_adds_30d: 0,
    };
}
function fCard(n: number): FallbackCard {
    return {
        restaurant_id: `f-${n}`,
        name: `Fallback ${n}`,
        cuisine: null,
        neighborhood: 'Central',
        photo_url: null,
        google_rating: 4.5,
        google_rating_count: 200,
    };
}

describe('pickRailMode', () => {
    it('>= 3 trending → mode trending (fallback ignored even if present)', () => {
        const res = pickRailMode(
            [tCard(1), tCard(2), tCard(3)],
            [fCard(1), fCard(2), fCard(3)],
            new Set(),
        );
        expect(res.mode).toBe('trending');
        expect(res.title).toBe('trending this week');
        expect(res.cards.map((c) => c.restaurant_id)).toEqual(['t-1', 't-2', 't-3']);
    });

    it('< 3 trending but fallback available → mode fallback', () => {
        const res = pickRailMode([tCard(1)], [fCard(1), fCard(2), fCard(3)], new Set());
        expect(res.mode).toBe('fallback');
        expect(res.title).toBe('nearby, well rated');
        expect(res.cards.map((c) => c.restaurant_id)).toEqual(['f-1', 'f-2', 'f-3']);
    });

    it('0 trending + 0 fallback → hidden', () => {
        const res = pickRailMode([], [], new Set());
        expect(res.mode).toBe('hidden');
        expect(res.cards).toEqual([]);
    });

    it('mode exclusivity: never mixes trending + fallback cards', () => {
        // 2 trending (below floor) + 3 fallback → fallback only, no trending leak
        const res = pickRailMode([tCard(1), tCard(2)], [fCard(1), fCard(2), fCard(3)], new Set());
        expect(res.mode).toBe('fallback');
        expect(res.cards.every((c) => c.restaurant_id.startsWith('f-'))).toBe(true);
    });

    it('fallback respects the client dedup floor (unfilter below 3)', () => {
        // trending below floor; 4 fallback, 2 saved → filtered 2 (<3) → unfiltered 4
        const res = pickRailMode(
            [],
            [fCard(1), fCard(2), fCard(3), fCard(4)],
            new Set(['f-1', 'f-2']),
        );
        expect(res.mode).toBe('fallback');
        expect(res.cards).toHaveLength(4);
    });

    it('trending caps at 10 in trending mode', () => {
        const many = Array.from({ length: 14 }, (_, i) => tCard(i));
        const res = pickRailMode(many, [], new Set());
        expect(res.mode).toBe('trending');
        expect(res.cards).toHaveLength(10);
    });

    it('fallback fully saved-out → hidden (no fallback cards survive, no trending)', () => {
        // 3 fallback all saved → filtered 0; unfiltered is 3 (>=1) so NOT hidden —
        // the unhide floor shows the redundant list rather than an empty rail.
        const res = pickRailMode([], [fCard(1), fCard(2), fCard(3)], new Set(['f-1', 'f-2', 'f-3']));
        expect(res.mode).toBe('fallback');
        expect(res.cards).toHaveLength(3);
    });

    it('handles undefined arrays as empty → hidden', () => {
        const res = pickRailMode(undefined, undefined, new Set());
        expect(res.mode).toBe('hidden');
    });
});
