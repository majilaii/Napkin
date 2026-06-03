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
    /** Table IDs the job fanned into — used to patch Table-feed cards (H-7) */
    tableIds?: string[];
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

            // Snapshot table activity caches for all destination tables (H-7)
            const previousActivities: Record<string, unknown> = {};
            for (const tableId of input.tableIds ?? []) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                await queryClient.cancelQueries({ queryKey: actKey });
                previousActivities[tableId] = queryClient.getQueryData(actKey);
            }

            // Patch wishlist: find the row with this job_id and update it.
            // [TICKET-060 B3] PersonalWishlistPage uses `p.data`, not `p.rows`.
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
                            data: (p.data ?? []).map(patchRow),
                        })),
                    };
                }
                return old;
            });

            // [H-7 FIX] Patch every destination Table-feed card in place.
            // The edge fn correct action re-points job + all destination rows.
            // The client must also patch the activity cache for each ticked table so the
            // corrected restaurant shows without waiting for an unrelated refetch.
            for (const tableId of input.tableIds ?? []) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                queryClient.setQueryData(actKey, (old: any) => {
                    if (!old) return old;
                    const patchItem = (item: any) => {
                        if (item?.type === 'shared_save' && item?.job_id === input.job_id) {
                            return {
                                ...item,
                                restaurant_id: input.restaurant_id,
                                extraction_status: 'resolved',
                                extractionStatus: 'resolved',
                            };
                        }
                        if (item?.type === 'share_digest') {
                            const children = (item.childShares ?? []).map((child: any) => {
                                if (child?.shareId && child?.extractionStatus !== 'resolved') {
                                    // We don't have per-child job_id; patch all needs_confirm children
                                    // for this digest — they'll reconcile on settle-time refetch
                                    return child;
                                }
                                return child;
                            });
                            return { ...item, childShares: children };
                        }
                        return item;
                    };
                    if (old?.pages) {
                        return {
                            ...old,
                            pages: old.pages.map((p: any) => ({
                                ...p,
                                rows: (p.rows ?? []).map(patchItem),
                            })),
                        };
                    }
                    return old;
                });
            }

            return { previousWishlist, previousActivities };
        },

        onError: (_err, input: CorrectImportInput, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
            // Roll back all patched activity caches
            for (const tableId of input.tableIds ?? []) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                const prev = ctx?.previousActivities?.[tableId];
                if (prev !== undefined) {
                    queryClient.setQueryData(actKey, prev);
                }
            }
        },

        onSuccess: (_result, input) => {
            if (!userId) return;
            // Narrow invalidation — wishlist + all destination Tables.
            // [TICKET-060 B3] When tableIds is absent (e.g. called from CorrectModal
            // which doesn't know the job's table_ids), invalidate the full
            // tableActivity namespace so all feeds pick up the corrected restaurant.
            // When tableIds is provided, narrow to those exact keys.
            queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
            if (input.tableIds && input.tableIds.length > 0) {
                for (const tableId of input.tableIds) {
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tables.activityForTable(tableId),
                    });
                }
            } else {
                // No tableIds supplied → invalidate all table activity caches so
                // any shared cards for this job are refreshed across all Tables.
                queryClient.invalidateQueries({ queryKey: queryKeys.tables.activityAll() });
            }
        },
    });
}
