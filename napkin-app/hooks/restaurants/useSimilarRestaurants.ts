/**
 * useSimilarRestaurants — "Similar places" on the restaurant page.
 *
 * GET restaurant-history?action=similar&restaurant_id=X. Server-side it is
 * other `restaurants` rows in the same city (zero Google cost), ranked
 * cuisine match > specific place-type overlap > proximity, capped at 6 and
 * within 5 km. Empty rows = the section hides.
 */
import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { RestaurantPageRestaurant } from './useRestaurantPage';

export type SimilarMatch = 'cuisine' | 'type' | 'nearby';

export type SimilarRestaurant = {
    id: string;
    name: string;
    cuisine: string | null;
    city: string | null;
    price_level: number | null;
    photo_url: string | null;
    photo_source: RestaurantPageRestaurant['photo_source'];
    places_photo_attribution_html: string | null;
    /** Integer metres from the page's restaurant. */
    distance_m: number;
    match: SimilarMatch;
};

export type SimilarRestaurantsPage = { rows: SimilarRestaurant[] };

export function useSimilarRestaurants(restaurantId: string | null | undefined) {
    const { user } = useAuth();
    const userId = user?.id;
    return useQuery({
        queryKey: queryKeys.restaurants.similar(restaurantId ?? ''),
        queryFn: () =>
            callEdgeFn<SimilarRestaurantsPage>('restaurant-history', {
                method: 'GET',
                action: 'similar',
                params: { restaurant_id: restaurantId! },
            }),
        enabled: !!restaurantId && !!userId,
        staleTime: 1000 * 60 * 30,
    });
}
