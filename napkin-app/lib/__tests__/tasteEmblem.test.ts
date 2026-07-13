import { tasteEmblemFor, TASTE_EMBLEM_MEAL_FLOOR } from '../tasteEmblem';
import type { TasteEmblemInput } from '../tasteEmblem';

function input(overrides: Partial<TasteEmblemInput> = {}): TasteEmblemInput {
    return {
        totalMeals: 12,
        totalPlaces: 10,
        cityCount: 1,
        countryCount: 1,
        ...overrides,
    };
}

describe('tasteEmblemFor', () => {
    it('waits for ten meals and at least one distinct place', () => {
        expect(tasteEmblemFor(input({ totalMeals: TASTE_EMBLEM_MEAL_FLOOR - 1 }))).toBeNull();
        expect(tasteEmblemFor(input({ totalMeals: TASTE_EMBLEM_MEAL_FLOOR, totalPlaces: 0 }))).toBeNull();
        expect(tasteEmblemFor(input({ totalMeals: TASTE_EMBLEM_MEAL_FLOOR }))).not.toBeNull();
    });

    it('waits for usable geography instead of treating missing locations as concentrated', () => {
        expect(tasteEmblemFor(input({ cityCount: 0, countryCount: 0 }))).toBeNull();
        expect(tasteEmblemFor(input({ cityCount: 1, countryCount: 0 }))).not.toBeNull();
        expect(tasteEmblemFor(input({ cityCount: 0, countryCount: 1 }))).not.toBeNull();
    });

    it.each([
        [{ cityCount: 3, countryCount: 1, totalMeals: 12, totalPlaces: 10 }, 'compass'],
        [{ cityCount: 1, countryCount: 2, totalMeals: 12, totalPlaces: 10 }, 'compass'],
        [{ cityCount: 3, countryCount: 1, totalMeals: 15, totalPlaces: 10 }, 'atlas'],
        [{ cityCount: 1, countryCount: 1, totalMeals: 12, totalPlaces: 10 }, 'lantern'],
        [{ cityCount: 1, countryCount: 1, totalMeals: 15, totalPlaces: 10 }, 'hearth'],
    ] as const)('casts observable journal behaviour %o as %s', (overrides, key) => {
        expect(tasteEmblemFor(input(overrides))?.key).toBe(key);
    });

    it('treats the 1.5 meals-per-place boundary as returning', () => {
        expect(tasteEmblemFor(input({ totalMeals: 15, totalPlaces: 10 }))?.facets[1]).toBe('Returning');
        expect(tasteEmblemFor(input({ totalMeals: 14, totalPlaces: 10 }))?.facets[1]).toBe('Discovering');
    });

    it('uses observable concentration language rather than inferring a home location', () => {
        const concentrated = tasteEmblemFor(input({ cityCount: 1, countryCount: 1 }));
        expect(concentrated?.facets[0]).toBe('Concentrated');
        expect(concentrated?.description.toLowerCase()).not.toContain('home');
    });

    it('is deterministic for the same observable journal behaviour', () => {
        const base = input({ cityCount: 4, totalMeals: 20, totalPlaces: 12 });
        expect(tasteEmblemFor(base)).toEqual(tasteEmblemFor(base));
    });
});
