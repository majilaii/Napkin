import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface UpdateEntryParams {
    entryId: string;
    userId: string;
    locationId?: string; // For cache invalidation
    updates: {
        rating?: number | null;
        content?: string | null;
        dish_description?: string | null;
        cooked_by?: string | null;
        visited_at?: string;
        value_profile?: {
            flavor?: number;
            ambience?: number;
            value?: number;
            service?: number;
        } | null;
    };
}

async function updateEntry(
    entryId: string,
    updates: UpdateEntryParams['updates']
): Promise<void> {
    const { error } = await supabase
        .from('entries')
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq('id', entryId);

    if (error) throw error;
}

/**
 * Hook to update an existing entry
 */
export function useUpdateEntry() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ entryId, updates }: UpdateEntryParams) =>
            updateEntry(entryId, updates),
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
