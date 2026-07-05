/**
 * TICKET-103 — the sparse-tail gate. Show the caught-up mark + discovery ledger
 * tail iff the feed reached true end-of-list with < 8 rows loaded.
 */
import { shouldShowSparseTail, SPARSE_TAIL_ROW_CEILING } from '../feedRouting';

function rowsOfLength(n: number): unknown[] {
    return Array.from({ length: n }, (_, i) => ({ id: `r-${i}` }));
}

describe('shouldShowSparseTail', () => {
    it('ceiling is 8', () => {
        expect(SPARSE_TAIL_ROW_CEILING).toBe(8);
    });

    it('hasNextPage true → false (more pages could arrive)', () => {
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(2), hasNextPage: true, isLoading: false }),
        ).toBe(false);
    });

    it('zero rows → false (that is the empty state, not sparse)', () => {
        expect(
            shouldShowSparseTail({ rows: [], hasNextPage: false, isLoading: false }),
        ).toBe(false);
    });

    it('>= 8 rows → false (feed is healthy, rail owns discovery)', () => {
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(8), hasNextPage: false, isLoading: false }),
        ).toBe(false);
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(12), hasNextPage: false, isLoading: false }),
        ).toBe(false);
    });

    it('< 8 rows AND no next page → true (thin, end-of-list)', () => {
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(2), hasNextPage: false, isLoading: false }),
        ).toBe(true);
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(7), hasNextPage: false, isLoading: false }),
        ).toBe(true);
    });

    it('isLoading true → false (never appears mid first-page)', () => {
        expect(
            shouldShowSparseTail({ rows: rowsOfLength(2), hasNextPage: false, isLoading: true }),
        ).toBe(false);
    });
});
