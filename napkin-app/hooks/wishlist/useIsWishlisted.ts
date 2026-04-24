/**
 * Returns true if the given restaurant is in the user's personal wishlist.
 *
 * Queries the server directly (cache-independent), so it stays correct for
 * users with more than one page of saves where useMyWishlist hasn't loaded
 * the matching item yet.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

async function checkWishlisted(restaurantId: string): Promise<boolean> {
    const data = await callEdgeFn<{ wishlisted: boolean }>('wishlist', {
        action: 'check',
        body: { restaurant_id: restaurantId },
    });
    return !!data?.wishlisted;
}

export function useIsWishlisted(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
): boolean {
    const { data } = useQuery({
        queryKey: restaurantId && userId
            ? queryKeys.wishlist.check(userId, restaurantId)
            : ['wishlist', 'check', 'disabled'],
        queryFn: () => checkWishlisted(restaurantId!),
        enabled: !!restaurantId && !!userId,
        staleTime: 1000 * 60 * 5,
    });
    return !!data;
}
