/**
 * useReserveLink — lazily resolve a restaurant's direct booking-page URL
 * (TICKET-149).
 *
 * Fired only when the page payload shows the row was never reserve-checked
 * (or its null check went stale): the server scans the venue's website for
 * a booking-platform link, caches the result on the row, and returns
 * { reserve_url }. Subsequent page loads read the cached column off the
 * page payload and never re-fire this.
 */
import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export function useReserveLink(
    restaurantId: string | null | undefined,
    enabled: boolean,
) {
    return useQuery({
        queryKey: queryKeys.restaurants.reserveLink(restaurantId ?? ''),
        queryFn: () =>
            callEdgeFn<{ reserve_url: string | null }>('restaurant-history', {
                method: 'GET',
                action: 'reserve_link',
                params: { restaurant_id: restaurantId! },
            }),
        enabled: !!restaurantId && enabled,
        // The server caches on the row; within a session the answer is final.
        staleTime: Infinity,
        // A venue-website fetch can legitimately time out once — one retry.
        retry: 1,
    });
}
