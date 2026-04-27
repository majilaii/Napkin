/**
 * useAvailableCities — fetches cities the owner can claim (not yet claimed,
 * have logged restaurants, not Elsewhere).
 * Owner-only.
 */

import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface AvailableCity {
    city: string;
    distinct_restaurant_count: number;
}

export function useAvailableCities(userId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.topFours.availableCities(userId ?? ''),
        queryFn: () =>
            callEdgeFn<AvailableCity[]>('top-fours', {
                method: 'GET',
                action: 'available_cities',
                params: { user_id: userId! },
            }),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
