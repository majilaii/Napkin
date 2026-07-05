/**
 * TICKET-103 — the feed routing predicate. Prose or photos → note card;
 * bare rating → ledger line. Tested against all four content×photo combos.
 * TICKET-104 — plus the DiscoveryLedger self-gate: it shows only when the
 * horizontal rail is hidden, so discovery never renders twice on one screen.
 */
import { isNoteCard, shouldShowDiscoveryLedger } from '../feedRouting';

function row(content: string | null, photos: string[]) {
    return { content, photos };
}

describe('isNoteCard', () => {
    it('content + photos → note card', () => {
        expect(isNoteCard(row('lovely', ['p1']))).toBe(true);
    });

    it('content only → note card', () => {
        expect(isNoteCard(row('lovely', []))).toBe(true);
    });

    it('photo only → note card', () => {
        expect(isNoteCard(row(null, ['p1']))).toBe(true);
        expect(isNoteCard(row('', ['p1']))).toBe(true);
    });

    it('neither → ledger line', () => {
        expect(isNoteCard(row(null, []))).toBe(false);
        expect(isNoteCard(row('', []))).toBe(false);
    });

    it('whitespace-only content is not prose → ledger line', () => {
        expect(isNoteCard(row('   \n  ', []))).toBe(false);
    });

    it('whitespace-only content but has a photo → note card', () => {
        expect(isNoteCard(row('   ', ['p1']))).toBe(true);
    });
});

describe('shouldShowDiscoveryLedger', () => {
    it('hidden rail → ledger shows (it owns discovery for the screen)', () => {
        expect(shouldShowDiscoveryLedger('hidden')).toBe(true);
    });

    it('trending rail → ledger stands down (no double discovery)', () => {
        expect(shouldShowDiscoveryLedger('trending')).toBe(false);
    });

    it('fallback rail → ledger stands down (no double discovery)', () => {
        expect(shouldShowDiscoveryLedger('fallback')).toBe(false);
    });
});
