/** tasteUtils unit tests — histogram, cuisine, geography and repeat behaviour. */
import {
    HISTOGRAM_BINS,
    JUNK_VENUE_TYPES,
    cityStatAccessibilityLabel,
    cuisineStatAccessibilityLabel,
    deriveCityLedger,
    deriveRegular,
    deriveTaste,
    fillHistogram,
    hasTasteDrillInContent,
    ratingDistributionAccessibilityLabel,
    resolveTasteRouteTarget,
} from '../tasteUtils';
import type { SpotSummary } from '@/hooks/users/useUserSpots';

// ── TICKET-150 — histogram fill + city ledger + regular ─────────────────────

describe('fillHistogram', () => {
    it('expands sparse buckets into ten dense counts, ordered by bin', () => {
        const counts = fillHistogram([
            { r: 3.5, n: 6 },
            { r: 5.0, n: 2 },
            { r: 0.5, n: 1 },
        ]);
        expect(counts).toHaveLength(HISTOGRAM_BINS.length);
        expect(counts[HISTOGRAM_BINS.indexOf(0.5)]).toBe(1);
        expect(counts[HISTOGRAM_BINS.indexOf(3.5)]).toBe(6);
        expect(counts[HISTOGRAM_BINS.indexOf(5.0)]).toBe(2);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(9);
    });

    it('drops off-grid or garbage buckets and handles undefined', () => {
        expect(fillHistogram(undefined)).toEqual(new Array(10).fill(0));
        const counts = fillHistogram([
            { r: 3.7, n: 4 },      // off-grid → dropped (server snaps, this is garbage)
            { r: 4.0, n: NaN },    // non-finite → dropped
            { r: 4.5, n: -2 },     // negative → dropped
            { r: 2.0, n: 3 },
        ]);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
        expect(counts[HISTOGRAM_BINS.indexOf(2.0)]).toBe(3);
    });
});

describe('ratingDistributionAccessibilityLabel', () => {
    it('speaks only populated bins with correct singulars', () => {
        expect(ratingDistributionAccessibilityLabel(fillHistogram([
            { r: 1, n: 1 },
            { r: 4.5, n: 3 },
        ]))).toBe('Rating distribution: 1 star, 1 rating; 4.5 stars, 3 ratings');
    });

    it('has a useful empty fallback', () => {
        expect(ratingDistributionAccessibilityLabel([])).toBe('Rating distribution: no ratings');
    });
});

describe('hasTasteDrillInContent', () => {
    it('keeps unrated spot history available for geography and the emblem', () => {
        expect(hasTasteDrillInContent(0, 3)).toBe(true);
        expect(hasTasteDrillInContent(2, 0)).toBe(true);
        expect(hasTasteDrillInContent(0, 0)).toBe(false);
    });
});

describe('resolveTasteRouteTarget', () => {
    it('treats an omitted userId as self and a different canonical id as public', () => {
        expect(resolveTasteRouteTarget(undefined, 'viewer-id')).toEqual({
            targetUserId: 'viewer-id',
            isSelf: true,
        });
        expect(resolveTasteRouteTarget('friend-id', 'viewer-id')).toEqual({
            targetUserId: 'friend-id',
            isSelf: false,
        });
        expect(resolveTasteRouteTarget('viewer-id', 'viewer-id').isSelf).toBe(true);
    });
});

describe('ledger accessibility labels', () => {
    it('replaces decorative dots and terse counts with semantic sentences', () => {
        expect(cuisineStatAccessibilityLabel('Ramen', 4.25, 1)).toBe(
            'Ramen, 4.3 average from 1 rating',
        );
        expect(cuisineStatAccessibilityLabel('Thai', 3.8, 4)).toBe(
            'Thai, 3.8 average from 4 ratings',
        );
        expect(cityStatAccessibilityLabel('London', 1)).toBe('London, 1 meal');
        expect(cityStatAccessibilityLabel('Paris', 12)).toBe('Paris, 12 meals');
    });
});

function spot(over: Partial<SpotSummary>): SpotSummary {
    return {
        restaurant_id: over.restaurant_id ?? Math.random().toString(36).slice(2),
        name: 'Somewhere',
        city: null,
        country: null,
        cuisine: null,
        price_level: null,
        lat: null,
        lng: null,
        photo_url: null,
        visit_count: 1,
        avg_rating: null,
        last_visited_at: null,
        ...over,
    };
}

describe('deriveCityLedger', () => {
    it('sums meals per city (case-insensitive) and sorts by meals desc, then name', () => {
        const ledger = deriveCityLedger([
            spot({ city: 'Hong Kong', country: 'Hong Kong', visit_count: 5 }),
            spot({ city: 'hong kong', country: 'Hong Kong', visit_count: 3 }),
            spot({ city: 'Tokyo', country: 'Japan', visit_count: 4 }),
            spot({ city: 'London', country: 'UK', visit_count: 4 }),
        ]);
        expect(ledger.rows).toEqual([
            { city: 'Hong Kong', meals: 8 },   // first-seen casing kept
            { city: 'London', meals: 4 },      // tie with Tokyo → name asc
            { city: 'Tokyo', meals: 4 },
        ]);
        expect(ledger.cityCount).toBe(3);
        expect(ledger.countryCount).toBe(3);
    });

    it('caps rows at max but counts all cities; skips null cities', () => {
        const spots = ['A', 'B', 'C', 'D', 'E'].map((c, i) =>
            spot({ city: c, visit_count: 5 - i }),
        );
        spots.push(spot({ city: null, country: 'France', visit_count: 9 }));
        const ledger = deriveCityLedger(spots, 4);
        expect(ledger.rows).toHaveLength(4);
        expect(ledger.cityCount).toBe(5);
        expect(ledger.countryCount).toBe(1); // only France carried a country
    });

    it('treats a zero/garbage visit_count as one meal', () => {
        const ledger = deriveCityLedger([spot({ city: 'Paris', visit_count: 0 })]);
        expect(ledger.rows).toEqual([{ city: 'Paris', meals: 1 }]);
    });
});

describe('deriveTaste (band aggregate, junk venue types filtered)', () => {
    it('never counts generic venue types as cuisines; coverage unaffected', () => {
        const taste = deriveTaste([
            spot({ cuisine: 'Restaurant', city: 'Hong Kong', country: 'Hong Kong', visit_count: 12 }),
            spot({ cuisine: 'Hotel', city: 'Macau', country: 'Macau', visit_count: 3 }),
            spot({ cuisine: 'Ramen', city: 'Tokyo', country: 'Japan', visit_count: 2 }),
            spot({ cuisine: 'Indian', city: 'Hong Kong', country: 'Hong Kong', visit_count: 3 }),
        ]);
        // "restaurant" (12 visits) and "hotel" would have dominated before the filter.
        expect(taste.topCuisines).toEqual(['indian', 'ramen']);
        expect(taste.cityCount).toBe(3);     // junk-cuisine spots still count for coverage
        expect(taste.countryCount).toBe(3);
    });

    it('matches junk case-insensitively and after trimming', () => {
        const taste = deriveTaste([
            spot({ cuisine: '  RESTAURANT ', visit_count: 9 }),
            spot({ cuisine: 'Sushi', visit_count: 1 }),
        ]);
        expect(taste.topCuisines).toEqual(['sushi']);
    });

    it('ranks by visit_count and caps at three', () => {
        const taste = deriveTaste([
            spot({ cuisine: 'Ramen', visit_count: 5 }),
            spot({ cuisine: 'Sushi', visit_count: 4 }),
            spot({ cuisine: 'Thai', visit_count: 3 }),
            spot({ cuisine: 'Indian', visit_count: 2 }),
        ]);
        expect(taste.topCuisines).toEqual(['ramen', 'sushi', 'thai']);
    });

    it('junk list stays lowercased (matches the fn_user_taste v2 SQL list)', () => {
        for (const junk of JUNK_VENUE_TYPES) {
            expect(junk).toBe(junk.toLowerCase().trim());
        }
        expect(JUNK_VENUE_TYPES.has('restaurant')).toBe(true);
        expect(JUNK_VENUE_TYPES.has('hotel')).toBe(true);
        expect(JUNK_VENUE_TYPES.has('association or organization')).toBe(true);
        expect(JUNK_VENUE_TYPES.has('point of interest')).toBe(true);
        expect(JUNK_VENUE_TYPES.has('establishment')).toBe(true);
    });
});

describe('deriveRegular', () => {
    it('returns null when no spot has 3+ visits', () => {
        expect(deriveRegular([spot({ visit_count: 2 }), spot({ visit_count: 1 })])).toBeNull();
    });

    it('picks the most-visited spot, ties broken by most recent visit', () => {
        const result = deriveRegular([
            spot({ name: 'Kono', visit_count: 5, last_visited_at: '2026-06-01' }),
            spot({ name: 'Buvette', visit_count: 5, last_visited_at: '2026-07-01' }),
            spot({ name: 'Tatiana', visit_count: 4, last_visited_at: '2026-07-09' }),
        ]);
        expect(result).toEqual({ name: 'Buvette', visits: 5 });
    });
});
