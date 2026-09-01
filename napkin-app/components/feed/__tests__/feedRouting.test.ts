/** TICKET-226 — deterministic three-weight routing at the photo boundary. */
import { feedWeight, isNoteCard } from '../feedRouting';

function row(content: string | null, photos: string[]) {
    return { content, photos };
}

describe('feedWeight', () => {
    it('routes a bare rating to the ledger weight', () => {
        expect(feedWeight(row(null, []))).toBe('ledger');
        expect(feedWeight(row('', []))).toBe('ledger');
        expect(feedWeight(row('   \n  ', []))).toBe('ledger');
    });

    it('routes prose without a photo to the compact note row', () => {
        expect(feedWeight(row('lovely', []))).toBe('note');
    });

    it('keeps the one-photo boundary in the note-with-thumb weight', () => {
        expect(feedWeight(row('lovely', ['p1']))).toBe('note');
        expect(feedWeight(row(null, ['p1']))).toBe('note');
    });

    it('routes two or more photos to the compressed card with or without prose', () => {
        expect(feedWeight(row('lovely', ['p1', 'p2']))).toBe('card');
        expect(feedWeight(row(null, ['p1', 'p2']))).toBe('card');
        expect(feedWeight(row('', ['p1', 'p2', 'p3']))).toBe('card');
    });
});

describe('isNoteCard compatibility alias', () => {
    it('is false only for ledger rows', () => {
        expect(isNoteCard(row(null, []))).toBe(false);
        expect(isNoteCard(row('lovely', []))).toBe(true);
        expect(isNoteCard(row(null, ['p1', 'p2']))).toBe(true);
    });
});
