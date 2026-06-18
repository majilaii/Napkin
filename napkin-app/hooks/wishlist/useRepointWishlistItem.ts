/**
 * useRepointWishlistItem — fix a mis-resolved import spot (b48 amend).
 *
 * Re-points ONE wishlist item to a different restaurant via wishlist `repoint`.
 * Narrow-invalidates the import batch + the personal wishlist (the row's shape
 * changes in ways an optimistic patch can't synthesize, so we refetch).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface RepointInput {
    item_id: string;
    restaurant_id: string;
}

export function useRepointWishlistItem(userId: string | null | undefined, jobId: string | null | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: RepointInput) =>
            callEdgeFn('wishlist', {
                action: 'repoint',
                body: { item_id: input.item_id, restaurant_id: input.restaurant_id },
            }),
        onSuccess: () => {
            if (jobId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.detail(jobId) });
            }
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
                queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(userId) });
            }
        },
    });
}
