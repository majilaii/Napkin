/**
 * Selector hook — returns the most-recent TikTok source the *viewing user*
 * has on their personal wishlist for a given restaurant, or null.
 *
 * Architecture decision (TICKET-054): reads exclusively from the already-loaded
 * useMyWishlist pages. No new endpoint, no useRestaurantPage change.
 * Trade-off: only sees rows in loaded pages (usually all of them, ≤40 rows/page).
 *
 * Returns: { source: WishlistSourceTikTok; createdAt: string } | null
 */
import { useMemo } from 'react';
import { useMyWishlist } from './useMyWishlist';
import type { WishlistSourceTikTok } from '@/lib/types/wishlistSource';

export interface TikTokSourceResult {
    source: WishlistSourceTikTok;
    createdAt: string;
}

export function useMyTikTokSourceForRestaurant(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
): TikTokSourceResult | null {
    const wishlist = useMyWishlist(userId);

    return useMemo(() => {
        if (!restaurantId) return null;

        // Flatten all loaded pages
        const allItems = wishlist.data?.pages.flatMap((p) => p.data) ?? [];

        // Filter to rows matching this restaurant with a TikTok source
        // TICKET-060: skip pending rows (restaurant may be null)
        const tiktokRows = allItems.filter(
            (item) =>
                item.restaurant?.id === restaurantId &&
                item.source?.type === 'tiktok',
        );

        if (tiktokRows.length === 0) return null;

        // Most-recent by created_at (already sorted desc from server, but re-sort
        // defensively in case of pagination edge cases)
        tiktokRows.sort(
            (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        const row = tiktokRows[0];
        // After the filter above, source.type === 'tiktok' is guaranteed
        // but TypeScript needs the explicit narrowing
        if (row.source?.type !== 'tiktok') return null;

        return {
            source: row.source as WishlistSourceTikTok,
            createdAt: row.created_at,
        };
    }, [restaurantId, wishlist.data]);
}
