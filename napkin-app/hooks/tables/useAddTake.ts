/**
 * Hook to add your take to a collaborative entry.
 * Updates the caller's entry_participants row with their rating and notes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface AddTakeInput {
    entry_id: string;
    table_id: string;
    rating: number | null;
    notes: string | null;
}

async function addTake(input: AddTakeInput) {
    return callEdgeFn('entry', {
        action: 'add-take',
        body: {
            entry_id: input.entry_id,
            rating: input.rating,
            notes: input.notes,
        },
    });
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
