/**
 * TICKET-130 — cuisineGlyph mapping + tint seeding, pure so the substring
 * collision guards ('breakfast' vs 'fast', 'barbecue' vs 'bar') are verified,
 * not eyeballed.
 */
import { cuisineGlyph, tintIndex } from '../cuisineGlyph';

describe('cuisineGlyph', () => {
    it('maps the ticket minimum set', () => {
        expect(cuisineGlyph('Pizza')).toBe('pizza-outline');
        expect(cuisineGlyph('Seafood')).toBe('fish-outline');
        expect(cuisineGlyph('fish & chips')).toBe('fish-outline');
        expect(cuisineGlyph('Sushi')).toBe('fish-outline');
        expect(cuisineGlyph('Cafe')).toBe('cafe-outline');
        expect(cuisineGlyph('Coffee shop')).toBe('cafe-outline');
        expect(cuisineGlyph('Bakery')).toBe('cafe-outline');
        expect(cuisineGlyph('Wine bar')).toBe('wine-outline');
        expect(cuisineGlyph('Cocktail lounge')).toBe('wine-outline');
        expect(cuisineGlyph('Bar')).toBe('wine-outline');
        expect(cuisineGlyph('Dessert')).toBe('ice-cream-outline');
        expect(cuisineGlyph('Ice cream parlor')).toBe('ice-cream-outline');
        expect(cuisineGlyph('Gelato')).toBe('ice-cream-outline');
        expect(cuisineGlyph('Burgers')).toBe('fast-food-outline');
        expect(cuisineGlyph('American')).toBe('fast-food-outline');
        expect(cuisineGlyph('Fast food')).toBe('fast-food-outline');
        expect(cuisineGlyph('Beer garden')).toBe('beer-outline');
        expect(cuisineGlyph('Gastropub')).toBe('beer-outline');
    });

    it('is case-insensitive substring matching', () => {
        expect(cuisineGlyph('NEAPOLITAN PIZZA')).toBe('pizza-outline');
        expect(cuisineGlyph('sushi omakase')).toBe('fish-outline');
    });

    it('collision guards: breakfast ≠ fast food, barbecue ≠ bar', () => {
        expect(cuisineGlyph('Breakfast')).toBe('cafe-outline');
        expect(cuisineGlyph('Brunch spot')).toBe('cafe-outline');
        expect(cuisineGlyph('Barbecue')).toBe('flame-outline');
        expect(cuisineGlyph('Korean BBQ')).toBe('flame-outline');
    });

    it('sushi bar hits fish before bar (rule order)', () => {
        expect(cuisineGlyph('Sushi bar')).toBe('fish-outline');
    });

    it('unknown / empty / null → restaurant-outline', () => {
        expect(cuisineGlyph('Ethiopian')).toBe('restaurant-outline');
        expect(cuisineGlyph('')).toBe('restaurant-outline');
        expect(cuisineGlyph(null)).toBe('restaurant-outline');
        expect(cuisineGlyph(undefined)).toBe('restaurant-outline');
    });
});

describe('tintIndex', () => {
    it('is deterministic for a given seed', () => {
        expect(tintIndex('abc-123')).toBe(tintIndex('abc-123'));
    });

    it('always yields 0, 1, or 2', () => {
        for (const seed of ['', 'a', 'restaurant-uuid-1', 'f2b1', 'zzzzzzzz', '0x00']) {
            expect([0, 1, 2]).toContain(tintIndex(seed));
        }
    });

    it('spreads across the three tints for varied seeds', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 40; i++) seen.add(tintIndex(`seed-${i}`));
        expect(seen.size).toBe(3);
    });
});
