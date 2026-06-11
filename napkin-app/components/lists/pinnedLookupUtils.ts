/**
 * pinnedLookupUtils — pure logic for the list-detail "pinned" lookup
 * (TICKET-074 fix-pass).
 *
 * Replaces the per-row useIsWishlisted edge calls (O(visible rows) `wishlist?
 * action=check` requests) with ONE derivation from the personal wishlist query
 * (useMyWishlist), which is already cached for the wishlist tab — zero new
 * network calls when warm, one list fetch when cold.
 *
 * Caveat (accepted at friend-test scale): the personal wishlist is paginated,
 * so the set only covers loaded pages. A spot pinned long ago beyond the first
 * page may briefly show `pin to wishlist`; tapping it is idempotent
 * server-side and flips the row via the optimistic local set in the screen.
 *
 * No I/O, no React, no native imports (same pattern as listsSectionUtils).
 */
import type { PersonalWishlistPage } from '@/hooks/wishlist/useMyWishlist';

/**
 * Derive the set of wishlisted restaurant ids from personal-wishlist pages.
 * Pending captures (restaurant === null) are skipped — nothing to match.
 */
export function derivePinnedIds(
    pages: readonly PersonalWishlistPage[] | null | undefined,
): Set<string> {
    const ids = new Set<string>();
    for (const page of pages ?? []) {
        for (const item of page.data ?? []) {
            if (item.restaurant?.id) ids.add(item.restaurant.id);
        }
    }
    return ids;
}
