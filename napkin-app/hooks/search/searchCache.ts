/**
 * Module-scope in-memory LRU cache for restaurant search.
 *
 * - Capacity: 10 entries (keyed by normalized query string)
 * - Survives tab unmounts, dies on app cold start (no AsyncStorage)
 * - Tracks last 5 queries for the "recent searches" empty state
 *
 * Design: a plain Map used as an LRU via insertion-order eviction.
 * We evict the oldest entry when capacity is exceeded — Map preserves
 * insertion order so the first key is always the oldest.
 */

export interface CachedSearchResult {
    places: PlacesResult[];
    persisted: PersistedSearchResult;
    timestamp: number;
}

export interface PlacesResult {
    id: string; // Google Place ID (= external_id in Napkin schema)
    name: string | null;
    city: string | null;
    cuisine: string | null;
    photoReference: string | null;
    // TICKET-057: synthesized attribution HTML from Places authorAttributions.
    // null when no attribution is available. Plumbed to ghost render + upsert
    // so attribution and warm-paper overlay appear on ghost pages.
    photoAttributionHtml: string | null;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    // The server sends these on every result (shared PLACE_FIELDS mask); they
    // were silently dropped by this type until the Ritz empty-page bug. All
    // optional so stale cached entries stay type-valid.
    country?: string | null;
    /** Google place types (e.g. fine_dining_restaurant) — tag-chip source. */
    categories?: string[];
    googleRating?: number | null;
    googleRatingCount?: number | null;
    priceLevel?: number | null;
    website?: string | null;
    phone?: string | null;
    google_maps_uri?: string | null;
    hours?: { weekdayDescriptions: string[] } | null;
    /**
     * Napkin restaurant id — present ONLY on a place_id lookup with persist=true
     * (places-search upserts the row and echoes its id back). Lets the Top 4
     * picker mint an id for a never-logged Google place. Absent on text search.
     */
    restaurant_id?: string | null;
}

export interface PersistedRow {
    id: string; // Napkin DB UUID
    name: string;
    city: string | null;
    cuisine: string | null;
    photo_url: string | null;
    external_id: string | null; // Google Place ID — see migration 20251215134700
}

export interface VisitedRow extends PersistedRow {
    table_name: string;
    most_recent_activity_at: string | null;
}

export interface PersistedSearchResult {
    visitedByMyTables: VisitedRow[];
    onNapkin: PersistedRow[];
}

const LRU_CAPACITY = 10;
const RECENT_CAPACITY = 5;

// Module-scope state — survives tab unmounts
const cache = new Map<string, CachedSearchResult>();
const recentQueries: string[] = [];

function normalizeQuery(q: string): string {
    return q.trim().toLowerCase();
}

export const searchCache = {
    get(query: string): CachedSearchResult | undefined {
        const key = normalizeQuery(query);
        return cache.get(key);
    },

    set(query: string, result: CachedSearchResult): void {
        const key = normalizeQuery(query);

        // Evict oldest if at capacity
        if (cache.size >= LRU_CAPACITY && !cache.has(key)) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey !== undefined) cache.delete(oldestKey);
        }

        // Re-insert to update position (Map preserves insertion order)
        cache.delete(key);
        cache.set(key, result);
    },

    addRecent(query: string): void {
        const trimmed = query.trim();
        if (!trimmed) return;
        const existingIdx = recentQueries.indexOf(trimmed);
        if (existingIdx !== -1) recentQueries.splice(existingIdx, 1);
        recentQueries.unshift(trimmed);
        if (recentQueries.length > RECENT_CAPACITY) recentQueries.pop();
    },

    has(query: string): boolean {
        return cache.has(normalizeQuery(query));
    },

    getRecentQueries(): readonly string[] {
        return recentQueries;
    },

    clear(): void {
        cache.clear();
        recentQueries.length = 0;
    },
};
