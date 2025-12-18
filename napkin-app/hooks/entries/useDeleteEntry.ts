import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface DeleteEntryParams {
    entryId: string;
    userId: string;
    locationId?: string; // For cache invalidation
}

async function deleteEntry(entryId: string): Promise<void> {
    const { error } = await supabase
        .from('entries')
        .delete()
        .eq('id', entryId);

    if (error) throw error;
}

/**
 * Hook to delete an entry
 */
export function useDeleteEntry() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ entryId }: DeleteEntryParams) => deleteEntry(entryId),
        onSuccess: (_data, variables) => {
            // Invalidate relevant caches
            queryClient.invalidateQueries({ queryKey: queryKeys.entries.byUser(variables.userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.feed() });

            if (variables.locationId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.entries.latest(variables.userId, variables.locationId),
                });
                queryClient.invalidateQueries({
                    queryKey: queryKeys.entries.history(variables.userId, variables.locationId),
                });
            }
        },
    });
}
