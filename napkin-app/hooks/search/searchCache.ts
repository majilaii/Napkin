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
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
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
