import { chooseMosaicLayout } from './photoMosaic';

describe('chooseMosaicLayout', () => {
    it('returns empty for 0 photos', () => {
        expect(chooseMosaicLayout(0)).toBe('empty');
    });

    it('returns empty for negative count', () => {
        expect(chooseMosaicLayout(-1)).toBe('empty');
    });

    it('returns single for 1 photo', () => {
        expect(chooseMosaicLayout(1)).toBe('single');
    });

    it('returns two for 2 photos', () => {
        expect(chooseMosaicLayout(2)).toBe('two');
    });

    it('returns three for 3 photos', () => {
        expect(chooseMosaicLayout(3)).toBe('three');
    });

    it('returns four for 4 photos', () => {
        expect(chooseMosaicLayout(4)).toBe('four');
    });

    it('returns overflow for 5 photos', () => {
        expect(chooseMosaicLayout(5)).toBe('overflow');
    });

    it('returns overflow for 6 photos', () => {
        expect(chooseMosaicLayout(6)).toBe('overflow');
    });
});
