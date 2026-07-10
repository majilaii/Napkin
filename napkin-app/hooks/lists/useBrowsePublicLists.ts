/**
 * useBrowsePublicLists — the For You feed's public-lists block (TICKET-125).
 *
 * A single, non-paginated read of recent public lists (cap 6), backed by the
 * `lists` edge action `browse_public`. That action reuses fn_search_public_lists
 * with an EMPTY query — the same triple gate as public-list search (list public +
 * owner account public + NOT a Table list), ordered `updated_at DESC` (recency).
 *
 * Non-paginated by design (locked: cap ~6, "see more" hands off to the search
 * tab's Lists segment), so this is a plain useQuery — NOT useCursorPagedQuery,
 * which is mandated only for paginated hooks. The wire shape is `{ rows }`, never
 * the Page<T> envelope (no next_cursor / has_more).
 *
 * Global (not per-viewer): public lists are the same for everyone, so no userId
 * gate and one shared cache key.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { PublicListResult } from './useSearchPublicLists';

export type { PublicListResult };

async function fetchBrowsePublicLists(): Promise<PublicListResult[]> {
    // callEdgeFn strips the outer { data } envelope → { rows } here.
    const data = await callEdgeFn<{ rows: PublicListResult[] }>('lists', {
        body: { action: 'browse_public' },
    });
    return data?.rows ?? [];
}

export function useBrowsePublicLists() {
    return useQuery<PublicListResult[], Error>({
        queryKey: queryKeys.lists.browsePublic(),
        queryFn: fetchBrowsePublicLists,
        staleTime: 1000 * 60 * 5,
    });
}
