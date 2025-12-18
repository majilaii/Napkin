import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Entry } from './useEntryHistory';

/**
 * Fetches all entries for a user, ordered by most recent first.
 * Includes joined restaurant and user_place data for location names.
 */
async function fetchUserEntries(userId: string): Promise<Entry[]> {
    const { data, error } = await supabase
        .from('entries')
        .select(`
            id,
            user_id,
            restaurant_id,
            place_id,
            user_place_id,
            rating,
            content,
            dish_description,
            cooked_by,
            value_profile,
            visited_at,
            created_at,
            restaurant:restaurants(id, name, address, city, country, external_id, lat, lng),
            user_place:user_places(id, name, address, icon, is_home)
        `)
        .eq('user_id', userId)
        .order('visited_at', { ascending: false });

    if (error) {
        console.error('Error fetching user entries:', error);
        throw error;
    }

    return data || [];
}

/**
 * Hook to fetch all entries for a user.
 * Use this for the user's meal diary/history view.
 */
export function useUserEntries(userId: string | null | undefined) {
    return useQuery<Entry[], Error>({
        queryKey: queryKeys.entries.byUser(userId!),
        queryFn: () => fetchUserEntries(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
