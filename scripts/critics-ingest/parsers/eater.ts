/**
 * Eater Essentials list-diff parser.
 * TICKET-033
 *
 * Structured-selector strategy:
 *
 * fetchList(city):
 *   Fetch https://ny.eater.com/maps/best-new-york-restaurants-38-essential
 *   (NYC first; v1 hardcodes 'nyc' as the only city — OQ-2).
 *   Parse the HTML to find venue entries. Typical structure:
 *     <h2 class="c-mapstack__card-hed"><a href="...">Restaurant Name</a></h2>
 *     <address>Address text</address>
 *   Extract restaurant_name + address. Year is derived from the page's
 *   <meta property="article:modified_time"> or fallback to current year.
 *
 * The orchestrator matches each list entry against restaurants by name+city.
 * Match strategy: normalize both sides (lowercase, strip punctuation),
 * require exact name match OR ≥0.85 token overlap. Log unmatched entries.
 *
 * Decision 6: rows that fall off the list are NOT auto-removed.
 * P1-4: last_seen_on_source_at is updated on every monthly run for matched rows.
 *
 * Cities constant: v1 only 'nyc'. Expanding is a one-line edit to EATER_CITIES.
 *
 * SKELETON: returns empty array. Live HTML parsing deferred to post-operator-triage.
 */

import type { ListParser } from './index.ts';

/** V1 city list. Expanding coverage is a one-line edit here. */
export const EATER_CITIES = ['nyc'] as const;
export type EaterCity = typeof EATER_CITIES[number];

/** URL map for each supported city. */
const CITY_URLS: Record<EaterCity, string> = {
    nyc: 'https://ny.eater.com/maps/best-new-york-restaurants-38-essential',
};

export const eaterParser: ListParser = {
    mode: 'list',
    publication: 'eater',

    async fetchList(city: string): Promise<Array<{ restaurant_name: string; address?: string; year: number }>> {
        // SKELETON: returns empty array until live parsing is implemented.
        // Strategy: fetch CITY_URLS[city], parse c-mapstack__card-hed anchors.
        void city;
        void CITY_URLS;
        return [];
    },
};

/**
 * Normalize a restaurant name for fuzzy matching:
 * lowercase, trim, collapse whitespace, strip common punctuation.
 */
export function normalizeRestaurantName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[',.\-–—&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check if two normalized restaurant names are a match.
 * Exact match wins; otherwise check ≥0.85 token overlap (Jaccard-style).
 */
export function nameMatches(a: string, b: string): boolean {
    const na = normalizeRestaurantName(a);
    const nb = normalizeRestaurantName(b);
    if (na === nb) return true;

    const tokensA = new Set(na.split(' ').filter(Boolean));
    const tokensB = new Set(nb.split(' ').filter(Boolean));
    if (tokensA.size === 0 || tokensB.size === 0) return false;

    let intersection = 0;
    for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
    const union = tokensA.size + tokensB.size - intersection;
    return intersection / union >= 0.85;
}
