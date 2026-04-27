/**
 * Shared optimistic-update helpers for InfiniteData<Page<T>> caches.
 *
 * Every paginated cache in Napkin uses the canonical Page<T> envelope
 * (lib/pagination.ts). These helpers operate on that shape so per-hook
 * onMutate/onSuccess/onError callsites are a flat list of one-liners
 * instead of repeated cache-walk boilerplate.
 *
 * TICKET-042: introduced to support cursor-cache extensions in
 * useCreateEntry, useAddTake, and useAddMember.
 *
 * See lib/mutations.md for the full pattern doc + anti-patterns.
 */
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { Page } from '@/lib/pagination';

// ── Infinite-page helpers ────────────────────────────────────────────────────

/**
 * Prepend `row` to page 0 of an InfiniteData<P> cache where P extends Page<T>.
 *
 * Edge cases handled:
 * - data === undefined → synthesises a single-page InfiniteData.
 * - data.pages === [] → pushes a synthesised page 0.
 * - pages[0].rows === undefined → treats as [].
 * - Page 0 has extra fields (e.g. trending, window_days on FeedPage):
 *   those fields are spread-preserved; only `rows` is mutated.
 */
export function prependToInfinitePages<T, P extends Page<T> = Page<T>>(
    data: InfiniteData<P> | undefined,
    row: T,
): InfiniteData<P> {
    const emptyPage: Page<T> = { rows: [row], next_cursor: null, has_more: false };

    if (!data || !data.pages || data.pages.length === 0) {
        return {
            pages: [emptyPage as P],
            pageParams: [null],
        };
    }

    const [first, ...rest] = data.pages;
    const updatedFirst: P = {
        ...first,
        rows: [row, ...(first.rows ?? [])],
    };

    return {
        ...data,
        pages: [updatedFirst, ...rest],
    };
}

/**
 * Walk every page's rows; replace the **first** row where `match(row)` returns
 * true with `replacer(row)`.
 *
 * No-op (returns data unchanged) when:
 * - data is undefined
 * - no row matches — handles the "background refetch landed first" case silently.
 */
export function swapByMatch<T, P extends Page<T> = Page<T>>(
    data: InfiniteData<P> | undefined,
    match: (row: T) => boolean,
    replacer: (row: T) => T,
): InfiniteData<P> | undefined {
    if (!data) return undefined;

    let swapped = false;
    const pages = data.pages.map((page) => {
        if (swapped) return page;
        const rows = (page.rows ?? []).map((row) => {
            if (!swapped && match(row)) {
                swapped = true;
                return replacer(row);
            }
            return row;
        });
        return { ...page, rows };
    });

    return { ...data, pages };
}

/**
 * Convenience: swap the first row whose `.id` equals `"optimistic-<nonce>"`
 * with `serverRow`. Returns data unchanged (no error) when no match.
 */
export function swapByNonce<T extends { id: string }, P extends Page<T> = Page<T>>(
    data: InfiniteData<P> | undefined,
    nonce: string,
    serverRow: T,
): InfiniteData<P> | undefined {
    return swapByMatch<T, P>(
        data,
        (row) => row.id === `optimistic-${nonce}`,
        () => serverRow,
    );
}

/**
 * Walk every page's rows; remove all rows where `match(row)` returns true.
 * Returns data unchanged when nothing matches.
 */
export function removeByMatch<T, P extends Page<T> = Page<T>>(
    data: InfiniteData<P> | undefined,
    match: (row: T) => boolean,
): InfiniteData<P> | undefined {
    if (!data) return undefined;

    const pages = data.pages.map((page) => ({
        ...page,
        rows: (page.rows ?? []).filter((row) => !match(row)),
    }));

    return { ...data, pages };
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Snapshot an InfiniteData<Page<T>> cache entry.
 *
 * Returns `{ previous, restore }` where:
 * - `previous` is the current cache value (may be undefined if not yet loaded).
 * - `restore()` writes `previous` back to the cache — call it from `onError`.
 *
 * Usage in onMutate:
 *   const { previous, restore } = snapshotInfinite<FeedEntry>(qc, key);
 *   qc.setQueryData(key, (old) => prependToInfinitePages(old, row));
 *   return { restore };
 *
 * Usage in onError:
 *   context?.restore();
 */
export function snapshotInfinite<T, P extends Page<T> = Page<T>>(
    qc: QueryClient,
    key: QueryKey,
): { previous: InfiniteData<P> | undefined; restore: () => void } {
    const previous = qc.getQueryData<InfiniteData<P>>(key);
    return {
        previous,
        restore: () => qc.setQueryData<InfiniteData<P>>(key, previous),
    };
}

/**
 * Snapshot a non-paginated cache entry (e.g. tables.detail, tables.members).
 *
 * Same interface as snapshotInfinite but for T (not InfiniteData<T>).
 */
export function snapshot<T>(
    qc: QueryClient,
    key: QueryKey,
): { previous: T | undefined; restore: () => void } {
    const previous = qc.getQueryData<T>(key);
    return {
        previous,
        restore: () => qc.setQueryData<T>(key, previous),
    };
}

// ── Flat-array helpers (for non-paginated array caches e.g. entries.forDay) ──

/**
 * Prepend `row` to a flat T[] cache.
 * Returns [row] when data is undefined.
 */
export function prependArray<T>(data: T[] | undefined, row: T): T[] {
    return data ? [row, ...data] : [row];
}

/**
 * Remove all rows from a flat T[] cache where `match(row)` returns true.
 * Returns [] when data is undefined.
 */
export function removeFromArray<T>(data: T[] | undefined, match: (row: T) => boolean): T[] {
    return data ? data.filter((row) => !match(row)) : [];
}

/**
 * Replace the first row in a flat T[] cache where `match(row)` returns true
 * with `replacer(row)`. No-op when nothing matches.
 */
export function swapInArray<T>(
    data: T[] | undefined,
    match: (row: T) => boolean,
    replacer: (row: T) => T,
): T[] {
    if (!data) return [];
    let swapped = false;
    return data.map((row) => {
        if (!swapped && match(row)) {
            swapped = true;
            return replacer(row);
        }
        return row;
    });
}
