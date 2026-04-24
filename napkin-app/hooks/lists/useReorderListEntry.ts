/**
 * Mutation hook: reorder an entry in a ranked list (optimistic).
 *
 * TICKET-037: client now sends only { list_id, entry_id, new_index }.
 * Server reads the authoritative list order and resolves neighbour positions,
 * eliminating stale-cache snap-back (P2-17).
 *
 * The hook:
 *   1. Optimistically splices the entry into its new slot in the cached data
 *   2. Fires `reorder_entry` with { list_id, entry_id, new_index }
 *   3. On error, restores the snapshot
 *
 * The drag handle should disable while a reorder mutation is in flight
 * (see isPending on the returned mutation).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { ListDetailData, ListEntry } from './useList';

export interface ReorderEntryInput {
    list_id: string;
    entry_id: string;
    /** New index (0-based) in the entries array after reorder */
    new_index: number;
    /** Current entries array (before reorder) — used for optimistic update only */
    currentEntries: ListEntry[];
}

async function reorderEntry(input: ReorderEntryInput): Promise<void> {
    const { list_id, entry_id, new_index } = input;
    await callEdgeFn<void>('lists', {
        action: 'reorder_entry',
        body: { list_id, entry_id, new_index },
    });
}

export function useReorderListEntry(listId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: reorderEntry,
        onMutate: async ({ entry_id, new_index, currentEntries }) => {
            const detailKey = queryKeys.lists.detail(listId);
            await queryClient.cancelQueries({ queryKey: detailKey });

            const prev = queryClient.getQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(detailKey);

            // Splice entry into new position optimistically
            const reordered = [...currentEntries];
            const oldIndex = reordered.findIndex((e) => e.id === entry_id);
            if (oldIndex !== -1) {
                const [moved] = reordered.splice(oldIndex, 1);
                reordered.splice(new_index, 0, moved);
            }

            queryClient.setQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(
                detailKey,
                (old) => {
                    if (!old?.data) return old;
                    return {
                        ...old,
                        data: { ...old.data, entries: reordered },
                    };
                },
            );

            return { prev, detailKey };
        },
        onError: (_err, _vars, context: any) => {
            if (context?.prev !== undefined) {
                queryClient.setQueryData(context.detailKey, context.prev);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) });
        },
    });
}
