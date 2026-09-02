import type { PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { SearchLocality } from '@/hooks/search/searchLocalityStore';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';
import type { WishlistMapItem } from '@/components/wishlist/mapShared';
import type { SearchMode } from '@/components/search/searchModeTabsGate';
import { formatDistance, haversineMiles, type LatLng } from '@/lib/geo';

export type PlacesRating = NonNullable<SearchResultRow['rating']>;

export interface PlacesDisplayRow {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    lat: number | null;
    lng: number | null;
    priceLevel: number | null;
    rating: PlacesRating | null;
    isPinned: boolean;
    friendsBeenCount: number;
    searchRow?: SearchResultRow;
    been?: boolean;
}

export interface DecoratedPlacesRow {
    row: PlacesDisplayRow;
    distanceLabel: string | null;
}

export interface PlacesRatingPresentation {
    value: string | null;
    suffix: string | null;
    tone: 'amber' | 'muted' | 'faint';
}

export function resolvePlacesProjection<T>(
    activeSegment: SearchMode,
    current: T,
    frozen: T,
): { rendered: T; nextFrozen: T } {
    return activeSegment === 'places'
        ? { rendered: current, nextFrozen: current }
        : { rendered: frozen, nextFrozen: frozen };
}

export function presentPlacesRating(
    rating: PlacesRating | null,
): PlacesRatingPresentation {
    if (!rating) return { value: null, suffix: 'not yet rated', tone: 'faint' };
    if (rating.tier === 'google') {
        return { value: rating.value.toFixed(1), suffix: ' · google', tone: 'muted' };
    }
    return { value: rating.value.toFixed(1), suffix: null, tone: 'amber' };
}

export function deriveDistanceOrigin(
    locality: SearchLocality,
    deviceCoords: LatLng | null,
): LatLng | null {
    return locality === 'auto' && deviceCoords ? deviceCoords : null;
}

export function searchRowsToDisplayRows(rows: readonly SearchResultRow[]): PlacesDisplayRow[] {
    return rows.map((row) => ({
        id: row.id ?? (row.placeId ? `place:${row.placeId}` : `place-name:${row.name}`),
        name: row.name,
        city: row.city,
        cuisine: row.cuisine,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        priceLevel: row.priceLevel ?? null,
        rating: row.rating ?? null,
        isPinned: row.isPinned ?? false,
        friendsBeenCount: row.friendsBeenCount ?? 0,
        searchRow: row,
    }));
}

export function wishlistRowsToDisplayRows(
    rows: readonly PersonalWishlistItem[],
): PlacesDisplayRow[] {
    return rows.flatMap((item) => {
        const restaurant = item.restaurant;
        if (!restaurant) return [];
        return [{
            id: restaurant.id,
            name: restaurant.name,
            city: restaurant.city,
            cuisine: restaurant.cuisine,
            lat: restaurant.lat ?? null,
            lng: restaurant.lng ?? null,
            priceLevel: restaurant.price_level,
            rating: typeof restaurant.google_rating === 'number'
                ? { tier: 'google' as const, value: restaurant.google_rating, scale: 5 as const }
                : null,
            isPinned: true,
            friendsBeenCount: 0,
        }];
    });
}

export function spotRowsToDisplayRows(rows: readonly SpotSummary[]): PlacesDisplayRow[] {
    return rows.map((spot) => ({
        id: spot.restaurant_id,
        name: spot.name,
        city: spot.city,
        cuisine: spot.cuisine,
        lat: spot.lat,
        lng: spot.lng,
        priceLevel: spot.price_level,
        rating: typeof spot.avg_rating === 'number'
            ? { tier: 'you', value: spot.avg_rating, scale: 5 }
            : null,
        isPinned: false,
        friendsBeenCount: 0,
        been: true,
    }));
}

export function decorateAndSortRows(
    rows: readonly PlacesDisplayRow[],
    distanceOrigin: LatLng | null,
): DecoratedPlacesRow[] {
    const decorated = rows.map((row, index) => {
        const distance = distanceOrigin && row.lat != null && row.lng != null
            ? haversineMiles(distanceOrigin, { latitude: row.lat, longitude: row.lng })
            : null;
        return {
            row,
            distance,
            distanceLabel: distance == null ? null : formatDistance(distance),
            index,
        };
    });
    if (distanceOrigin) {
        decorated.sort((a, b) => (
            (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.index - b.index
        ));
    }
    return decorated.map(({ row, distanceLabel }) => ({ row, distanceLabel }));
}

export function composeRowMeta(
    row: PlacesDisplayRow,
    distanceLabel: string | null,
): string {
    const parts: string[] = [];
    if (row.cuisine) parts.push(row.cuisine.toLowerCase());
    if (distanceLabel) parts.push(distanceLabel);
    if (row.friendsBeenCount > 0) {
        parts.push(`${row.friendsBeenCount} ${row.friendsBeenCount === 1 ? 'friend' : 'friends'} been`);
    }
    if (row.isPinned) parts.push('pinned');
    return parts.join(' · ');
}

export function projectPlacesPins(rows: readonly PlacesDisplayRow[]): WishlistMapItem[] {
    return rows.flatMap((row) => {
        if (row.lat == null || row.lng == null) return [];
        return [{
            id: row.id,
            name: row.name,
            city: row.city,
            cuisine: row.cuisine,
            lat: row.lat,
            lng: row.lng,
            priceLevel: row.priceLevel,
            myRating: row.rating?.tier === 'you' ? row.rating.value : null,
            been: row.been,
            searchRow: row.searchRow,
        }];
    });
}

export function restaurantRouteForRow(row: PlacesDisplayRow): {
    pathname: '/restaurant/[id]';
    params: Record<string, string>;
} | null {
    const searchRow = row.searchRow;
    if (searchRow?.id) {
        return { pathname: '/restaurant/[id]', params: { id: searchRow.id } };
    }
    if (searchRow?.placeId) {
        return {
            pathname: '/restaurant/[id]',
            params: {
                id: searchRow.placeId,
                placeId: searchRow.placeId,
                placePayload: JSON.stringify(searchRow.place ?? searchRow),
            },
        };
    }
    if (row.id.startsWith('place:')) return null;
    return { pathname: '/restaurant/[id]', params: { id: row.id } };
}
