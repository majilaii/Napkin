/**
 * TICKET-098 — TrendingRail client double-gate.
 *
 * The server floors the rail at 3 qualifying restaurants and caps at 10, but
 * the client re-gates so a stale/malformed cache can never surface a one-card
 * rail (Risks: "rail advertising a ghost town" is double-gated).
 */
import { visibleTrendingCards } from '../trendingRailGate';
import type { TrendingCard } from '@/hooks/feed/useTrending';

function card(n: number): TrendingCard {
    return {
        restaurant_id: `r-${n}`,
        name: `Restaurant ${n}`,
        cuisine: n % 2 === 0 ? 'Japanese' : null,
        neighborhood: 'Hong Kong',
        photo_url: null,
        imports_30d: 3 + n,
        saves_30d: n,
        list_adds_30d: 0,
    };
}

describe('visibleTrendingCards', () => {
    it('returns [] for undefined (rail hidden)', () => {
        expect(visibleTrendingCards(undefined)).toEqual([]);
    });

    it('returns [] for 0 cards', () => {
        expect(visibleTrendingCards([])).toEqual([]);
    });

    it('returns [] below the 3-card floor (no partial rail)', () => {
        expect(visibleTrendingCards([card(1)])).toEqual([]);
        expect(visibleTrendingCards([card(1), card(2)])).toEqual([]);
    });

    it('passes exactly 3 cards through', () => {
        const rows = [card(1), card(2), card(3)];
        expect(visibleTrendingCards(rows)).toHaveLength(3);
    });

    it('caps at 10 cards — finite rail, no load-more', () => {
        const rows = Array.from({ length: 14 }, (_, i) => card(i));
        const visible = visibleTrendingCards(rows);
        expect(visible).toHaveLength(10);
        // Order preserved (server ranks; client never re-sorts).
        expect(visible[0].restaurant_id).toBe('r-0');
        expect(visible[9].restaurant_id).toBe('r-9');
    });
});
