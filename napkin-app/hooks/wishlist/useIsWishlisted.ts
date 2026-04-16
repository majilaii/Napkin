/**
 * Returns true if the given restaurant is in the user's personal wishlist.
 *
 * Queries the server directly (cache-independent), so it stays correct for
 * users with more than one page of saves where useMyWishlist hasn't loaded
 * the matching item yet.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

async function checkWishlisted(restaurantId: string): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('wishlist', {
        body: { action: 'check', restaurant_id: restaurantId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return !!data?.data?.wishlisted;
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
