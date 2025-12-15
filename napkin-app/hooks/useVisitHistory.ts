import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface VisitEntry {
    id: string;
    rating: number | null;
    content: string | null;
    visited_at: string;
    created_at: string;
    value_profile: {
        flavor?: number;
        ambience?: number;
        value?: number;
        service?: number;
    } | null;
}

/**
 * Fetches all visits for a specific restaurant by the given user.
 * Returns entries ordered by visited_at descending (newest first).
 */
async function fetchVisitHistory(
    userId: string,
    foursquareId: string
): Promise<VisitEntry[]> {
    // First, get the restaurant by foursquare_id
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('foursquare_id', foursquareId)
        .single();

    if (!restaurant) return [];

    // Get all reviews for this user + restaurant, ordered by visited_at
    const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, content, visited_at, created_at, value_profile')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurant.id)
        .order('visited_at', { ascending: false });

    if (error) {
        console.error('Error fetching visit history:', error);
        throw error;
    }

    return data || [];
}

/**
 * Hook to fetch all visits for a specific restaurant.
 * Use this to show visit history in the LogModal or a diary view.
 */
export function useVisitHistory(
    userId: string | null | undefined,
    foursquareId: string | null | undefined
) {
    return useQuery<VisitEntry[], Error>({
        queryKey: queryKeys.reviews.history(userId!, foursquareId!),
        queryFn: () => fetchVisitHistory(userId!, foursquareId!),
        enabled: !!userId && !!foursquareId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
