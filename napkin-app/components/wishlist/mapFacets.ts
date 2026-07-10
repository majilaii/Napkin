/**
 * mapFacets — filter facets + filtering + ledger ordering for a map's chrome
 * (TICKET-143, table-map parity).
 *
 * The table-map brings the Map tab's Filter chip + List pill to /table-map. Its
 * layers are already `WishlistMapItem[]` (overlap saves / been-together pins), so
 * the facet counts and the filter predicate operate directly on those — no new
 * server plumbing, no new sheet props. Pure so the whole matrix is unit-testable.
 *
 * Cuisine match reuses `filterItemsByCuisine` (one source of truth); price/city
 * extend it. `null` on any filter is pass-through. Facets are frequency-ranked
 * (ties → alpha), mirroring the Map tab's saved-set option lists.
 */
import type { WishlistMapItem } from './WishlistMapView';
import { filterItemsByCuisine } from './mapItems';

export interface FacetCount<T> {
    value: T;
    count: number;
}

/** Cuisines present in the set, frequency-ranked (ties → alpha). */
export function cuisineFacets(items: WishlistMapItem[]): FacetCount<string>[] {
    const counts = new Map<string, number>();
    for (const i of items) {
        const c = i.cuisine?.trim();
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)));
}

/** Price tiers present (1–4), ascending — only tiers that exist appear. */
export function priceFacets(items: WishlistMapItem[]): FacetCount<number>[] {
    const counts = new Map<number, number>();
    for (const i of items) {
        const lvl = i.priceLevel;
        if (lvl != null && lvl > 0) counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value - b.value);
}

/** Cities present, frequency-ranked (ties → alpha). */
export function cityFacets(items: WishlistMapItem[]): FacetCount<string>[] {
    const counts = new Map<string, number>();
    for (const i of items) {
        const c = i.city?.trim();
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)));
}

export interface MapFilters {
    cuisine?: string | null;
    /** Price tier as a string ("1".."4"), matching the sheet option values. */
    price?: string | null;
    city?: string | null;
}

/** Apply the active cuisine/price/city filters (any null = pass-through). */
export function filterMapItems(items: WishlistMapItem[], filters: MapFilters): WishlistMapItem[] {
    let out = filterItemsByCuisine(items, filters.cuisine ?? null);
    if (filters.price) {
        const lvl = Number(filters.price);
        out = out.filter((i) => i.priceLevel === lvl);
    }
    if (filters.city) {
        out = out.filter((i) => (i.city?.trim() ?? '') === filters.city);
    }
    return out;
}

/**
 * Been-together items, most-recent gathered first. Items without a `gathered`
 * date sink to the end (stable among themselves). Non-mutating.
 */
export function sortGatheredRecent(items: WishlistMapItem[]): WishlistMapItem[] {
    return [...items].sort((a, b) => {
        const ta = a.gathered ? Date.parse(a.gathered.on) : NaN;
        const tb = b.gathered ? Date.parse(b.gathered.on) : NaN;
        const va = Number.isNaN(ta) ? -Infinity : ta;
        const vb = Number.isNaN(tb) ? -Infinity : tb;
        return vb - va; // most recent first
    });
}
