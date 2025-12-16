import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface EntryLocation {
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
}

interface CreateEntryParams {
    // Location (one of these or none)
    restaurant?: EntryLocation;    // Restaurant from Google Places
    place?: EntryLocation;         // Non-restaurant from Google Places
    user_place_id?: string;        // Saved place UUID

    // Entry data
    rating?: number | null;
    content?: string;
    dish_description?: string;
    cooked_by?: string;
    value_profile?: {
        flavor: number;
        ambience: number;
        value: number;
        service: number;
    };
    visited_at?: string;

    // For cache invalidation
    userId: string;
    locationId?: string;  // external_id or user_place_id for cache key
}

async function createEntry(params: CreateEntryParams) {
    const { userId, locationId, ...payload } = params;

    const { data, error } = await supabase.functions.invoke('entry', {
        body: payload,
    });

    if (error) throw error;
    return data;
}

/**
 * Hook to create a new entry (meal log)
 */
export function useCreateEntry() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createEntry,
        onSuccess: (_data, variables) => {
            // Invalidate relevant caches
            queryClient.invalidateQueries({ queryKey: queryKeys.feed() });

            if (variables.locationId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.entries.history(variables.userId, variables.locationId),
                });
                queryClient.invalidateQueries({
                    queryKey: queryKeys.entries.latest(variables.userId, variables.locationId),
                });
            }
        },
    });
}
