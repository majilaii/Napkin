import * as legacy from '@/components/lists/listSheetMath';
import * as shared from '../snapSheetMath';

describe('snapSheetMath extraction parity', () => {
    it.each([521, 700, 844])('keeps geometry byte-identical at H=%s', (H) => {
        expect(shared.sheetHeight(H)).toBe(legacy.sheetHeight(H));
        expect(shared.offsetsFor(H)).toEqual(legacy.offsetsFor(H));
        for (const snap of [shared.PEEK, shared.HALF, shared.FULL] as const) {
            expect(shared.visibleHeight(H, snap)).toBe(legacy.visibleHeight(H, snap));
        }
    });

    it('keeps ownership and projected settle decisions', () => {
        expect(shared.listPanOwnsSheet(true, true, 1)).toBe(true);
        expect(shared.listPanOwnsSheet(true, false, 40)).toBe(false);
        expect(shared.resolveSnap(300, -900, shared.offsetsFor(700))).toBe(shared.FULL);
    });
});
