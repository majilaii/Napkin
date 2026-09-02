import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

/** Server-derived profile, Taste, and restaurant surfaces affected by an entry mutation. */
export function invalidateEntryTasteCaches(
    queryClient: QueryClient,
    userId: string,
    opts?: { restaurantId?: string | null },
) {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.spots(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.taste(userId) });
    if (opts?.restaurantId) {
        queryClient.invalidateQueries({
            queryKey: queryKeys.restaurants.page(opts.restaurantId),
        });
        queryClient.invalidateQueries({
            queryKey: queryKeys.restaurants.userHistory(opts.restaurantId, userId),
        });
        queryClient.invalidateQueries({
            queryKey: queryKeys.restaurants.reviews(opts.restaurantId),
        });
    }
}
