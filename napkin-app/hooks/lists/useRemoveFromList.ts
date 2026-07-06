/**
 * Mutation hook: remove a restaurant from a list (optimistic).
 *
 * Optimistic updates mirror useAddToList:
 *   - removes list_id from lists_containing cache
 *   - decrements entry_count in mine cache
 *   Rolls back on server error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { MyList } from './useMyLists';
import type { ListDetailData } from './useList';

export interface RemoveFromListInput {
    list_id: string;
    restaurant_id: string;
}

async function removeFromList(input: RemoveFromListInput): Promise<void> {
    await callEdgeFn<void>('lists', { action: 'remove_entry', body: input });
}

export function useRemoveFromList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: removeFromList,
        onMutate: async ({ list_id, restaurant_id }) => {
            if (!userId) return {};

            const containingKey = queryKeys.lists.containing(userId, restaurant_id);
            const mineKey = queryKeys.lists.mine(userId);
            const detailKey = queryKeys.lists.detail(list_id);

            await queryClient.cancelQueries({ queryKey: containingKey });
            await queryClient.cancelQueries({ queryKey: mineKey });
            await queryClient.cancelQueries({ queryKey: detailKey });

            const prevContaining = queryClient.getQueryData<string[]>(containingKey);
            const prevMine = queryClient.getQueryData<MyList[]>(mineKey);
            const prevDetail = queryClient.getQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(detailKey);

            // Optimistically remove list_id from containing set
            queryClient.setQueryData<string[]>(containingKey, (old) =>
                old ? old.filter((id) => id !== list_id) : [],
            );

            // Optimistically decrement entry_count
            queryClient.setQueryData<MyList[]>(mineKey, (old) => {
                if (!old) return old;
                return old.map((l) =>
                    l.id === list_id
                        ? { ...l, entry_count: Math.max(0, l.entry_count - 1) }
                        : l,
                );
            });

            // Optimistically remove from list detail entries
            queryClient.setQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(
                detailKey,
                (old) => {
                    if (!old?.data) return old;
                    return {
                        ...old,
                        data: {
                            ...old.data,
                            entries: old.data.entries.filter(
                                (e) => e.restaurant_id !== restaurant_id,
                            ),
                        },
                    };
                },
            );

            return { prevContaining, prevMine, prevDetail, containingKey, mineKey, detailKey };
        },
        onError: (_err, _vars, context: any) => {
            if (!context) return;
            if (context.prevContaining !== undefined) {
                queryClient.setQueryData(context.containingKey, context.prevContaining);
            }
            if (context.prevMine !== undefined) {
                queryClient.setQueryData(context.mineKey, context.prevMine);
            }
            if (context.prevDetail !== undefined) {
                queryClient.setQueryData(context.detailKey, context.prevDetail);
            }
        },
        onSettled: (_data, _err, { list_id }) => {
            // TICKET-036 P1-3: only refetch list detail; onMutate already patched
            // containing + mine and re-invalidating them races with the patch.
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list_id) });
            // Removing a spot drops its map pin — refresh (TICKET-108).
            if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.lists.mapPins(userId) });
        },
    });
}
