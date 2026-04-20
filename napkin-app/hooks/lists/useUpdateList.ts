/**
 * Mutation hook: update list metadata (title, description, ranked, privacy).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { CreatedList } from './useCreateList';

export interface UpdateListInput {
    list_id: string;
    title?: string;
    description?: string | null;
    ranked?: boolean;
    privacy?: 'public' | 'private';
}

async function updateList(input: UpdateListInput): Promise<CreatedList> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'update', ...input },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
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
            }
        },
    });
}
