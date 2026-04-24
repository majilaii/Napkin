/**
 * Query hook: returns IDs of the caller's lists that contain a given restaurant.
 * Drives checkmark state in AddToListSheet.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

async function fetchListsContaining(restaurantId: string): Promise<string[]> {
    const data = await callEdgeFn<string[]>('lists', {
        action: 'lists_containing',
        body: { restaurant_id: restaurantId },
    });
    return data ?? [];
}

export function useListsContainingRestaurant(
    userId: string | null | undefined,
    restaurantId: string | null | undefined,
) {
    return useQuery<string[], Error>({
        queryKey: queryKeys.lists.containing(userId ?? '', restaurantId ?? ''),
        queryFn: () => fetchListsContaining(restaurantId!),
        enabled: !!userId && !!restaurantId,
        staleTime: 1000 * 60 * 5,
    });
}
