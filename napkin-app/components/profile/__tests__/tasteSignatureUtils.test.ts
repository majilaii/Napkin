import { formatHalfRating, ratingBandSummary } from '../tasteSignatureUtils';

describe('taste signature rating copy', () => {
    it('formats half ratings without decimals', () => {
        expect(formatHalfRating(0.5)).toBe('½');
        expect(formatHalfRating(3.5)).toBe('3½');
        expect(formatHalfRating(4)).toBe('4');
    });

    it('describes the middle rating band', () => {
        expect(ratingBandSummary([0, 0, 0, 0, 0, 1, 3, 3, 3, 0])).toBe(
            'most marks land between 3½ and 4½',
        );
    });

    it('stays quiet for thin data', () => {
        expect(ratingBandSummary([0, 0, 0, 0, 0, 0, 1, 1, 0, 0])).toBeNull();
    });
});
