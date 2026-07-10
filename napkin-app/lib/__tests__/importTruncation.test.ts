import { truncationNote } from '../importTruncation';

describe('truncationNote', () => {
    it('reports the honest count when a list is truncated', () => {
        expect(truncationNote(117, 20)).toBe('first 20 of 117');
    });

    it('stays silent when nothing was cut (no "20 of 20" noise)', () => {
        expect(truncationNote(20, 20)).toBeNull();
    });

    it('stays silent when the list is smaller than what we kept', () => {
        expect(truncationNote(18, 20)).toBeNull();
    });

    it('returns null for non-list imports (no list_count on the wire)', () => {
        expect(truncationNote(null, 20)).toBeNull();
        expect(truncationNote(undefined, 20)).toBeNull();
    });

    it('never emits NaN copy from a corrupt / pre-change manifest', () => {
        expect(truncationNote(NaN, 20)).toBeNull();
    });
});
