import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface ExistingReview {
    id: string;
    rating: number;
    content: string | null;
    visited_at: string;
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

    if (!restaurant) return null;

    // Then get the most recent review for this user + restaurant
    const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, content, visited_at')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurant.id)
        .order('visited_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        // No review found is not an error for our use case
        if (error.code === 'PGRST116') return null;
        throw error;
    }

    return data;
}

export function useExistingReview(
    userId: string | null | undefined,
    foursquareId: string | null | undefined
) {
    return useQuery<ExistingReview | null, Error>({
        queryKey: queryKeys.reviews.existing(userId!, foursquareId!),
        queryFn: () => fetchRestaurantReview(userId!, foursquareId!),
        enabled: !!userId && !!foursquareId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

