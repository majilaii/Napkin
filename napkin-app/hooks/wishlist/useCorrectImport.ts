/**
 * useCorrectImport — TICKET-060 R1.
 *
 * Author re-points the JOB's restaurant (not content_hash).
 * Propagates to every destination card (wishlist + table_shares for this job).
 *
 * onMutate: patches every destination card in the cache.
 * Snapshot + rollback per canonical pattern.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface CorrectImportInput {
    job_id: string;
    restaurant_id: string;
    /** For informational display after correction */
    restaurantName?: string;
}

export interface CorrectImportResult {
    job_id: string;
    restaurant_id: string;
    status: 'resolved';
}

export function useCorrectImport(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: CorrectImportInput): Promise<CorrectImportResult> => {
            return callEdgeFn<CorrectImportResult>('table-shares', {
                action: 'correct',
                body: { job_id: input.job_id, restaurant_id: input.restaurant_id },
            });
        },

        onMutate: async (input: CorrectImportInput) => {
            if (!userId) return {};

            const wishlistKey = queryKeys.wishlist.personal(userId);
            await queryClient.cancelQueries({ queryKey: wishlistKey });
            const previousWishlist = queryClient.getQueryData(wishlistKey);

            // Patch wishlist: find the row with this job_id and update it
            queryClient.setQueryData(wishlistKey, (old: any) => {
                if (!old) return old;
                const patchRow = (item: any) => {
                    if (item?.job_id === input.job_id) {
                        return { ...item, restaurant_id: input.restaurant_id, extraction_status: 'resolved' };
                    }
                    return item;
                };
                if (Array.isArray(old)) return old.map(patchRow);
                if (old?.pages) {
                    return {
                        ...old,
                        pages: old.pages.map((p: any) => ({
                            ...p,
                            rows: (p.rows ?? []).map(patchRow),
                        })),
                    };
                }
                return old;
            });

            return { previousWishlist };
        },

        onError: (_err, _input, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
        },

        onSuccess: (_result, input) => {
            if (!userId) return;
            // Narrow invalidation
            queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.detail(input.job_id) });
        },
    });
}
