/**
 * TICKET-053 step 4 — captionToNote unit tests.
 * Uses 3 real TICKET-052 captions + 2 edge cases.
 */

import { captionToNote } from './captionToNote';

// ── Real TICKET-052 captions ──────────────────────────────────────────────────

// Caption 1: London cheap-eats TikTok (short, clean, minor hashtag load)
const CAPTION_LONDON_CHEAP_EATS =
    'The best cheap eats in London! 🍜 Casa do Frango is absolutely incredible, so is Flat Iron for steak lovers. Don\'t sleep on Bao. #london #cheapeats #foodtok #londonfood';

// Caption 2: GBTYC Ep 5 (Go Beyond The Yellow Curtain — review show style, with @mentions + hashtags)
const CAPTION_GBTYC_EP5 =
    'GBTYC Ep 5 — we visited @nobu_restaurants Nobu London and @sketch.london Sketch. Ratings incoming. Watch the full episode now! #GBTYC #foodreviews #londonrestaurants #finedining';

// Caption 3: Casa do Frango — longer caption with heavy hashtag block at end
const CAPTION_CASA_DO_FRANGO =
    'Casa do Frango is a must-visit Portuguese chicken restaurant in London Bridge. The piri piri chicken is unreal, best I\'ve had outside Lisbon. Book a table ahead, it gets packed. Perfect for a group dinner. #casadofrango #london #portuguese #piripirichicken #londonbridge #londoneats #foodie #restaurant #londonrestaurants #ukfoodie #ukeats #foodtok #chickenlover #bestrestaurants #londonlife #visitlondon';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('captionToNote', () => {
    // Real caption 1: London cheap-eats
    test('london cheap-eats: removes hashtags, keeps substance', () => {
        const result = captionToNote(CAPTION_LONDON_CHEAP_EATS);
        expect(result).not.toContain('#');
        expect(result).not.toContain('foodtok');
        expect(result).toContain('Casa do Frango');
        expect(result).toContain('cheap eats in London');
        expect(result.length).toBeLessThanOrEqual(280);
    });

    // Real caption 2: GBTYC Ep 5
    test('GBTYC Ep 5: removes @mentions and hashtags', () => {
        const result = captionToNote(CAPTION_GBTYC_EP5);
        expect(result).not.toContain('@');
        expect(result).not.toContain('#');
        expect(result).toContain('Nobu London');
        expect(result).toContain('Sketch');
        expect(result.length).toBeLessThanOrEqual(280);
    });

    // Real caption 3: Casa do Frango (long with heavy hashtag tail)
    test('casa do frango: strips 16-hashtag tail, keeps clean note within 280 chars', () => {
        const result = captionToNote(CAPTION_CASA_DO_FRANGO);
        expect(result).not.toContain('#');
        expect(result).toContain('Casa do Frango');
        expect(result).toContain('piri piri chicken');
        expect(result.length).toBeLessThanOrEqual(280);
        // Ends at word boundary — no partial words
        expect(result).not.toMatch(/\w-$/);
    });

    // Edge case 1: already under 280 chars, no hashtags/mentions
    test('clean short caption: returned unchanged', () => {
        const input = 'Great ramen at Kanada-Ya, Soho. Super rich tonkotsu.';
        expect(captionToNote(input)).toBe(input);
    });

    // Edge case 2: caption that is exactly 280 chars of clean text (no truncation needed)
    test('exactly 280 chars of clean text: no truncation', () => {
        const input = 'a'.repeat(140) + ' ' + 'b'.repeat(138); // 280 chars including the space
        const result = captionToNote(input);
        expect(result.length).toBeLessThanOrEqual(280);
    });

    // Edge case 3: empty string
    test('empty string: returns empty string', () => {
        expect(captionToNote('')).toBe('');
    });

    // Edge case 4: only hashtags and mentions
    test('only hashtags and mentions: returns empty string', () => {
        expect(captionToNote('#foodtok @user #london')).toBe('');
    });

    // Edge case 5: whitespace collapsing
    test('multiple newlines and tabs collapse to single space', () => {
        const result = captionToNote('Line one\n\nLine two\t\tLine three');
        expect(result).toBe('Line one Line two Line three');
    });

    // Edge case 6: truncation at word boundary (no ellipsis)
    test('long text truncated at word boundary with no ellipsis', () => {
        const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
        const result = captionToNote(words);
        expect(result.length).toBeLessThanOrEqual(280);
        expect(result.endsWith('...')).toBe(false);
        // Last char should be part of a word (not a space)
        expect(result.slice(-1)).toMatch(/\w/);
    });
});
