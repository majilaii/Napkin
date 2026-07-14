import type { ListEntry } from '@/hooks/lists/useList';
import { isCityScaleCollection, type WishlistMapItem } from './mapShared';

// isCityScaleCollection moved to the neutral mapShared module (shared with
// ScopedListMap); re-exported here so existing callers/tests keep resolving.
export { isCityScaleCollection };

export interface ListMapFilters {
    city: string | null;
    cuisine: string | null;
    price: string | null;
}

export interface ListMapScopeOptions extends ListMapFilters {
    emoji: string | null;
    ranked: boolean;
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

/**
 * The map tab's "Places" affordance (TICKET-186, A6). A scoped List pushes to
 * that list's own sheet-over-map route; the unscoped map switches to the in-tab
 * list overlay. (The former back-bridge is gone — one route now owns
 * both a list's places and its map, so back is trivially correct.)
 */
export type SwitchToPlacesTarget =
    | { kind: 'push-list'; listId: string }
    | { kind: 'show-list-overlay' };

export function resolveSwitchToPlaces(selectedListId: string | null): SwitchToPlacesTarget {
    return selectedListId
        ? { kind: 'push-list', listId: selectedListId }
        : { kind: 'show-list-overlay' };
}

/** Shared coordinate-validity guard for list entries (TICKET-186, A12). */
export function hasValidCoordinates(entry: ListEntry): boolean {
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
