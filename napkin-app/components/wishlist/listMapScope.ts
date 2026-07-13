import type { ListEntry } from '@/hooks/lists/useList';
import type { WishlistMapItem } from './WishlistMapView';

export interface ListMapFilters {
    city: string | null;
    cuisine: string | null;
    price: string | null;
}

export interface ListMapScopeOptions extends ListMapFilters {
    emoji: string | null;
    ranked: boolean;
}

const COLLECTION_FIT_MAX_LAT_SPAN = 0.45;
const COLLECTION_FIT_MAX_LNG_SPAN = 0.65;

/** Whether all points still form a useful city/regional overview. */
export function isCityScaleCollection(
    items: readonly Pick<WishlistMapItem, 'lat' | 'lng'>[],
): boolean {
    if (items.length < 2) return true;
    const latitudes = items.map((item) => item.lat);
    const longitudes = items.map((item) => item.lng);
    return (
        Math.max(...latitudes) - Math.min(...latitudes) <= COLLECTION_FIT_MAX_LAT_SPAN
        && Math.max(...longitudes) - Math.min(...longitudes) <= COLLECTION_FIT_MAX_LNG_SPAN
    );
}

/** Stable camera-frame identity: order changes do not reframe, filter membership does. */
export function listCollectionFrameKey(
    scopeKey: string | null | undefined,
    items: readonly Pick<WishlistMapItem, 'id'>[],
): string | null {
    if (!scopeKey) return null;
    return `${scopeKey}:${items.map((item) => item.id).sort().join(',')}`;
}

/** Expo Router params may be repeated. The first non-empty value is canonical. */
export function routeParamValue(value: string | string[] | undefined): string | null {
    const candidate = Array.isArray(value) ? value[0] : value;
    const trimmed = candidate?.trim();
    return trimmed ? trimmed : null;
}

export function shouldReturnToListOrigin(
    fromList: string | null,
    routeListId: string | null,
    selectedListId: string | null,
): boolean {
    return fromList === '1' && !!selectedListId && routeListId === selectedListId;
}

function hasValidCoordinates(entry: ListEntry): boolean {
    const { lat, lng } = entry.restaurant;
    return (
        typeof lat === 'number'
        && typeof lng === 'number'
        && Number.isFinite(lat)
        && Number.isFinite(lng)
        && lat >= -90
        && lat <= 90
        && lng >= -180
        && lng <= 180
    );
}

function matchesFilters(entry: ListEntry, filters: ListMapFilters): boolean {
    const { city, cuisine, price_level: priceLevel } = entry.restaurant;
    if (filters.city && (city?.trim() ?? '') !== filters.city) return false;
    if (filters.cuisine && (cuisine?.trim() ?? '') !== filters.cuisine) return false;
    if (filters.price && String(priceLevel ?? '') !== filters.price) return false;
    return true;
}

/** Count entries hidden from the scoped map because they have no usable point. */
export function countUnmappableListEntries(
    entries: ListEntry[],
    filters: ListMapFilters,
): number {
    return entries.filter((entry) => matchesFilters(entry, filters) && !hasValidCoordinates(entry)).length;
}

/**
 * Hydrated List entries -> the shared Wishlist map card/pin shape.
 *
 * Input order is deliberately retained: the Lists API returns authored position
 * order and a scoped carousel must read in exactly that order, even when location
 * is available. Rank is based on authored position before coordinate/filter drops.
 */
export function listEntriesToWishlistMapItems(
    entries: ListEntry[],
    options: ListMapScopeOptions,
): WishlistMapItem[] {
    return entries.flatMap((entry, index) => {
        if (!hasValidCoordinates(entry) || !matchesFilters(entry, options)) return [];

        const restaurant = entry.restaurant;
        return [{
            id: restaurant.id,
            name: restaurant.name,
            city: restaurant.city,
            cuisine: restaurant.cuisine,
            lat: restaurant.lat!,
            lng: restaurant.lng!,
            emoji: options.emoji,
            priceLevel: restaurant.price_level,
            note: entry.note,
            listContext: {
                listId: entry.list_id,
                rank: options.ranked ? index + 1 : null,
            },
        }];
    });
}
