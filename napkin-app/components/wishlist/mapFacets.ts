/**
 * mapFacets — filter facets + filtering + ledger ordering for a map's chrome
 * (TICKET-143, scoped-map parity).
 *
 * Facets operate on a minimal structural row so source rows without coordinates
 * remain selectable before they are projected into map pins.
 *
 * `null` on any filter is pass-through. Facets are frequency-ranked (ties →
 * alpha), mirroring the Map tab's saved-set option lists.
 */
import type { WishlistMapItem } from './mapShared';

export interface FacetRow {
    cuisine: string | null;
    city: string | null;
    /** Optional because some pin producers do not carry a price tier. */
    priceLevel?: number | null;
}

export interface FacetCount<T> {
    value: T;
    count: number;
}

/** Cuisines present in the set, frequency-ranked (ties → alpha). */
export function cuisineFacets(items: readonly FacetRow[]): FacetCount<string>[] {
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
export function priceFacets(items: readonly FacetRow[]): FacetCount<number>[] {
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
export function cityFacets(items: readonly FacetRow[]): FacetCount<string>[] {
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

/** One predicate shared by pin filtering and source-row filtering. */
export function matchesFacets(row: FacetRow, filters: MapFilters): boolean {
    if (filters.cuisine && (row.cuisine?.trim() ?? '') !== filters.cuisine) return false;
    if (filters.price && row.priceLevel !== Number(filters.price)) return false;
    if (filters.city && (row.city?.trim() ?? '') !== filters.city) return false;
    return true;
}

/** Keep the concrete source-row type instead of erasing it to `FacetRow`. */
export function filterFacetRows<T extends FacetRow>(
    rows: readonly T[],
    filters: MapFilters,
): T[] {
    return rows.filter((row) => matchesFacets(row, filters));
}

/** Apply active facets while preserving all pin-specific fields. */
export function filterMapItems<T extends FacetRow>(
    items: readonly T[],
    filters: MapFilters,
): T[] {
    return filterFacetRows(items, filters);
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
