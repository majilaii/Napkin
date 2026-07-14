import {
    FULL,
    HALF,
    PEEK,
    PEEK_FLOOR,
    listPanOwnsSheet,
    offsetsFor,
    resolveSheetMode,
    resolveSnap,
    sheetHeight,
    visibleHeight,
} from '../listSheetMath';

describe('offsetsFor / visibleHeight', () => {
    it('derives visible heights and translateY offsets from usable height', () => {
        const H = 800;
        expect(sheetHeight(H)).toBeCloseTo(736);
        expect(visibleHeight(H, FULL)).toBeCloseTo(736);
        expect(visibleHeight(H, HALF)).toBeCloseTo(448);
        expect(visibleHeight(H, PEEK)).toBeCloseTo(176); // max(128, floor 176)

        const [peek, half, full] = offsetsFor(H);
        // offset = SHEET_H − visibleHeight; full is pinned at 0.
        expect(peek).toBeCloseTo(736 - 176);
        expect(half).toBeCloseTo(736 - 448);
        expect(full).toBe(0);
    });

    it('applies the 176pt peek floor on the smallest viewport (iPhone SE)', () => {
        const H = 521; // usable ≈ screen − top inset
        expect(H * 0.16).toBeLessThan(PEEK_FLOOR);
        expect(visibleHeight(H, PEEK)).toBe(PEEK_FLOOR);
        expect(offsetsFor(H)[PEEK]).toBeCloseTo(sheetHeight(H) - PEEK_FLOOR);
    });
});

describe('resolveSnap', () => {
    const H = 800;
    const offsets = offsetsFor(H);

    it('rests on the nearest snap with no velocity', () => {
        expect(resolveSnap(offsets[HALF], 0, offsets)).toBe(HALF);
        expect(resolveSnap(offsets[FULL], 0, offsets)).toBe(FULL);
        expect(resolveSnap(offsets[PEEK], 0, offsets)).toBe(PEEK);
    });

    it('flings to the velocity-projected snap (down commits peek, up commits full)', () => {
        // From half, a fast downward flick (translateY increasing) → peek.
        expect(resolveSnap(offsets[HALF], 2000, offsets)).toBe(PEEK);
        // From half, a fast upward flick (translateY decreasing) → full.
        expect(resolveSnap(offsets[HALF], -2000, offsets)).toBe(FULL);
    });

    it('lands on a valid snap after a reversed drag (down then back up)', () => {
        // Released a hair past half with a gentle settle velocity → half.
        expect(resolveSnap(offsets[HALF] + 6, -20, offsets)).toBe(HALF);
    });
});

describe('listPanOwnsSheet (A9 ownership)', () => {
    it('below full the sheet always takes the pan', () => {
        expect(listPanOwnsSheet(false, false, -5)).toBe(true);
        expect(listPanOwnsSheet(false, true, 5)).toBe(true);
    });

    it('at full only a downward drag that began at top takes the sheet', () => {
        expect(listPanOwnsSheet(true, true, 12)).toBe(true);   // A9-2
        expect(listPanOwnsSheet(true, true, -12)).toBe(false); // up → list scrolls
        expect(listPanOwnsSheet(true, false, 12)).toBe(false); // began scrolled → list scrolls
    });
});

describe('edit round-trip scroll-state reset (review G3 regression probe)', () => {
    it('the reset restores pull-down-from-top sheet ownership after edit', () => {
        // Scrolled at full → the tracked offset is positive.
        let scrollOffset = 400;
        // Enter edit: the list implementation swaps and the tracked offset is
        // reset to 0 (the G3 fix in ListDetailSheet's editing effect). Exit
        // edit mounts a fresh list at top — offset agrees.
        scrollOffset = 0;
        // Back at full, drag down from the top: the sheet must own the pan.
        expect(listPanOwnsSheet(true, scrollOffset <= 0, 12)).toBe(true);
    });

    it('without the reset the stranded offset dead-drags the sheet (the bug)', () => {
        const strandedOffset = 400; // never reset across the impl swap
        expect(listPanOwnsSheet(true, strandedOffset <= 0, 12)).toBe(false);
    });
});

describe('resolveSheetMode (review F3)', () => {
    it('locks the sheet for any permitted edit, ranked or not', () => {
        expect(resolveSheetMode(true, true, true)).toEqual({ locked: true, reorder: true });
        // Unranked edit still locks (full + pans off); only the reorder swap is gated.
        expect(resolveSheetMode(true, true, false)).toEqual({ locked: true, reorder: false });
    });

    it('never locks without edit permission or outside edit mode', () => {
        expect(resolveSheetMode(true, false, true)).toEqual({ locked: false, reorder: false });
        expect(resolveSheetMode(false, true, true)).toEqual({ locked: false, reorder: false });
        expect(resolveSheetMode(false, false, false)).toEqual({ locked: false, reorder: false });
    });
});
