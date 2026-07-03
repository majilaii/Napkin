/**
 * useUserReviews — paginated diary rows WITH written notes (TICKET-092).
 * Same shape/cursor as useUserDiary; the server filters to non-empty content.
 * Gated server-side: self always; stranger requires public profile.
 */
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, type Page } from '@/lib/pagination';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { DiaryEntryRow } from './useUserProfile';

async function fetchReviewsPage(
    identifier: string,
    cursor: string | null,
): Promise<Page<DiaryEntryRow>> {
    const body: Record<string, unknown> = { identifier };
    if (cursor) body.cursor = cursor;
    return callEdgeFn<Page<DiaryEntryRow>>('user-profile', { action: 'reviews', body });
}

export function useUserReviews(identifier: string | null | undefined) {
    return useCursorPagedQuery<DiaryEntryRow>({
        queryKey: queryKeys.users.reviews(identifier ?? ''),
        fetchPage: (cursor) => fetchReviewsPage(identifier!, cursor),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}
