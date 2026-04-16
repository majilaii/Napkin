/**
 * Mutation hook: remove a restaurant from the caller's personal wishlist.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

async function removeFromWishlist(restaurant_id: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('wishlist', {
        body: { action: 'remove', restaurant_id },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
}

export function useWishlistRemove(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: removeFromWishlist,
        onSuccess: () => {
            if (userId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.wishlist.personal(userId),
                });
            }
            queryClient.invalidateQueries({
                queryKey: ['wishlist', 'table'],
            });
        },
    });
}
