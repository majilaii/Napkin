/**
 * Derived selector: returns true if a given restaurant_id appears in the user's
 * personal wishlist (as loaded by useMyWishlist).
 *
 * Relies on useMyWishlist being warm in the cache. The heart button's parent
 * (restaurant page) should ensure useMyWishlist is called to warm the cache.
 * Returns false when the query is uninitialized — a safe default.
 */
import { useMemo } from 'react';
import { useMyWishlist } from './useMyWishlist';
import type { PersonalWishlistItem } from './useMyWishlist';

export function useIsWishlisted(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
): boolean {
    const { data } = useMyWishlist(userId);

    return useMemo(() => {
        if (!restaurantId || !data) return false;
        const allItems: PersonalWishlistItem[] = data.pages.flatMap(
            (p) => p.data,
        );
        return allItems.some((item) => item.restaurant.id === restaurantId);
    }, [data, restaurantId]);
}
