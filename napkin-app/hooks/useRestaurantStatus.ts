import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface RestaurantStatus {
    been: boolean;
    liked: boolean;
    want_to_try: boolean;
}

async function fetchRestaurantStatus(
    userId: string,
    foursquareId: string
): Promise<RestaurantStatus | null> {
    // First get the restaurant ID
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('foursquare_id', foursquareId)
        .single();

    if (!restaurant) return null;

    // Then get the status
    const { data, error } = await supabase
        .from('user_restaurant_status')
        .select('been, liked, want_to_try')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurant.id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }

    return data;
}

async function updateRestaurantStatus(
    userId: string,
    foursquareId: string,
    updates: Partial<RestaurantStatus>
): Promise<void> {
    // First get the restaurant ID
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('foursquare_id', foursquareId)
        .single();

    if (!restaurant) {
        throw new Error('Restaurant not found');
    }

    // Upsert the status
    const { error } = await supabase
        .from('user_restaurant_status')
        .upsert({
            user_id: userId,
            restaurant_id: restaurant.id,
            ...updates,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,restaurant_id' });

    if (error) throw error;
}

export function useRestaurantStatus(
    userId: string | null | undefined,
    foursquareId: string | null | undefined
) {
    return useQuery<RestaurantStatus | null, Error>({
        queryKey: queryKeys.restaurantStatus(userId!, foursquareId!),
        queryFn: () => fetchRestaurantStatus(userId!, foursquareId!),
        enabled: !!userId && !!foursquareId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export function useUpdateRestaurantStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            userId,
            foursquareId,
            updates,
        }: {
            userId: string;
            foursquareId: string;
            updates: Partial<RestaurantStatus>;
        }) => updateRestaurantStatus(userId, foursquareId, updates),
        onSuccess: (_data, variables) => {
            // Invalidate the status cache
            queryClient.invalidateQueries({
                queryKey: queryKeys.restaurantStatus(variables.userId, variables.foursquareId),
            });
        },
    });
}
