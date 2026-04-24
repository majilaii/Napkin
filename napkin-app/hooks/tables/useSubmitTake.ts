/**
 * Hook for Round attendees to submit their impression ("Add Your Take").
 * Calls table-night edge function with action: 'rate', which delegates to
 * the rate_round RPC (atomic participant update + entry insert + reveal).
 *
 * TICKET-037: response shape is now { entry_id, round_status, revealed }.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { unwrapInvokeError } from '@/lib/edgeInvoke';

export interface SubmitTakeInput {
    table_night_id: string;
    table_id?: string;
    rating: number;
    notes?: string;
    dish_description?: string;
    photo_url?: string;
    photo_urls?: string[];
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}

export interface SubmitTakeResult {
    entry_id: string;
    round_status: string;
    revealed: boolean;
}

async function submitTake(input: SubmitTakeInput): Promise<SubmitTakeResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('table-night', {
        body: {
            action: 'rate',
            table_night_id: input.table_night_id,
            rating: input.rating,
            notes: input.notes,
            dish_description: input.dish_description,
            photo_url: input.photo_url,
            photo_urls: input.photo_urls,
            vibe_rating: input.vibe_rating,
            flavor_rating: input.flavor_rating,
            service_rating: input.service_rating,
            value_rating: input.value_rating,
        },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) {
        const unwrapped = await unwrapInvokeError(error);
        throw new Error(unwrapped.message);
    }
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : (data.error?.message ?? 'Unknown error'));
    return data?.data as SubmitTakeResult;
}

export function useSubmitTake(tableId?: string | null) {
    const qc = useQueryClient();

    return useMutation<SubmitTakeResult, Error, SubmitTakeInput>({
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
