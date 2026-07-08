/**
 * mapItems — pure mappers from the map data hooks' wire shapes to
 * WishlistMapItem (TICKET-131).
 *
 * Extracted from dining-map.tsx so BOTH map consumers (the wishlist tab's
 * Saved · Been · Network layers and /dining-map's Mine · Network toggle) share
 * one mapping. No I/O, no React, no native — type-only imports keep this
 * jest-safe (same pattern as mapPinsUtils / filterTabsUtils).
 *
 * Layer grammar (one map surface grammar, both screens):
 *  - logged spots (useUserSpots)      → olive teardrops (`been: true`)
 *  - network pins (useNetworkMapPins) → avatar pins (presence of `entryId`)
 *  - wishlist saves stay terracotta teardrops via buildMapPins (not here).
 */
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';
import type { WishlistMapItem } from './WishlistMapView';

/**
 * Logged spots → olive "been" pins. Coord-less spots are dropped (the caller
 * derives its unmappable count as `spots.length - items.length` when needed).
 */
export function spotsToMapItems(spots: SpotSummary[] | null | undefined): WishlistMapItem[] {
    return (spots ?? [])
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
            id: s.restaurant_id,
            name: s.name,
            city: s.city,
            cuisine: s.cuisine,
            lat: s.lat!,
            lng: s.lng!,
            been: true,
            // Peek-card + pin enrichment (map-card-pin pass, 2026-07-08):
            // $$ meta, rating numeral + loved-heart badge, visit count.
            // Deliberately NO photo: SpotSummary.photo_url mirrors
            // restaurants.photo_url = a Places hero photo (banned surface).
            priceLevel: s.price_level,
            myRating: s.avg_rating,
            visitCount: s.visit_count,
        }));
}

/**
 * Follow-graph pins → avatar pins. The RPC guarantees non-null coords, so no
 * coord filter; `entryId` presence is what flips the pin + peek to the network
 * variant downstream.
 */
export function networkPinsToMapItems(pins: NetworkMapItem[] | null | undefined): WishlistMapItem[] {
    return (pins ?? []).map((p) => ({
        id: p.restaurant_id,
        name: p.name,
        city: p.city,
        cuisine: p.cuisine,
        lat: p.lat,
        lng: p.lng,
        author: p.author,
        rating: p.rating,
        note: p.note,
        entryId: p.entry_id,
        hasReview: p.has_review,
        othersCount: p.others_count,
    }));
}

/**
 * Cuisine filter for the been/network layers (TICKET-131): the FilterTabsSheet's
 * cuisine selection applies to whichever layer is active. Trim-matched, mirroring
 * buildMapPins' matchesFilters semantics. Null filter → pass-through.
 */
export function filterItemsByCuisine(
    items: WishlistMapItem[],
    cuisine: string | null,
): WishlistMapItem[] {
    if (!cuisine) return items;
    return items.filter((i) => (i.cuisine?.trim() ?? '') === cuisine);
}
