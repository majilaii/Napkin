import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

/** Restaurant surfaces affected by any entry mutation, including photos and companions. */
export function invalidateRestaurantEntryCaches(
    queryClient: QueryClient,
    userId: string,
    restaurantId?: string | null,
) {
    if (!restaurantId) return;
    queryClient.invalidateQueries({
        queryKey: queryKeys.restaurants.page(restaurantId),
    });
    queryClient.invalidateQueries({
        queryKey: queryKeys.restaurants.userHistory(restaurantId, userId),
    });
    queryClient.invalidateQueries({
        queryKey: queryKeys.restaurants.reviews(restaurantId),
    });
}

/** Server-derived profile, Taste, and restaurant surfaces affected by an entry mutation. */
export function invalidateEntryTasteCaches(
    queryClient: QueryClient,
    userId: string,
    opts?: { restaurantId?: string | null },
) {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.spots(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.taste(userId) });
    invalidateRestaurantEntryCaches(queryClient, userId, opts?.restaurantId);
}
