/**
 * TICKET-102 — fallback rail client dedup + floor, pure (mirrors
 * trendingRailGate.test.ts).
 *
 *   - filter out ids in the viewer's local wishlist/journal caches
 *   - if the filtered count < 3, show the UNFILTERED list (a near-empty
 *     "usefully filtered" rail is worse than a slightly redundant one)
 *   - cap 10; if even unfiltered < 1, return [] (absolute floor → rail hides)
 *   - display-only: never mutates the cached payload
 */
import { visibleFallbackCards, MIN_FALLBACK_UNHIDE, MAX_FALLBACK_CARDS } from '../fallbackRailGate';
import type { FallbackCard } from '@/hooks/feed/useTrending';

function card(n: number): FallbackCard {
    return {
        restaurant_id: `r-${n}`,
        name: `Restaurant ${n}`,
        cuisine: n % 2 === 0 ? 'Japanese' : null,
        neighborhood: 'Central',
        photo_url: null,
        google_rating: 4.5,
        google_rating_count: 200,
    };
}

describe('visibleFallbackCards', () => {
    it('constants: unhide floor 3, cap 10', () => {
        expect(MIN_FALLBACK_UNHIDE).toBe(3);
        expect(MAX_FALLBACK_CARDS).toBe(10);
    });

    it('empty input → [] (absolute floor, rail hides)', () => {
        expect(visibleFallbackCards([], new Set())).toEqual([]);
        expect(visibleFallbackCards(undefined, new Set())).toEqual([]);
    });

    it('no saved ids → returns all (capped 10), order preserved', () => {
        const cards = [card(1), card(2), card(3), card(4)];
        const out = visibleFallbackCards(cards, new Set());
        expect(out.map((c) => c.restaurant_id)).toEqual(['r-1', 'r-2', 'r-3', 'r-4']);
    });

    it('filters out saved ids when enough remain (>= 3)', () => {
        const cards = [card(1), card(2), card(3), card(4), card(5)];
        const out = visibleFallbackCards(cards, new Set(['r-2']));
        expect(out.map((c) => c.restaurant_id)).toEqual(['r-1', 'r-3', 'r-4', 'r-5']);
    });

    it('if filtering drops below 3, shows the UNFILTERED list', () => {
        // 4 cards, 2 saved → filtered = 2 (< 3) → show all 4 unfiltered
        const cards = [card(1), card(2), card(3), card(4)];
        const out = visibleFallbackCards(cards, new Set(['r-1', 'r-2']));
        expect(out.map((c) => c.restaurant_id)).toEqual(['r-1', 'r-2', 'r-3', 'r-4']);
    });

    it('filtered exactly 3 → uses the filtered list (>= floor)', () => {
        const cards = [card(1), card(2), card(3), card(4)];
        const out = visibleFallbackCards(cards, new Set(['r-1']));
        expect(out.map((c) => c.restaurant_id)).toEqual(['r-2', 'r-3', 'r-4']);
    });

    it('caps at 10 (finite rail)', () => {
        const cards = Array.from({ length: 14 }, (_, i) => card(i));
        const out = visibleFallbackCards(cards, new Set());
        expect(out).toHaveLength(10);
        expect(out[0].restaurant_id).toBe('r-0');
        expect(out[9].restaurant_id).toBe('r-9');
    });

    it('unfiltered fallback also caps at 10 when filter would drop below 3', () => {
        // 11 cards, save 9 of them → filtered = 2 (< 3) → unfiltered, but capped 10
        const cards = Array.from({ length: 11 }, (_, i) => card(i));
        const saved = new Set(Array.from({ length: 9 }, (_, i) => `r-${i}`));
        const out = visibleFallbackCards(cards, saved);
        expect(out).toHaveLength(10);
    });
});
