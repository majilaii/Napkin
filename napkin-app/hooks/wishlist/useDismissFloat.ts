/**
 * useDismissFloat — TICKET-060 R4.
 *
 * Dismiss a float (saver-set keyed). Optimistically removes the float item
 * from the table's activity feed cache. Snapshot + rollback per canonical pattern.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface DismissFloatInput {
    float_id: string;
    table_id: string;  // needed for cache invalidation
}

export interface DismissFloatResult {
    float_id: string;
    dismissed: boolean;
    suppressed_until: string;
}

export function useDismissFloat() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: DismissFloatInput): Promise<DismissFloatResult> => {
            return callEdgeFn<DismissFloatResult>('table-shares', {
                action: 'dismiss_float',
                body: { float_id: input.float_id },
            });
        },

        onMutate: async (input: DismissFloatInput) => {
            const activityKey = queryKeys.tables.activityForTable(input.table_id);
            await queryClient.cancelQueries({ queryKey: activityKey });
            const previousActivity = queryClient.getQueryData(activityKey);

            // Optimistically remove the float from the feed
            queryClient.setQueryData(activityKey, (old: any) => {
                if (!old) return old;
                const filterItems = (items: any[]) =>
                    items.filter((item: any) =>
                        !(item.type === 'restaurant_float' && item.id === input.float_id)
                    );
                if (Array.isArray(old)) return filterItems(old);
                if (old?.pages) {
                    return {
                        ...old,
                        pages: old.pages.map((p: any) => ({
                            ...p,
                            rows: filterItems(p.rows ?? []),
                        })),
                    };
                }
                return old;
            });

            return { previousActivity };
        },

        onError: (_err, input, ctx: any) => {
            const activityKey = queryKeys.tables.activityForTable(input.table_id);
            if (ctx?.previousActivity !== undefined) {
                queryClient.setQueryData(activityKey, ctx.previousActivity);
            }
        },

        onSuccess: (_result, input) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tables.activityForTable(input.table_id),
            });
            queryClient.invalidateQueries({
                queryKey: queryKeys.floats.forTable(input.table_id),
            });
        },
    });
}
