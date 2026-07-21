import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface RestaurantFeaturedList {
    id: string;
    title: string;
    emoji: string | null;
    entry_count: number;
    owner_display_name: string | null;
    owner_username: string | null;
}

export interface RestaurantFeaturedListsData {
    rows: RestaurantFeaturedList[];
    total: number;
}

/** Lazy restaurant-page module; persisted restaurants only. */
export function useRestaurantFeaturedLists(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
) {
    return useQuery<RestaurantFeaturedListsData>({
        queryKey: queryKeys.restaurants.featuredLists(userId ?? '', restaurantId ?? ''),
        queryFn: () =>
            callEdgeFn<RestaurantFeaturedListsData>('restaurant-history', {
                action: 'featured_lists',
                body: { restaurant_id: restaurantId },
            }),
        enabled: !!restaurantId && !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
