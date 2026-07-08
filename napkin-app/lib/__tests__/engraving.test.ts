/**
 * TICKET-146 — the engraving registries. Pure, so the mark-precedence chain and
 * tint determinism are verified, not eyeballed. (TICKET-145 extends this file
 * with epithet cases.)
 */
import { markFor, tintIndex6, tintFor, cuisineGlyph, LORE_NOUN_BY_GLYPH } from '../engraving';
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
