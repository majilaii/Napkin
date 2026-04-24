/**
 * Mutation hook: delete a list (owner-only).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

async function deleteList(listId: string): Promise<void> {
    await callEdgeFn<void>('lists', { action: 'delete', body: { list_id: listId } });
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
