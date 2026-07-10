/**
 * useMyRestaurantPhotos — the caller's OWN entry photos across ALL their visits
 * to one restaurant, to feed the Top-4 "choose a memory" hero picker (TICKET-144
 * pt2). Self-only by construction: the edge scopes to the JWT's user.id and never
 * accepts a target user. Doctrine: never any other image source (no Places, no
 * restaurants.photo_url, no other users' photos).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface MyRestaurantPhoto {
    entry_photo_id: string;
    photo_url: string;
}

async function fetchMyRestaurantPhotos(restaurantId: string): Promise<MyRestaurantPhoto[]> {
    const data = await callEdgeFn<{ photos?: MyRestaurantPhoto[] }>('top-fours', {
        action: 'my_restaurant_photos',
        body: { restaurant_id: restaurantId },
    });
    return data?.photos ?? [];
}

export function useMyRestaurantPhotos(
    userId: string | null | undefined,
    restaurantId: string | null | undefined,
) {
    return useQuery<MyRestaurantPhoto[], Error>({
        queryKey: queryKeys.users.restaurantPhotos(userId ?? '', restaurantId ?? ''),
        queryFn: () => fetchMyRestaurantPhotos(restaurantId!),
        enabled: !!restaurantId,
        staleTime: 1000 * 60 * 5,
    });
}
