/**
 * useRestaurantReviews — paginated public reviews for one restaurant
 * (TICKET-154, the Letterboxd-style all-reviews page).
 *
 * Same PublicReviewCard shape as the capped list on action=page, keyset
 * cursor family (created_at, entry_id). POST body per pagination doctrine —
 * cursor strings don't belong in query params.
 */
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, type Page } from '@/lib/pagination';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { PublicReviewCard } from './useRestaurantPage';

async function fetchReviewsPage(
    restaurantId: string,
    cursor: string | null,
): Promise<Page<PublicReviewCard>> {
    const body: Record<string, unknown> = { restaurant_id: restaurantId };
    if (cursor) body.cursor = cursor;
    return callEdgeFn<Page<PublicReviewCard>>('restaurant-history', {
        action: 'reviews',
        body,
    });
}

export function useRestaurantReviews(restaurantId: string | null | undefined) {
    return useCursorPagedQuery<PublicReviewCard>({
        queryKey: queryKeys.restaurants.reviews(restaurantId ?? ''),
        fetchPage: (cursor) => fetchReviewsPage(restaurantId!, cursor),
        enabled: !!restaurantId,
        staleTime: 1000 * 60 * 5,
    });
}
