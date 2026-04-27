/**
 * Unit tests for lib/optimistic.ts — pure functions, no QueryClient or React needed.
 * TICKET-042.
 */

import type { InfiniteData } from '@tanstack/react-query';
import type { Page } from '@/lib/pagination';
import {
    prependToInfinitePages,
    swapByMatch,
    swapByNonce,
    removeByMatch,
    prependArray,
    removeFromArray,
    swapInArray,
} from './optimistic';

// ── Test types ────────────────────────────────────────────────────────────────

interface Row {
    id: string;
    value: string;
}

type TestPage = Page<Row>;

function makePage(rows: Row[], extra: Record<string, unknown> = {}): TestPage {
    return { rows, next_cursor: null, has_more: false, ...extra };
}

function makeInfinite(pages: TestPage[], pageParams: unknown[] = []): InfiniteData<TestPage> {
    return { pages, pageParams: pageParams.length ? pageParams : pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)) };
}

// ── prependToInfinitePages ────────────────────────────────────────────────────

describe('prependToInfinitePages', () => {
    const newRow: Row = { id: 'new', value: 'new' };

    it('creates a single-page InfiniteData when data is undefined', () => {
        const result = prependToInfinitePages<Row>(undefined, newRow);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].rows).toEqual([newRow]);
        expect(result.pageParams).toEqual([null]);
    });

    it('creates a single page when pages array is empty', () => {
        const data = makeInfinite([], []);
        const result = prependToInfinitePages(data, newRow);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].rows).toEqual([newRow]);
    });

    it('prepends to page 0 rows only, leaving other pages intact', () => {
        const page0 = makePage([{ id: 'a', value: 'a' }]);
        const page1 = makePage([{ id: 'b', value: 'b' }]);
        const data = makeInfinite([page0, page1]);
        const result = prependToInfinitePages(data, newRow);
        expect(result.pages[0].rows).toEqual([newRow, { id: 'a', value: 'a' }]);
        expect(result.pages[1].rows).toEqual([{ id: 'b', value: 'b' }]);
    });

    it('preserves extra page-0 fields (trending, window_days) when prepending', () => {
        type FeedPage = TestPage & { trending: string[]; window_days: number };
        const page0: FeedPage = {
            rows: [{ id: 'a', value: 'a' }],
            next_cursor: 'cursor-1',
            has_more: true,
            trending: ['r1', 'r2'],
            window_days: 7,
        };
        const data: InfiniteData<FeedPage> = { pages: [page0], pageParams: [null] };
        const result = prependToInfinitePages<Row, FeedPage>(data, newRow);
        const p0 = result.pages[0] as FeedPage;
        expect(p0.trending).toEqual(['r1', 'r2']);
        expect(p0.window_days).toBe(7);
        expect(p0.next_cursor).toBe('cursor-1');
        expect(p0.rows[0]).toEqual(newRow);
    });

    it('handles page 0 with rows: undefined defensively', () => {
        const page0 = { rows: undefined as unknown as Row[], next_cursor: null, has_more: false };
        const data = makeInfinite([page0 as TestPage]);
        const result = prependToInfinitePages(data, newRow);
        expect(result.pages[0].rows).toEqual([newRow]);
    });
});

// ── swapByMatch ───────────────────────────────────────────────────────────────

describe('swapByMatch', () => {
    it('returns undefined when data is undefined', () => {
        expect(swapByMatch<Row>(undefined, () => true, (r) => r)).toBeUndefined();
    });

    it('replaces the first matching row and leaves the rest intact', () => {
        const page = makePage([
            { id: '1', value: 'old' },
            { id: '2', value: 'keep' },
        ]);
        const data = makeInfinite([page]);
        const result = swapByMatch(data, (r) => r.id === '1', () => ({ id: '1', value: 'new' }))!;
        expect(result.pages[0].rows).toEqual([
            { id: '1', value: 'new' },
            { id: '2', value: 'keep' },
        ]);
    });

    it('only replaces the FIRST match, not subsequent matches', () => {
        const page = makePage([
            { id: '1', value: 'target' },
            { id: '2', value: 'target' },
        ]);
        const data = makeInfinite([page]);
        const result = swapByMatch<Row>(
            data,
            (r) => r.value === 'target',
            (r) => ({ ...r, value: 'replaced' }),
        )!;
        expect(result.pages[0].rows[0].value).toBe('replaced');
        expect(result.pages[0].rows[1].value).toBe('target');
    });

    it('is a no-op when no row matches', () => {
        const page = makePage([{ id: '1', value: 'a' }]);
        const data = makeInfinite([page]);
        const result = swapByMatch(data, () => false, (r) => r)!;
        expect(result.pages[0].rows).toEqual(page.rows);
    });

    it('searches across multiple pages and replaces in the correct page', () => {
        const page0 = makePage([{ id: 'a', value: 'a' }]);
        const page1 = makePage([{ id: 'b', value: 'b' }]);
        const data = makeInfinite([page0, page1]);
        const result = swapByMatch(data, (r) => r.id === 'b', () => ({ id: 'b', value: 'patched' }))!;
        expect(result.pages[0].rows[0].value).toBe('a');
        expect(result.pages[1].rows[0].value).toBe('patched');
    });
});

// ── swapByNonce ───────────────────────────────────────────────────────────────

describe('swapByNonce', () => {
    it('returns undefined when data is undefined', () => {
        expect(swapByNonce<Row>(undefined, 'abc', { id: 'real', value: 'v' })).toBeUndefined();
    });

    it('replaces a row whose id matches optimistic-<nonce>', () => {
        const page = makePage([
            { id: 'optimistic-abc', value: 'pending' },
            { id: 'server-1', value: 'real' },
        ]);
        const data = makeInfinite([page]);
        const serverRow: Row = { id: 'server-new', value: 'from-server' };
        const result = swapByNonce(data, 'abc', serverRow)!;
        expect(result.pages[0].rows[0]).toEqual(serverRow);
        expect(result.pages[0].rows[1].id).toBe('server-1');
    });

    it('is a no-op when nonce is not found (background refetch landed first)', () => {
        const page = makePage([{ id: 'server-real', value: 'real' }]);
        const data = makeInfinite([page]);
        const result = swapByNonce(data, 'missing', { id: 'x', value: 'y' })!;
        expect(result.pages[0].rows).toEqual(page.rows);
    });
});

// ── removeByMatch ─────────────────────────────────────────────────────────────

describe('removeByMatch', () => {
    it('returns undefined when data is undefined', () => {
        expect(removeByMatch<Row>(undefined, () => true)).toBeUndefined();
    });

    it('removes matching rows from all pages', () => {
        const page0 = makePage([
            { id: '1', value: 'remove' },
            { id: '2', value: 'keep' },
        ]);
        const page1 = makePage([
            { id: '3', value: 'remove' },
            { id: '4', value: 'keep' },
        ]);
        const data = makeInfinite([page0, page1]);
        const result = removeByMatch<Row>(data, (r) => r.value === 'remove')!;
        expect(result.pages[0].rows).toEqual([{ id: '2', value: 'keep' }]);
        expect(result.pages[1].rows).toEqual([{ id: '4', value: 'keep' }]);
    });

    it('is a no-op when nothing matches', () => {
        const page = makePage([{ id: '1', value: 'a' }]);
        const data = makeInfinite([page]);
        const result = removeByMatch(data, () => false)!;
        expect(result.pages[0].rows).toEqual(page.rows);
    });
});

// ── prependArray ──────────────────────────────────────────────────────────────

describe('prependArray', () => {
    it('returns [row] when data is undefined', () => {
        expect(prependArray<Row>(undefined, { id: 'a', value: 'a' })).toEqual([{ id: 'a', value: 'a' }]);
    });

    it('prepends to an existing array', () => {
        const existing = [{ id: 'b', value: 'b' }];
        expect(prependArray(existing, { id: 'a', value: 'a' })).toEqual([
            { id: 'a', value: 'a' },
            { id: 'b', value: 'b' },
        ]);
    });
});

// ── removeFromArray ───────────────────────────────────────────────────────────

describe('removeFromArray', () => {
    it('returns [] when data is undefined', () => {
        expect(removeFromArray<Row>(undefined, () => true)).toEqual([]);
    });

    it('removes matching items', () => {
        const arr = [{ id: '1', value: 'a' }, { id: '2', value: 'b' }];
        expect(removeFromArray(arr, (r) => r.id === '1')).toEqual([{ id: '2', value: 'b' }]);
    });
});

// ── swapInArray ───────────────────────────────────────────────────────────────

describe('swapInArray', () => {
    it('returns [] when data is undefined', () => {
        expect(swapInArray<Row>(undefined, () => true, (r) => r)).toEqual([]);
    });

    it('replaces the first matching row', () => {
        const arr = [
            { id: '1', value: 'old' },
            { id: '2', value: 'keep' },
        ];
        const result = swapInArray(arr, (r) => r.id === '1', () => ({ id: '1', value: 'new' }));
        expect(result).toEqual([
            { id: '1', value: 'new' },
            { id: '2', value: 'keep' },
        ]);
    });

    it('is a no-op when nothing matches', () => {
        const arr = [{ id: '1', value: 'a' }];
        const result = swapInArray(arr, () => false, (r) => r);
        expect(result).toEqual(arr);
    });
});
