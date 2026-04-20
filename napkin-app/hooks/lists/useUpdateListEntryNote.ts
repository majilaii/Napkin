/**
 * Mutation hook: update the per-entry note on a list entry (optimistic).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ListDetailData } from './useList';

export interface UpdateEntryNoteInput {
    list_id: string;
    entry_id: string;
    note: string | null;
}

async function updateEntryNote(input: UpdateEntryNoteInput): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'update_entry', ...input },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
}

export function useUpdateListEntryNote() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: updateEntryNote,
        onMutate: async ({ list_id, entry_id, note }) => {
            const detailKey = queryKeys.lists.detail(list_id);
            await queryClient.cancelQueries({ queryKey: detailKey });
            const prev = queryClient.getQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(detailKey);

            queryClient.setQueryData<{ data: ListDetailData | null; isNotFound: boolean }>(
                detailKey,
                (old) => {
                    if (!old?.data) return old;
                    return {
                        ...old,
                        data: {
                            ...old.data,
                            entries: old.data.entries.map((e) =>
                                e.id === entry_id ? { ...e, note } : e,
                            ),
                        },
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
        onSettled: (_data, _err, { list_id }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list_id) });
        },
    });
}
