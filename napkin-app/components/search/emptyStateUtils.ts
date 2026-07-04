/**
 * emptyStateUtils — pure selectors for the search empty state (TICKET-097).
 *
 * - selectNearbyPinned: first-page personal wishlist → nearest 6 pinned spots,
 *   shaped as SearchResultRow items with a pre-formatted distance label.
 * - filterListsByQuery: client-side list matching for the typing-mode
 *   "Your lists" section (TICKET-094 option A — no server calls).
 *
 * No React, no IO — unit-testable.
 */
import { haversineMiles, formatDistance, type LatLng } from '@/lib/geo';
import type { PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';

export interface NearbyPinnedRow {
    row: SearchResultRow;
    /** Pre-formatted à la wishlist rows — "0.3 mi". */
    distanceLabel: string;
}

/**
 * Nearest pinned spots from the (first page of the) personal wishlist.
 * Keeps only resolved items whose restaurant carries coords; haversine-sorts;
 * takes `take`. Returns [] without coords — the section is simply absent.
 */
export function selectNearbyPinned(
    items: readonly PersonalWishlistItem[],
    coords: LatLng | null,
    take: number = 6,
): NearbyPinnedRow[] {
    if (!coords) return [];

    const seen = new Set<string>();
    const decorated: { item: PersonalWishlistItem; dist: number }[] = [];
    for (const item of items) {
        const r = item.restaurant;
        if (!r || r.lat == null || r.lng == null) continue;
        // Pending/needs_confirm captures aren't real pins yet.
        if (item.extraction_status === 'pending' || item.extraction_status === 'needs_confirm') {
            continue;
        }
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        decorated.push({
            item,
            dist: haversineMiles(coords, { latitude: r.lat, longitude: r.lng }),
        });
    }

    decorated.sort((a, b) => a.dist - b.dist);

    return decorated.slice(0, take).map(({ item, dist }) => {
        const r = item.restaurant!;
        return {
            row: {
                id: r.id,
                placeId: r.external_id ?? undefined,
                name: r.name,
                city: r.city,
                cuisine: r.cuisine,
                address: r.address,
                photoUrl: r.photo_url,
                photoReference: null,
                photoAttributionHtml: null,
                tier: 'onNapkin' as const,
            },
            distanceLabel: formatDistance(dist),
        };
    });
}

/**
 * Case-insensitive substring filter of the caller's lists. Title matches rank
 * first; description matches fill the remaining slots (tiebreaker). Input
 * order (reverse-chron from useMyLists) is preserved within each group.
 */
export function filterListsByQuery(
    lists: readonly MyList[],
    query: string,
    take: number = 3,
): MyList[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const titleMatches: MyList[] = [];
    const descriptionMatches: MyList[] = [];
    for (const list of lists) {
        if (list.title.toLowerCase().includes(q)) {
            titleMatches.push(list);
        } else if (list.description?.toLowerCase().includes(q)) {
            descriptionMatches.push(list);
        }
    }
    return [...titleMatches, ...descriptionMatches].slice(0, take);
}
