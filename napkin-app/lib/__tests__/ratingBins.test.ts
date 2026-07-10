import { halfDistFromLegacy } from '../ratingBins';

describe('halfDistFromLegacy (TICKET-154)', () => {
    it('lands whole-star counts on whole-star bins', () => {
        // legacy [1★, 2★, 3★, 4★, 5★] = [0, 1, 0, 2, 3]
        const half = halfDistFromLegacy([0, 1, 0, 2, 3]);
        expect(half).toHaveLength(10);
        // bins: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
        expect(half).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0, 3]);
    });

    it('handles empty and short arrays', () => {
        expect(halfDistFromLegacy([])).toEqual(new Array(10).fill(0));
        expect(halfDistFromLegacy([2])).toEqual([0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('total count is preserved', () => {
        const legacy = [3, 1, 4, 1, 5];
        const half = halfDistFromLegacy(legacy);
        expect(half.reduce((a, b) => a + b, 0)).toBe(legacy.reduce((a, b) => a + b, 0));
    });
});
