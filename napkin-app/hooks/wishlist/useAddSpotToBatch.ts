/**
 * useAddSpotToBatch — add a missed spot into an import batch (b48 amend).
 *
 * Saves a Places-picked restaurant to the wishlist, tagged with the batch's
 * job_id so it appears in that import's detail. Narrow-invalidates the batch +
 * personal wishlist.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface AddSpotInput {
    restaurant_id: string;
}

export function useAddSpotToBatch(userId: string | null | undefined, jobId: string | null | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: AddSpotInput) =>
            callEdgeFn('wishlist', {
                action: 'add',
                body: { restaurant_id: input.restaurant_id, job_id: jobId },
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
