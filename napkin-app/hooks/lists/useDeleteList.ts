/**
 * Mutation hook: delete a list (owner-only).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

async function deleteList(listId: string): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'delete', list_id: listId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
}

export function useDeleteList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: deleteList,
        onSuccess: (_void, listId) => {
            queryClient.removeQueries({ queryKey: queryKeys.lists.detail(listId) });
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
            }
        },
    });
}
