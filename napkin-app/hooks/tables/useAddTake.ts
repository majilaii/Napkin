/**
 * Hook to add your take to a collaborative entry.
 * Updates the caller's entry_participants row with their rating and notes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface AddTakeInput {
    entry_id: string;
    table_id: string;
    rating: number | null;
    notes: string | null;
}

async function addTake(input: AddTakeInput) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('entry', {
        body: {
            action: 'add-take',
            entry_id: input.entry_id,
            rating: input.rating,
            notes: input.notes,
        },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

export function useAddTake() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: addTake,
        onSuccess: (_data, variables) => {
            qc.invalidateQueries({ queryKey: queryKeys.tables.activity(variables.table_id) });
        },
    });
}
