/**
 * mapPinsUtils — pure union/precedence reducer for the wishlist map pins
 * (TICKET-108).
 *
 * Extracted so unit tests can pin the load-bearing precedence rule without
 * pulling in React Native / react-native-maps (same pattern as
 * listsSectionUtils / candidatePickerUtils). No I/O, no React, no native.
 *
 * The map unions two sources keyed by restaurant id:
 *   A) wishlist saves — plain teardrop (emoji: null)
 *   B) my-list entries — emoji in place of the dot
 *
 * Precedence (spec decision 3):
 *   - one pin per restaurant (Google-Maps one-icon-per-place behaviour)
 *   - a list pin's emoji ALWAYS overwrites a plain save (more specific)
 *   - among emoji'd lists, the NEWEST-updated list wins
 *   - a null-emoji list pin never clobbers an emoji already set
 */

/** Minimal shape a wishlist save contributes. Coords may be absent — a
 * coord-less save counts toward `unmappableSaves` rather than becoming a pin. */
export interface SaveInput {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    price_level: number | null;
    lat: number | null;
    lng: number | null;
}

/** Minimal shape a list-entry pin contributes to the wishlist map union. */
export interface ListPinInput {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    price_level: number | null;
    lat: number | null;
    lng: number | null;
    emoji: string | null;
    list_updated_at: string | null;
}

export interface MapPinItem {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    lat: number;
    lng: number;
    emoji: string | null;
    /** Camel-cased to align with WishlistMapItem (the map consumes this shape
     * directly) — the peek card's $$ meta token (map-card-pin pass, 2026-07-08). */
    priceLevel: number | null;
}

export interface Filters {
    city: string | null;
    cuisine: string | null;
    /** "1".."4" string, matching the price pill, or null. */
    price: string | null;
}

function matchesFilters(
    city: string | null | undefined,
    cuisine: string | null | undefined,
    price: number | null | undefined,
    f: Filters,
): boolean {
    if (f.city && (city?.trim() ?? '') !== f.city) return false;
    if (f.cuisine && (cuisine?.trim() ?? '') !== f.cuisine) return false;
    if (f.price && String(price ?? '') !== f.price) return false;
    return true;
}

/**
 * Build the filtered union of saves + list pins.
 * Returns the deduped pin list and the count of coord-less wishlist saves
 * (list pins without coords are silently dropped — the server already filters
 * them; they don't count toward "unmappable saved spots").
 */
export function buildMapPins(
    saves: SaveInput[],
    listPins: ListPinInput[],
    filters: Filters,
): { items: MapPinItem[]; unmappableSaves: number; unmappableSaveIds: string[] } {
    const byId = new Map<string, MapPinItem>();
    // Restaurant ids of filter-passing saves with no coords — the murmur's
    // tap-through lists exactly these (count stays derived for old callers).
    const unmappableSaveIds: string[] = [];

    // (A) wishlist saves — cuisine-glyph bubble, no emoji.
    for (const s of saves) {
        if (!matchesFilters(s.city, s.cuisine, s.price_level, filters)) continue;
        if (s.lat != null && s.lng != null) {
            byId.set(s.id, {
                id: s.id, name: s.name, city: s.city, cuisine: s.cuisine,
                lat: s.lat, lng: s.lng, emoji: null,
                priceLevel: s.price_level,
            });
        } else {
            unmappableSaveIds.push(s.id);
        }
    }

    // (B) list pins — folded via Map.set (last write wins), so process OLDEST
    // first (updated_at ASC): the newest emoji'd list is written last and wins.
    // The `?? prior?.emoji` fallback below means a null-emoji pin never clobbers
    // an emoji already set (emoji is always more specific than a plain dot).
    const ordered = [...listPins].sort((a, b) => {
        const at = a.list_updated_at ?? '';
        const bt = b.list_updated_at ?? '';
        return at < bt ? -1 : at > bt ? 1 : 0; // ASC
    });
    for (const p of ordered) {
        if (!matchesFilters(p.city, p.cuisine, p.price_level, filters)) continue;
        if (p.lat == null || p.lng == null) continue;
        const prior = byId.get(p.restaurant_id);
        byId.set(p.restaurant_id, {
            id: p.restaurant_id, name: p.name, city: p.city, cuisine: p.cuisine,
            lat: p.lat, lng: p.lng,
            emoji: p.emoji ?? prior?.emoji ?? null,
            priceLevel: p.price_level,
        });
    }

    return {
        items: [...byId.values()],
        unmappableSaves: unmappableSaveIds.length,
        unmappableSaveIds,
    };
}
