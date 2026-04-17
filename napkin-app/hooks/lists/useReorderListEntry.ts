/**
 * Mutation hook: reorder an entry in a ranked list (optimistic).
 *
 * Client passes the new index in the entries array; the hook:
 *   1. Optimistically splices the entry into its new slot in the cached data
 *   2. Fires `reorder_entry` with before/after IDs derived from the new neighbours
 *   3. On error, restores the snapshot
 *
 * The drag handle should disable while a reorder mutation is in flight
 * (see isPending on the returned mutation).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ListDetailData, ListEntry } from './useList';

export interface ReorderEntryInput {
    list_id: string;
    entry_id: string;
    /** New index (0-based) in the entries array after reorder */
    new_index: number;
    /** Current entries array (before reorder) — used to derive before/after IDs */
    currentEntries: ListEntry[];
}

async function reorderEntry(input: ReorderEntryInput): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { list_id, entry_id, new_index, currentEntries } = input;

    // Derive before/after entry IDs from the target position
    // Remove the moved entry from the array to find its new neighbours
    const withoutMoved = currentEntries.filter((e) => e.id !== entry_id);
    const before_entry_id = new_index > 0 ? withoutMoved[new_index - 1]?.id : undefined;
    const after_entry_id = new_index < withoutMoved.length ? withoutMoved[new_index]?.id : undefined;

    if (!before_entry_id && !after_entry_id) {
        // Only one entry in list — nothing to do
        return;
    }

    const { data, error } = await supabase.functions.invoke('lists', {
        body: {
            action: 'reorder_entry',
            list_id,
            entry_id,
            before_entry_id,
            after_entry_id,
        },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
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
