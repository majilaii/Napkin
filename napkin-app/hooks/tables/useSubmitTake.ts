/**
 * Hook for Round attendees to submit their impression ("Add Your Take").
 * Calls table-night edge function with action: 'rate', which also creates
 * the attendee's journal entry and auto-completes the Round if all are in.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface SubmitTakeInput {
    table_night_id: string;
    table_id?: string;
    rating: number;
    notes?: string;
    dish_description?: string;
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}

async function submitTake(input: SubmitTakeInput) {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('table-night', {
        body: {
            action: 'rate',
            table_night_id: input.table_night_id,
            rating: input.rating,
            notes: input.notes,
            dish_description: input.dish_description,
            vibe_rating: input.vibe_rating,
            flavor_rating: input.flavor_rating,
            service_rating: input.service_rating,
            value_rating: input.value_rating,
        },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

export function useSubmitTake(tableId?: string | null) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: submitTake,
        onSuccess: (_data, variables) => {
            qc.invalidateQueries({
                queryKey: queryKeys.tableNight.status(variables.table_night_id),
            });
            if (tableId) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activity(tableId) });
                qc.invalidateQueries({ queryKey: queryKeys.tableNight.active(tableId) });
            }
        },
    });
}
