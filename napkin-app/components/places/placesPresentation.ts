import type { PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';
import type { SearchLocality } from '@/hooks/search/searchLocalityStore';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';
import type { WishlistMapItem } from '@/components/wishlist/mapShared';
import type { SearchMode } from '@/components/search/searchModeTabsGate';
import type { PlacesLayerFilter } from '@/hooks/search/placesScreenState';
import { formatDistance, haversineMiles, type LatLng } from '@/lib/geo';
import { FULL, PEEK, type Snap } from '@/components/sheets/snapSheetMath';

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
    network?: {
        author: NetworkMapItem['author'];
        entryId: string;
        hasReview: boolean;
        rating: number | null;
        note: string | null;
    };
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

export type PlacesSource = 'places' | 'persisted' | 'wishlist' | 'spots' | 'network';
export type PlacesFailurePresentation = {
    kind: 'none' | 'broken' | 'inline';
    sources: PlacesSource[];
};

/**
 * Intended-empty is allowed only after every active source succeeds. A failed
 * cold source gets the full retry treatment; warm rows stay visible with the
 * one-line refresh affordance.
 */
export function resolvePlacesFailurePresentation(args: {
    queryActive: boolean;
    layerFilter: PlacesLayerFilter;
    hasCachedRows: boolean;
    placesFailed: boolean;
    persistedFailed: boolean;
    wishlistFailed: boolean;
    spotsFailed: boolean;
    networkFailed: boolean;
}): PlacesFailurePresentation {
    const sources: PlacesSource[] = args.queryActive
        ? [
            ...(args.placesFailed ? ['places' as const] : []),
            ...(args.persistedFailed ? ['persisted' as const] : []),
        ]
        : args.layerFilter === 'friends'
          ? (args.networkFailed ? ['network' as const] : [])
          : [
              ...(args.layerFilter !== 'been' && args.wishlistFailed
                  ? ['wishlist' as const]
                  : []),
              ...(args.layerFilter !== 'pinned' && args.spotsFailed
                  ? ['spots' as const]
                  : []),
          ];
    if (sources.length === 0) return { kind: 'none', sources };
    return { kind: args.hasCachedRows ? 'inline' : 'broken', sources };
}

export function resolvePlacesProjection<T>(
    activeSegment: SearchMode,
    current: T,
    frozen: T,
    searchMode = false,
): { rendered: T; nextFrozen: T } {
    return activeSegment === 'places' && !searchMode
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

export function networkRowsToDisplayRows(
    rows: readonly NetworkMapItem[],
): PlacesDisplayRow[] {
    return rows.map((pin) => ({
        id: pin.restaurant_id,
        name: pin.name,
        city: pin.city,
        cuisine: pin.cuisine,
        lat: pin.lat,
        lng: pin.lng,
        priceLevel: null,
        rating: null,
        isPinned: false,
        friendsBeenCount: 1 + pin.others_count,
        network: {
            author: pin.author,
            entryId: pin.entry_id,
            hasReview: pin.has_review,
            rating: pin.rating,
            note: pin.note,
        },
    }));
}

/** Pinned order leads the union; a duplicate inherits the richer been signal. */
export function mergePlacesLayerRows(
    pinnedRows: readonly PlacesDisplayRow[],
    beenRows: readonly PlacesDisplayRow[],
): PlacesDisplayRow[] {
    const merged = new Map<string, PlacesDisplayRow>();
    for (const row of pinnedRows) merged.set(row.id, row);
    for (const row of beenRows) {
        const pinned = merged.get(row.id);
        merged.set(row.id, pinned ? {
            ...pinned,
            ...row,
            city: row.city ?? pinned.city,
            cuisine: row.cuisine ?? pinned.cuisine,
            lat: row.lat ?? pinned.lat,
            lng: row.lng ?? pinned.lng,
            priceLevel: row.priceLevel ?? pinned.priceLevel,
            rating: row.rating ?? pinned.rating,
            isPinned: pinned.isPinned || row.isPinned,
            been: true,
        } : row);
    }
    return [...merged.values()];
}

export function filterPlacesLayerRows(
    layerFilter: PlacesLayerFilter,
    pinnedRows: readonly PlacesDisplayRow[],
    beenRows: readonly PlacesDisplayRow[],
    friendsRows: readonly PlacesDisplayRow[] = [],
): PlacesDisplayRow[] {
    if (layerFilter === 'pinned') return [...pinnedRows];
    if (layerFilter === 'been') return [...beenRows];
    if (layerFilter === 'friends') return [...friendsRows];
    return mergePlacesLayerRows(pinnedRows, beenRows);
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

/** Focused-search guidance exists only for a real, auto-locality origin. */
export function selectNearbyPlaces(
    rows: readonly PlacesDisplayRow[],
    distanceOrigin: LatLng | null,
    limit = 6,
): DecoratedPlacesRow[] {
    if (!distanceOrigin) return [];
    return decorateAndSortRows(
        rows.filter((row) => row.lat != null && row.lng != null),
        distanceOrigin,
    ).slice(0, limit);
}

export type PlacesSearchBranch = 'sections' | 'minimum' | 'results';

export function placesSearchBranch(query: string): PlacesSearchBranch {
    const length = query.trim().length;
    if (length === 0) return 'sections';
    return length < 2 ? 'minimum' : 'results';
}

export type PlacesListsBranch = 'loading' | 'error' | 'empty' | 'rows';

export function resolvePlacesListsBranch(args: {
    myCount: number;
    savedCount: number;
    myLoading: boolean;
    savedLoading: boolean;
    myError: boolean;
    savedError: boolean;
}): PlacesListsBranch {
    const hasRows = args.myCount + args.savedCount > 0;
    if (!hasRows && (args.myLoading || args.savedLoading)) return 'loading';
    if (args.myError && args.myCount === 0) return 'error';
    if (args.savedError || hasRows) return 'rows';
    return 'empty';
}

export function placesListsContentBranch(
    query: string,
    shelfBranch: PlacesListsBranch,
): PlacesListsBranch | 'minimum' | 'results' {
    const length = query.trim().length;
    if (length === 0) return shelfBranch;
    return length === 1 ? 'minimum' : 'results';
}

export function composePlacesContentKey(args: {
    searchMode: boolean;
    segment: SearchMode;
    branch: string;
    query: string;
}): string {
    const prefix = args.searchMode ? 'search' : 'browse';
    return `${prefix}:${args.segment}:${args.branch}:${args.query.trim().toLowerCase()}`;
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

export function composeFriendCaptionMeta(row: PlacesDisplayRow): string {
    if (!row.network) return '';
    const headcount = `${row.friendsBeenCount} ${row.friendsBeenCount === 1 ? 'friend' : 'friends'} been`;
    return `${row.network.author.name} · ${headcount}`;
}

export function placesViewToggle(snap: Snap): {
    label: 'list' | 'map';
    icon: 'list-outline' | 'map-outline';
    target: Snap;
} {
    return snap === FULL
        ? { label: 'map', icon: 'map-outline', target: PEEK }
        : { label: 'list', icon: 'list-outline', target: FULL };
}

export function placesCountLabel(count: number, hasMore: boolean): string {
    return `${count}${hasMore ? '+' : ''} ${count === 1 && !hasMore ? 'place' : 'places'}`;
}

export function shouldFetchNextPlacesPage(args: {
    searchMode: boolean;
    activeSegment: SearchMode;
    layerFilter: PlacesLayerFilter;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
}): boolean {
    return !args.searchMode
        && args.activeSegment === 'places'
        && (args.layerFilter === 'all' || args.layerFilter === 'pinned')
        && args.hasNextPage
        && !args.isFetchingNextPage;
}

export function projectPlacesPins(rows: readonly PlacesDisplayRow[]): WishlistMapItem[] {
    return rows.flatMap((row) => {
        if (row.lat == null || row.lng == null) return [];
        const network = row.network;
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
            ...(network ? {
                author: network.author,
                entryId: network.entryId,
                hasReview: network.hasReview,
                rating: network.rating,
                note: network.note,
                othersCount: Math.max(0, row.friendsBeenCount - 1),
            } : {}),
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
