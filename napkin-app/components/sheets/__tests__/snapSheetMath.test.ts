import {
    DEFAULT_SNAP_METRICS,
    FULL,
    HALF,
    PEEK,
    PLACES_SNAP_METRICS,
    listPanOwnsSheet,
    offsetsFor,
    resolveSnap,
    sheetHeight,
    visibleHeight,
} from '../snapSheetMath';

describe('snapSheetMath behavior', () => {
    it('keeps the proven ListDetail defaults', () => {
        const H = 800;
        expect(DEFAULT_SNAP_METRICS).toEqual({
            peekRatio: 0.16,
            peekFloor: 176,
            halfRatio: 0.56,
            fullRatio: 0.92,
        });
        expect(sheetHeight(H)).toBeCloseTo(736);
        expect(visibleHeight(H, PEEK)).toBe(176);
        expect(visibleHeight(H, HALF)).toBeCloseTo(448);
        expect(visibleHeight(H, FULL)).toBeCloseTo(736);
        expect(offsetsFor(H)[0]).toBeCloseTo(560);
        expect(offsetsFor(H)[1]).toBeCloseTo(288);
        expect(offsetsFor(H)[2]).toBe(0);
    });

    it('gives Places a 250pt peek without changing the other detents', () => {
        const H = 605;
        expect(visibleHeight(H, PEEK, PLACES_SNAP_METRICS)).toBe(250);
        expect(visibleHeight(H, HALF, PLACES_SNAP_METRICS)).toBeCloseTo(H * 0.56);
        expect(visibleHeight(H, FULL, PLACES_SNAP_METRICS)).toBeCloseTo(H * 0.92);
        expect(offsetsFor(H, PLACES_SNAP_METRICS)[PEEK]).toBeCloseTo(H * 0.92 - 250);
    });

    it('keeps ownership and projected settle decisions', () => {
        expect(listPanOwnsSheet(true, true, 1)).toBe(true);
        expect(listPanOwnsSheet(true, false, 40)).toBe(false);
        expect(resolveSnap(300, -900, offsetsFor(700))).toBe(FULL);
    });
});
