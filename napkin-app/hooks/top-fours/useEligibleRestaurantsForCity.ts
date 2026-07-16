/**
 * useEligibleRestaurantsForCity — fetches all restaurants the owner has logged
 * in a given canonical city, for use in the EditTopFourSheet pick list.
 * Owner-only.
 */

import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface EligibleRestaurant {
    restaurant_id: string;
    name: string;
    photo_url: string | null;
    photo_source?: 'user' | 'table' | 'places' | 'none' | null;
    places_photo_attribution_html?: string | null;
    city: string | null;
    last_logged_at: string;
    best_rating: number | null;
}

export function useEligibleRestaurantsForCity(
    userId: string | null | undefined,
    city: string | null | undefined,
) {
    return useQuery({
        queryKey: queryKeys.topFours.eligibleRestaurants(userId ?? '', city ?? ''),
        queryFn: () =>
            callEdgeFn<EligibleRestaurant[]>('top-fours', {
                method: 'GET',
                action: 'eligible_restaurants_for_city',
                params: { user_id: userId!, city: city! },
            }),
        enabled: !!userId && !!city,
        staleTime: 1000 * 60 * 5,
    });
}
