/**
 * useRepointWishlistItem — fix a mis-resolved import spot (b48 amend).
 *
 * Re-points ONE wishlist item to a different restaurant via wishlist `repoint`.
 * Narrow-invalidates the import batch, personal wishlist, and optional Table
 * aggregate (the repaired rows are server-derived and cannot be synthesized).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface RepointInput {
    item_id: string;
    restaurant_id: string;
}

export function useRepointWishlistItem(
    userId: string | null | undefined,
    jobId: string | null | undefined,
    tableId?: string | null,
) {
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
                if (tableId) {
                    // invalidate: overlap rows + viewer_item_id are server-derived.
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.wishlist.table(userId, tableId),
                    });
                }
            }
        },
    });
}
