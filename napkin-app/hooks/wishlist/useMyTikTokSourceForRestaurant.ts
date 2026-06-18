/**
 * Selector hook — returns the most-recent IMPORT PROVENANCE source the viewing
 * user has on their personal wishlist for a given restaurant, or null.
 *
 * Generalized (TICKET-083 polish): was tiktok-only; now also surfaces 'video'
 * (saved-video import) and 'web' (shared link) provenance. The restaurant page's
 * SavedFromTikTokPanel renders the right line per type. Name kept for churn.
 *
 * Architecture (TICKET-054): reads exclusively from the already-loaded
 * useMyWishlist pages — no new endpoint. Trade-off: only sees loaded pages.
 *
 * Returns: { source: WishlistSource; createdAt: string } | null
 */
import { useMemo } from 'react';
import { useMyWishlist } from './useMyWishlist';
import type { WishlistSource } from '@/lib/types/wishlistSource';

export interface TikTokSourceResult {
    source: WishlistSource;
    createdAt: string;
}

const PROVENANCE_TYPES = ['tiktok', 'video', 'web'];

export function useMyTikTokSourceForRestaurant(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
): TikTokSourceResult | null {
    const wishlist = useMyWishlist(userId);

    return useMemo(() => {
        if (!restaurantId) return null;

        const allItems = wishlist.data?.pages.flatMap((p) => p.data) ?? [];

        const rows = allItems.filter(
            (item) =>
                item.restaurant?.id === restaurantId &&
                !!item.source?.type &&
                PROVENANCE_TYPES.includes(item.source.type),
        );
        if (rows.length === 0) return null;

        rows.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        const row = rows[0];
        if (!row.source) return null;
        return {
            source: row.source as WishlistSource,
            createdAt: row.created_at,
        };
    }, [restaurantId, wishlist.data]);
}
