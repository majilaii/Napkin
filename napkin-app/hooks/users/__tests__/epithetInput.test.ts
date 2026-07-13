/**
 * TICKET-145 — deriveEpithetInput reducer. Pure (imported from the test-safe
 * sibling, not the supabase-pulling hook). Proves the client-side derivation of
 * meal sum, place count, price mode, and city/country coverage.
 */
import { deriveEpithetInput, deriveTasteEmblemInput } from '../epithetInput';
import type { SpotSummary } from '../useUserSpots';

function spot(over: Partial<SpotSummary> = {}): SpotSummary {
    return {
        restaurant_id: 'r',
        name: 'Somewhere',
        city: 'London',
        country: 'UK',
        cuisine: 'indian',
        price_level: 2,
        lat: null,
        lng: null,
        photo_url: null,
        visit_count: 1,
        avg_rating: null,
        last_visited_at: null,
        ...over,
    };
}

describe('deriveEpithetInput', () => {
    it('sums meals from visit_count and counts places', () => {
        const out = deriveEpithetInput(
            [spot({ visit_count: 2 }), spot({ visit_count: 3 }), spot({ visit_count: 1 })],
            'indian',
        );
        expect(out.totalMeals).toBe(6);
        expect(out.totalPlaces).toBe(3);
        expect(out.dominantCuisine).toBe('indian');
    });

    it('price mode = the modal price_level; nulls ignored', () => {
        const out = deriveEpithetInput(
            [spot({ price_level: 2 }), spot({ price_level: 2 }), spot({ price_level: 3 }), spot({ price_level: null })],
            null,
        );
        expect(out.priceMode).toBe(2);
    });

    it('priceMode null when no spot carries a price', () => {
        const out = deriveEpithetInput([spot({ price_level: null }), spot({ price_level: null })], null);
        expect(out.priceMode).toBeNull();
    });

    it('city / country counts dedup case-insensitively', () => {
        const out = deriveEpithetInput(
            [
                spot({ city: 'London', country: 'UK' }),
                spot({ city: 'london', country: 'uk' }),
                spot({ city: 'Paris', country: 'France' }),
                spot({ city: null, country: null }),
            ],
            null,
        );
        expect(out.cityCount).toBe(2);
        expect(out.countryCount).toBe(2);
    });

    it('empty spots → zeros and null price', () => {
        expect(deriveEpithetInput([], null)).toEqual({
            totalMeals: 0,
            totalPlaces: 0,
            dominantCuisine: null,
            cityCount: 0,
            countryCount: 0,
            priceMode: null,
        });
    });
});

describe('deriveTasteEmblemInput', () => {
    it('derives only journal size and normalized geographic coverage', () => {
        expect(deriveTasteEmblemInput([
            spot({ visit_count: 2, city: ' London ', country: 'UK', cuisine: 'indian', price_level: 2 }),
            spot({ visit_count: 3, city: 'london', country: 'uk', cuisine: 'thai', price_level: 4 }),
            spot({ visit_count: 1, city: 'Paris', country: 'France', cuisine: null, price_level: null }),
        ])).toEqual({
            totalMeals: 6,
            totalPlaces: 3,
            cityCount: 2,
            countryCount: 2,
        });
    });

    it('ignores blank geography so an emblem cannot be cast from placeholders', () => {
        expect(deriveTasteEmblemInput([
            spot({ city: '   ', country: '' }),
            spot({ city: null, country: null }),
        ])).toEqual({
            totalMeals: 2,
            totalPlaces: 2,
            cityCount: 0,
            countryCount: 0,
        });
    });
});
