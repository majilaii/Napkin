/**
 * Mutation hook: update list metadata (title, description, ranked, privacy).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { CreatedList } from './useCreateList';

export interface UpdateListInput {
    list_id: string;
    title?: string;
    description?: string | null;
    ranked?: boolean;
    privacy?: 'public' | 'private';
    /** TICKET-108: emoji — explicit null clears back to the default teardrop. */
    emoji?: string | null;
}

async function updateList(input: UpdateListInput): Promise<CreatedList> {
    return callEdgeFn<CreatedList>('lists', { action: 'update', body: input });
}

export function useUpdateList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: updateList,
        onSuccess: (list) => {
            // Invalidate both the detail view and the mine list
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
                // The wishlist map derives emoji pins from map_pins — an emoji or
                // membership edit must refresh it (TICKET-108).
                queryClient.invalidateQueries({ queryKey: queryKeys.lists.mapPins(userId) });
            }
        },
    });
}
