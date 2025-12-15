import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface ExistingReview {
    id: string;
    rating: number | null;
    content: string | null;
    visited_at: string;
    created_at: string;
}

async function fetchRestaurantReview(
    userId: string,
    foursquareId: string
): Promise<ExistingReview | null> {
    // First, get the restaurant by foursquare_id
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('foursquare_id', foursquareId)
        .single();

    if (!restaurant) {
        console.log('fetchRestaurantReview: No restaurant found for', foursquareId);
        return null;
    }

    // Get the most recent review for this user + restaurant
    // Order by created_at desc to get the newest entry
    const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, content, visited_at, created_at')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurant.id)
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('fetchRestaurantReview: Error fetching review', error);
        throw error;
    }

    // Return first result or null if empty
    const result = data && data.length > 0 ? data[0] : null;
    console.log('fetchRestaurantReview: Found review', result);
    return result;
}

export function useExistingReview(
    userId: string | null | undefined,
    foursquareId: string | null | undefined
) {
    return useQuery<ExistingReview | null, Error>({
        queryKey: queryKeys.reviews.existing(userId!, foursquareId!),
        queryFn: () => fetchRestaurantReview(userId!, foursquareId!),
        enabled: !!userId && !!foursquareId,
        staleTime: 0, // Always refetch to get latest data
    });
}
