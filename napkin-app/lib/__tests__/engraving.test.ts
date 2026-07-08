/**
 * TICKET-146 — the engraving registries. Pure, so the mark-precedence chain and
 * tint determinism are verified, not eyeballed. (TICKET-145 extends this file
 * with epithet cases.)
 */
import { markFor, tintIndex6, tintFor, cuisineGlyph, LORE_NOUN_BY_GLYPH, epithetFor, type EpithetInput } from '../engraving';
import { Colors } from '@/constants/theme';

const palette = Colors.light;

describe('markFor — the mark-precedence chain', () => {
    it('emoji wins over glyph and monogram', () => {
        expect(markFor({ name: 'Kono', cuisine: 'sushi', listEmoji: '🍜' })).toEqual({
            kind: 'emoji',
            emoji: '🍜',
        });
    });

    it('cuisine glyph fires when a cuisine is present (no emoji)', () => {
        expect(markFor({ name: 'Kono', cuisine: 'Sushi' })).toEqual({
            kind: 'glyph',
            glyph: 'fish-outline',
        });
    });

    it('a present-but-unknown cuisine still reads as a glyph (restaurant-outline), not a monogram', () => {
        expect(markFor({ name: 'Zahav', cuisine: 'Israeli' })).toEqual({
            kind: 'glyph',
            glyph: 'restaurant-outline',
        });
    });

    it('monogram fires ONLY when cuisine is null/blank, uppercased first letter', () => {
        expect(markFor({ name: 'dorian', cuisine: null })).toEqual({ kind: 'monogram', letter: 'D' });
        expect(markFor({ name: 'dorian', cuisine: '   ' })).toEqual({ kind: 'monogram', letter: 'D' });
        expect(markFor({ name: 'dorian' })).toEqual({ kind: 'monogram', letter: 'D' });
    });

    it('blank emoji is ignored (falls through to the glyph)', () => {
        expect(markFor({ name: 'Kono', cuisine: 'pizza', listEmoji: '   ' })).toEqual({
            kind: 'glyph',
            glyph: 'pizza-outline',
        });
    });

    it('empty name with no cuisine falls back to a middle-dot monogram', () => {
        expect(markFor({ name: '' })).toEqual({ kind: 'monogram', letter: '·' });
    });
});

describe('tintIndex6 — 6-way determinism', () => {
    it('is deterministic for a given seed', () => {
        expect(tintIndex6('rest-abc-123')).toBe(tintIndex6('rest-abc-123'));
    });

    it('always yields 0..5', () => {
        for (const seed of ['', 'a', 'restaurant-uuid-1', 'f2b1', 'zzzzzzzz', '0x00']) {
            expect([0, 1, 2, 3, 4, 5]).toContain(tintIndex6(seed));
        }
    });

    it('spreads across all six tints for varied seeds', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 60; i++) seen.add(tintIndex6(`seed-${i}`));
        expect(seen.size).toBe(6);
    });
});

describe('tintFor — plate ground', () => {
    it('is stable per seed and returns a palette plate token', () => {
        const tints = [
            palette.plateAmber, palette.plateOlive, palette.plateRose,
            palette.plateGrey, palette.plateSlate, palette.plateSand,
        ];
        const c = tintFor('rest-xyz', palette);
        expect(c).toBe(tintFor('rest-xyz', palette));
        expect(tints).toContain(c);
    });
});

describe('LORE_NOUN_BY_GLYPH — every glyph bucket has a noun', () => {
    it('covers all cuisine glyph buckets', () => {
        // Sampling the glyph space proves cuisineGlyph outputs always index a noun.
        for (const cuisine of ['pizza', 'sushi', 'cafe', 'wine bar', 'gelato', 'burgers', 'beer', 'bbq', 'ethiopian', null]) {
            const noun = LORE_NOUN_BY_GLYPH[cuisineGlyph(cuisine)];
            expect(typeof noun).toBe('string');
            expect(noun.length).toBeGreaterThan(0);
        }
    });
});

// ── TICKET-145 — the epithet ─────────────────────────────────────────────────
function epi(over: Partial<EpithetInput> = {}): EpithetInput {
    return {
        totalMeals: 20,
        totalPlaces: 10, // ratio 2.0 → "devoted" by default
        dominantCuisine: 'sushi',
        cityCount: 2,
        countryCount: 1,
        priceMode: 2,
        ...over,
    };
}

describe('epithetFor — the data floor', () => {
    it('returns null below 10 meals, non-null at 10', () => {
        expect(epithetFor(epi({ totalMeals: 9, totalPlaces: 9 }))).toBeNull();
        expect(epithetFor(epi({ totalMeals: 10, totalPlaces: 10, cityCount: 1 }))).not.toBeNull();
    });
});

describe('epithetFor — determinism', () => {
    it('same input → identical string, forever', () => {
        const input = epi({ dominantCuisine: 'pizza', countryCount: 2 });
        expect(epithetFor(input)).toBe(epithetFor(input));
    });
});

describe('epithetFor — adjective bands (repeat ratio = meals / places)', () => {
    it('ratio >= 1.8 → devoted', () => {
        expect(epithetFor(epi({ totalMeals: 20, totalPlaces: 10 }))).toContain('a devoted regular');
    });
    it('ratio <= 1.15 AND cityCount >= 3 → roving', () => {
        expect(epithetFor(epi({ totalMeals: 10, totalPlaces: 10, cityCount: 3, countryCount: 1 }))).toContain('a roving regular');
    });
    it('middle ratio → steady', () => {
        expect(epithetFor(epi({ totalMeals: 15, totalPlaces: 10, cityCount: 1 }))).toContain('a steady regular');
    });
    it('low ratio but < 3 cities → NOT roving (stays steady)', () => {
        expect(epithetFor(epi({ totalMeals: 10, totalPlaces: 10, cityCount: 2, countryCount: 1 }))).toContain('a steady regular');
    });
});

describe('epithetFor — noun from dominant cuisine (via glyph bucket)', () => {
    it('sushi → the fish-bucket noun (raw bar)', () => {
        expect(epithetFor(epi({ dominantCuisine: 'sushi', countryCount: 1, cityCount: 1 }))).toContain('raw bar');
    });
    it('pizza → trattoria', () => {
        expect(epithetFor(epi({ dominantCuisine: 'pizza', countryCount: 1, cityCount: 1 }))).toContain('trattoria');
    });
    it('null / unknown cuisine → small rooms', () => {
        expect(epithetFor(epi({ dominantCuisine: null, countryCount: 1, cityCount: 1 }))).toContain('small rooms');
        expect(epithetFor(epi({ dominantCuisine: 'indian', countryCount: 1, cityCount: 1 }))).toContain('small rooms');
    });
});

describe('epithetFor — qualifier precedence', () => {
    it('countryCount >= 3 wins over price mode', () => {
        expect(epithetFor(epi({ countryCount: 3, priceMode: 1, cityCount: 6 }))).toContain('across borders');
    });
    it('priceMode 4 → of the grand rooms', () => {
        expect(epithetFor(epi({ countryCount: 1, priceMode: 4, cityCount: 1 }))).toContain('of the grand rooms');
    });
    it('priceMode 1 → of cheap eats', () => {
        expect(epithetFor(epi({ countryCount: 1, priceMode: 1, cityCount: 2 }))).toContain('of cheap eats');
    });
    it('cityCount >= 5 (no country/price hit) → of many cities', () => {
        expect(epithetFor(epi({ countryCount: 1, priceMode: 2, cityCount: 5 }))).toContain('of many cities');
    });
    it('no qualifier → bare epithet, no trailing comma', () => {
        const out = epithetFor(epi({ countryCount: 1, priceMode: 2, cityCount: 1 }))!;
        expect(out).toBe('a devoted regular of the raw bar');
    });
});

describe('epithetFor — founder specimen (26 meals · 13 places · indian · 4 cities · 3 countries)', () => {
    it('reads "a devoted regular of the small rooms, across borders"', () => {
        expect(
            epithetFor({ totalMeals: 26, totalPlaces: 13, dominantCuisine: 'indian', cityCount: 4, countryCount: 3, priceMode: 3 }),
        ).toBe('a devoted regular of the small rooms, across borders');
    });
});
