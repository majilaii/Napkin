/**
 * useMyEligibleRestaurants — every restaurant the owner has logged, for the
 * profile Top 4 picker. Global (not city-scoped). Owner-only.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { EligibleRestaurant } from '@/hooks/top-fours/useEligibleRestaurantsForCity';

export type { EligibleRestaurant };

export function useMyEligibleRestaurants(
    userId: string | null | undefined,
    enabled = true,
) {
    return useQuery({
        queryKey: queryKeys.topFours.profileEligible(userId ?? ''),
        queryFn: () =>
            callEdgeFn<EligibleRestaurant[]>('top-fours', {
                method: 'GET',
                action: 'eligible_restaurants',
                params: { user_id: userId! },
            }),
        enabled: !!userId && enabled,
        staleTime: 1000 * 60 * 2,
    });
}
