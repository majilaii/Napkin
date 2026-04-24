/**
 * Mutation hook: remove a restaurant from the caller's personal wishlist.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

async function removeFromWishlist(restaurant_id: string): Promise<void> {
    await callEdgeFn<void>('wishlist', {
        action: 'remove',
        body: { restaurant_id },
    });
}

export function useWishlistRemove(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: removeFromWishlist,
        onMutate: async (restaurantId) => {
            if (!userId) return undefined;
            const checkKey = queryKeys.wishlist.check(userId, restaurantId);
            await queryClient.cancelQueries({ queryKey: checkKey });
            const previous = queryClient.getQueryData<boolean>(checkKey);
            queryClient.setQueryData(checkKey, false);
            return { checkKey, previous };
        },
        onError: (_err, _restaurantId, context) => {
            if (context?.checkKey) {
                queryClient.setQueryData(context.checkKey, context.previous);
            }
        },
        onSuccess: (_void, restaurantId) => {
            if (!userId) return;
            queryClient.setQueryData(
                queryKeys.wishlist.check(userId, restaurantId),
                false,
            );
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            // TICKET-036 P1-2: do NOT invalidate every cached Table wishlist or
            // Atlas city. They refetch on focus.
        },
    });
}
