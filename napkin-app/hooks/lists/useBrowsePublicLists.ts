/**
 * useBrowsePublicLists — the For You feed's public-lists block (TICKET-125;
 * viewer-keyed TICKET-189).
 *
 * A single, non-paginated read of recent public lists (cap 6), backed by the
 * `lists` edge action `browse_public` → fn_browse_public_lists(p_viewer, 6):
 * the same triple gate as public-list search (list public + owner account
 * public + NOT a Table list), ordered `updated_at DESC`, PLUS server-side
 * self-exclusion — the viewer's own lists never come back as "discovery" and
 * never consume the cap.
 *
 * VIEWER-KEYED (was global): the server result now differs per viewer, so the
 * cache key carries the userId and the query gates on it.
 *
 * Covers are public-safe: `cover_photo_url` arrives null unless the list's
 * first restaurant is a Places hero WITH attribution (`photo_source` +
 * `attribution_html` ride along for the client source gate). No user entry photo
 * ever backs a cover here.
 *
 * Non-paginated by design (locked: cap ~6, "see more" hands off to the search
 * tab's Lists segment), so this is a plain useQuery — NOT useCursorPagedQuery,
 * which is mandated only for paginated hooks. The wire shape is `{ rows }`,
 * never the Page<T> envelope (no next_cursor / has_more).
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

export function useBrowsePublicLists(userId: string | null | undefined) {
    return useQuery<PublicListResult[], Error>({
        queryKey: queryKeys.lists.browsePublic(userId ?? ''),
        queryFn: fetchBrowsePublicLists,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
