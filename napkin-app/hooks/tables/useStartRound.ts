/**
 * Hook to start an async Round (group rating session).
 * Creates a table_nights row, host participant + entry, and empty attendee rows.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface StartRoundInput {
    table_id: string;
    restaurant: {
        external_id: string;
        name: string;
        location?: { address?: string; locality?: string; country?: string };
        types?: string[];
        latitude?: number;
        longitude?: number;
        photoReference?: string;
    };
    participant_ids: string[];
    rating: number;
    notes?: string;
    dish_description?: string;
    photo_url?: string;
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}

async function startRound(input: StartRoundInput) {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('table-night', {
        body: {
            action: 'start',
            table_id: input.table_id,
            restaurant: input.restaurant,
            participant_ids: input.participant_ids,
            is_async: true,
            rating: input.rating,
            notes: input.notes,
            dish_description: input.dish_description,
            photo_url: input.photo_url,
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

export function useStartRound(userId?: string | null, tableId?: string | null) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: startRound,
        onSuccess: () => {
            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.entries.list(userId) });
            }
            if (tableId) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activity(tableId) });
                qc.invalidateQueries({ queryKey: queryKeys.tableNight.active(tableId) });
            }
        },
    });
}
