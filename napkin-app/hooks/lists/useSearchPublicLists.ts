/**
 * Query hook: keyset-paginated search of publicly available lists (TICKET-106).
 *
 * Backed by the `lists` edge action `search_public`, which triple-gates in SQL
 * (list public + owner account public + NOT a Table list). Min 2 chars to fire.
 * Uses the canonical useCursorPagedQuery — never open-code useInfiniteQuery.
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';

/** One public-list search result row. The RPC never returns table_id. */
export interface PublicListResult {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    emoji: string | null;
    entry_count: number;
    updated_at: string;
    owner_display_name: string | null;
    owner_avatar_url: string | null;
    owner_username: string | null;
    /**
     * First restaurant photo in the list. Present for the Feed browse response;
     * optional so search results from an older deployed edge function remain
     * compatible while the function rolls out.
     */
    cover_photo_url?: string | null;
}

async function fetchPublicListsPage(
    q: string,
    cursor: string | null,
): Promise<Page<PublicListResult>> {
    return callEdgeFn<Page<PublicListResult>>('lists', {
        body: { action: 'search_public', q, cursor: cursor ?? undefined },
    });
}

export function useSearchPublicLists(q: string) {
    const trimmed = q.trim();
    return useCursorPagedQuery<PublicListResult>({
        queryKey: queryKeys.lists.searchPublic(trimmed),
        fetchPage: (cursor) => fetchPublicListsPage(trimmed, cursor),
        enabled: trimmed.length >= 2,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages of public-list results. */
export function flattenPublicLists(
    data: ReturnType<typeof useSearchPublicLists>['data'],
): PublicListResult[] {
    return flattenPages(data);
}
