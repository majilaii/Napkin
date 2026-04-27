/**
 * useCriticsAdminList — paginated list of professional critic reviews for the
 * operator admin surface. TICKET-033
 *
 * Wraps useCursorPagedQuery (repo mandate). Sorted by scraped_at desc, id desc.
 * Each page is fetched via critics-admin?action=list (POST).
 *
 * Params:
 *   includeSuppressed — defaults to true so operator can see + un-suppress
 *   enabled           — set to `isAdmin === true` to avoid firing before gate
 */

import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { CriticAdminRow } from '@/types/admin';

interface UseCriticsAdminListOptions {
    includeSuppressed?: boolean;
    enabled?: boolean;
}

async function fetchCriticsPage(
    cursor: string | null,
    includeSuppressed: boolean,
): Promise<Page<CriticAdminRow>> {
    return callEdgeFn<Page<CriticAdminRow>>('critics-admin', {
        action: 'list',
        body: {
            cursor: cursor ?? null,
            include_suppressed: includeSuppressed,
        },
    });
}

export function useCriticsAdminList(options: UseCriticsAdminListOptions = {}) {
    const { includeSuppressed = true, enabled = true } = options;

    return useCursorPagedQuery<CriticAdminRow>({
        queryKey: queryKeys.admin.criticsList(),
        fetchPage: (cursor) => fetchCriticsPage(cursor, includeSuppressed),
        enabled,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages into a flat array of CriticAdminRow. */
export function flattenCriticsAdminList(
    data: ReturnType<typeof useCriticsAdminList>['data'],
) {
    return flattenPages(data);
}
