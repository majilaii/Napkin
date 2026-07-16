/**
 * Module-scope in-memory LRU cache for restaurant search.
 *
 * - Capacity: 10 entries (keyed by normalized query string)
 * - Result cache survives tab unmounts, dies on app cold start
 * - Tracks last 8 queries for the "recent searches" empty state
 *
 * Design: a plain Map used as an LRU via insertion-order eviction.
 * We evict the oldest entry when capacity is exceeded — Map preserves
 * insertion order so the first key is always the oldest.
 *
 * TICKET-097: recent queries are persisted to AsyncStorage
 * (`napkin.recentSearches.v1`) so they survive app restarts. Hydration is
 * lazy (first subscribe/add), async, and merge-safe: queries added before
 * hydration lands stay newest. Write-through on add/clear. The result LRU
 * stays memory-only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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
    // null when no attribution is available. Search ghosts stay text-only; the
    // value is retained for a later details lookup/upsert.
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
    // TICKET-167: SELECTed by restaurant-history?action=search so the unified
    // list can disambiguate same-name venues. Optional — stale in-memory cache
    // entries written before this field existed lack it.
    address?: string | null;
    photo_url: string | null;
    /** Restaurant-hero provenance. Optional so a stale in-memory result fails closed. */
    photo_source?: 'user' | 'table' | 'places' | 'none' | null;
    /** Stored Places author attribution paired with photo_url. */
    places_photo_attribution_html?: string | null;
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
const RECENT_CAPACITY = 8;
const RECENTS_STORAGE_KEY = 'napkin.recentSearches.v1';

// Module-scope state — survives tab unmounts
const cache = new Map<string, CachedSearchResult>();

// Recents — immutable snapshot, reassigned on every change so
// useSyncExternalStore change detection (Object.is) works.
let recentQueries: readonly string[] = [];
const recentListeners = new Set<() => void>();
let hydrationStarted = false;
// True once the hydration read has settled (or a clear made it moot). Disk
// writes are forbidden before this: a setItem dispatched while the getItem is
// in flight commits first, and the read then returns the clobbered value —
// wiping the prior session's recents.
let recentsHydrated = false;
// An add happened while the hydration read was in flight; flush one combined
// write after the merge instead.
let pendingPersistPreHydration = false;
// Bumped on clearRecents so an in-flight hydration can't resurrect cleared
// entries (clear-while-hydrating race).
let recentsEpoch = 0;

function normalizeQuery(q: string): string {
    return q.trim().toLowerCase();
}

function emitRecents(): void {
    for (const listener of recentListeners) listener();
}

/** Fire-and-forget write-through. Storage failures are non-fatal. */
function persistRecents(): void {
    if (!recentsHydrated) {
        pendingPersistPreHydration = true;
        return;
    }
    AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recentQueries)).catch(() => {});
}

async function hydrateRecents(): Promise<void> {
    const epochAtStart = recentsEpoch;
    try {
        const raw = await AsyncStorage.getItem(RECENTS_STORAGE_KEY);
        // A clear won the race — its state (memory + removeItem) is authoritative.
        if (epochAtStart !== recentsEpoch) return;
        if (raw == null) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const persisted = parsed.filter(
            (q): q is string => typeof q === 'string' && q.trim().length > 0,
        );
        if (persisted.length === 0) return;
        // Merge: queries added this session (before hydration landed) stay
        // newest; persisted entries follow, deduped.
        const merged = [...recentQueries];
        for (const q of persisted) {
            if (!merged.includes(q)) merged.push(q);
        }
        recentQueries = merged.slice(0, RECENT_CAPACITY);
        emitRecents();
    } catch {
        // Unreadable stash — start fresh; next add overwrites it.
    } finally {
        recentsHydrated = true;
        // One combined write covers everything added while the read was in
        // flight (also what used to be the length-heuristic re-persist).
        if (pendingPersistPreHydration) {
            pendingPersistPreHydration = false;
            persistRecents();
        }
    }
}

function ensureRecentsHydrated(): void {
    if (hydrationStarted) return;
    hydrationStarted = true;
    void hydrateRecents();
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
        ensureRecentsHydrated();
        recentQueries = [
            trimmed,
            ...recentQueries.filter((q) => q !== trimmed),
        ].slice(0, RECENT_CAPACITY);
        emitRecents();
        persistRecents();
    },

    has(query: string): boolean {
        return cache.has(normalizeQuery(query));
    },

    getRecentQueries(): readonly string[] {
        return recentQueries;
    },

    /**
     * Subscribe to recents changes (add / clear / hydration landing).
     * Kicks off the one-time AsyncStorage hydration on first call.
     * Returns an unsubscribe function — useSyncExternalStore-compatible.
     */
    subscribeRecents(listener: () => void): () => void {
        ensureRecentsHydrated();
        recentListeners.add(listener);
        return () => {
            recentListeners.delete(listener);
        };
    },

    /** Clear recents only (memory + disk). The result LRU is untouched. */
    clearRecents(): void {
        hydrationStarted = true; // an explicit clear must never be resurrected
        recentsHydrated = true; // the clear defines the state; a late read is epoch-discarded
        pendingPersistPreHydration = false;
        recentsEpoch += 1;
        recentQueries = [];
        emitRecents();
        AsyncStorage.removeItem(RECENTS_STORAGE_KEY).catch(() => {});
    },

    clear(): void {
        cache.clear();
        this.clearRecents();
    },
};
