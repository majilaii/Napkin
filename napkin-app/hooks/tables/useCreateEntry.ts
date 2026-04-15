/**
 * Hook to create a meal log entry.
 * Calls the entry edge function which handles restaurant upsert,
 * table sharing, and user_restaurant_status updates.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface CreateEntryInput {
    restaurant?: {
        external_id: string;
        name: string;
        location?: {
            address?: string;
            locality?: string;
            country?: string;
        };
        types?: string[];
        latitude?: number;
        longitude?: number;
    };
    rating?: number | null;
    content?: string;
    dish_description?: string;
    cooked_by?: string;
    visited_at?: string;
    table_id?: string;
    visibility?: 'private' | 'friends' | 'table' | 'both';
    participant_ids?: string[];
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}

async function createEntry(input: CreateEntryInput) {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('entry', {
        body: input,
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

export function useCreateEntry(userId?: string | null, tableId?: string | null) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: createEntry,
        onSuccess: () => {
            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.entries.list(userId) });
            }
            if (tableId) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activity(tableId) });
            }
        },
    });
}
