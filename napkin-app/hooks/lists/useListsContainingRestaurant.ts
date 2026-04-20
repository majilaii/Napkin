/**
 * Query hook: returns IDs of the caller's lists that contain a given restaurant.
 * Drives checkmark state in AddToListSheet.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

async function fetchListsContaining(restaurantId: string): Promise<string[]> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'lists_containing', restaurant_id: restaurantId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data ?? [];
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
