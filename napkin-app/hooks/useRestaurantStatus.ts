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
    placeId: string
): Promise<RestaurantStatus | null> {
    // First get the restaurant ID
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('external_id', placeId)
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
    placeId: string,
    updates: Partial<RestaurantStatus>
): Promise<void> {
    // First get the restaurant ID
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('external_id', placeId)
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
    placeId: string | null | undefined
) {
    return useQuery<RestaurantStatus | null, Error>({
        queryKey: queryKeys.restaurantStatus(userId!, placeId!),
        queryFn: () => fetchRestaurantStatus(userId!, placeId!),
        enabled: !!userId && !!placeId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export function useUpdateRestaurantStatus() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            userId,
            placeId,
            updates,
        }: {
            userId: string;
            placeId: string;
            updates: Partial<RestaurantStatus>;
        }) => updateRestaurantStatus(userId, placeId, updates),
        onSuccess: (_data, variables) => {
            // Invalidate the status cache
            queryClient.invalidateQueries({
                queryKey: queryKeys.restaurantStatus(variables.userId, variables.placeId),
            });
        },
    });
}
