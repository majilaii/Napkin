import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface Entry {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    place_id: string | null;
    user_place_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    cooked_by: string | null;
    value_profile: {
        flavor?: number;
        ambience?: number;
        value?: number;
        service?: number;
    } | null;
    visited_at: string;
    created_at: string;
    // Joined data (optional, depends on which query is used)
    restaurant?: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        country: string | null;
        external_id: string | null;
        lat: number | null;
        lng: number | null;
    };
    user_place?: {
        id: string;
        name: string;
        address: string | null;
        icon: string;
        is_home: boolean;
    };
}

/**
 * Fetch entries for a specific location (restaurant, place, or user_place)
 */
async function fetchEntryHistory(
    userId: string,
    locationId: string,
    locationType: 'restaurant' | 'place' | 'user_place'
): Promise<Entry[]> {
    let query = supabase
        .from('entries')
        .select('*')
        .eq('user_id', userId)
        .order('visited_at', { ascending: false });

    // Filter by location type
    if (locationType === 'restaurant') {
        // First get restaurant by external_id
        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('id')
            .eq('external_id', locationId)
            .single();

        if (!restaurant) return [];
        query = query.eq('restaurant_id', restaurant.id);
    } else if (locationType === 'place') {
        const { data: place } = await supabase
            .from('places')
            .select('id')
            .eq('external_id', locationId)
            .single();

        if (!place) return [];
        query = query.eq('place_id', place.id);
    } else if (locationType === 'user_place') {
        query = query.eq('user_place_id', locationId);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching entry history:', error);
        throw error;
    }

    return data || [];
}

/**
 * Hook to fetch entry history for a location
 */
export function useEntryHistory(
    userId: string | null | undefined,
    locationId: string | null | undefined,
    locationType: 'restaurant' | 'place' | 'user_place' = 'restaurant'
) {
    return useQuery<Entry[], Error>({
        queryKey: queryKeys.entries.history(userId!, locationId!),
        queryFn: () => fetchEntryHistory(userId!, locationId!, locationType),
        enabled: !!userId && !!locationId,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Fetch the latest entry for a location
 */
async function fetchLatestEntry(
    userId: string,
    locationId: string,
    locationType: 'restaurant' | 'place' | 'user_place'
): Promise<Entry | null> {
    const entries = await fetchEntryHistory(userId, locationId, locationType);
    return entries.length > 0 ? entries[0] : null;
}

/**
 * Hook to fetch the latest entry for a location
 */
export function useLatestEntry(
    userId: string | null | undefined,
    locationId: string | null | undefined,
    locationType: 'restaurant' | 'place' | 'user_place' = 'restaurant'
) {
    return useQuery<Entry | null, Error>({
        queryKey: queryKeys.entries.latest(userId!, locationId!),
        queryFn: () => fetchLatestEntry(userId!, locationId!, locationType),
        enabled: !!userId && !!locationId,
        staleTime: 0, // Always refetch
    });
}
