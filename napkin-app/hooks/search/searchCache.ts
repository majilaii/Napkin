/**
 * Module-scope in-memory LRU cache for restaurant search.
 *
 * - Capacity: 10 entries (keyed by user, locality bucket, and query)
 * - Result cache survives tab unmounts, dies on app cold start
 * - Tracks last 8 queries for the "recent searches" empty state
 *
 * Design: a plain Map used as an LRU via insertion-order eviction.
 * We evict the oldest entry when capacity is exceeded — Map preserves
 * insertion order so the first key is always the oldest.
 *
 * TICKET-097: recent queries are persisted to AsyncStorage
 * (`napkin.recentSearches.v1.<userId>`) so they survive app restarts without
 * crossing auth identities. The old device-global key is deleted, not migrated.
 * Hydration is
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
    /** True only for rows returned by the opt-in global fallback pass. */
    fartherAfield?: boolean;
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
    /** TICKET-228 additive search projection; optional for stale LRU entries. */
    lat?: number | null;
    lng?: number | null;
    google_rating?: number | null;
    is_pinned?: boolean;
    friends_been_count?: number;
    rating?: {
        tier: 'you' | 'friends' | 'google';
        value: number;
        scale: 5;
    } | null;
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
const RESULT_TTL_MS = 1000 * 60 * 15;
const RECENT_CAPACITY = 8;
const LEGACY_RECENTS_STORAGE_KEY = 'napkin.recentSearches.v1';

export function recentsStorageKey(userId: string): string {
    return `${LEGACY_RECENTS_STORAGE_KEY}.${userId}`;
}

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
let activeUserId: string | null = null;

function normalizeQuery(q: string): string {
    return q.trim().toLowerCase();
}

function resultKey(userId: string, query: string, localityBucket?: string | null): string {
    return `${userId}\u0000${localityBucket ?? 'nolo'}\u0000${normalizeQuery(query)}`;
}

function isFullyEmpty(result: CachedSearchResult): boolean {
    return result.places.length === 0 &&
        result.persisted.visitedByMyTables.length === 0 &&
        result.persisted.onNapkin.length === 0;
}

function emitRecents(): void {
    for (const listener of recentListeners) listener();
}

/** Fire-and-forget write-through. Storage failures are non-fatal. */
function persistRecents(): void {
    const userId = activeUserId;
    if (!userId) return;
    if (!recentsHydrated) {
        pendingPersistPreHydration = true;
        return;
    }
    AsyncStorage.setItem(recentsStorageKey(userId), JSON.stringify(recentQueries)).catch(() => {});
}

async function hydrateRecents(): Promise<void> {
    const epochAtStart = recentsEpoch;
    const userIdAtStart = activeUserId;
    if (!userIdAtStart) return;
    try {
        const raw = await AsyncStorage.getItem(recentsStorageKey(userIdAtStart));
        // A clear won the race — its state (memory + removeItem) is authoritative.
        if (epochAtStart !== recentsEpoch || activeUserId !== userIdAtStart) return;
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
        if (epochAtStart !== recentsEpoch || activeUserId !== userIdAtStart) return;
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
    setActiveUser(userId: string | null | undefined): void {
        const nextUserId = userId?.trim() || null;
        if (activeUserId === nextUserId) return;

        activeUserId = nextUserId;
        recentsEpoch += 1;
        cache.clear();
        recentQueries = [];
        hydrationStarted = false;
        recentsHydrated = false;
        pendingPersistPreHydration = false;
        emitRecents();

        // Never hand the pre-TICKET-228 device-global stash to a signed-in user.
        AsyncStorage.removeItem(LEGACY_RECENTS_STORAGE_KEY).catch(() => {});
    },

    get(userId: string, query: string, localityBucket?: string | null): CachedSearchResult | undefined {
        const key = resultKey(userId, query, localityBucket);
        const result = cache.get(key);
        if (!result) return undefined;
        if (Date.now() - result.timestamp >= RESULT_TTL_MS) {
            cache.delete(key);
            return undefined;
        }
        return result;
    },

    set(
        userId: string,
        query: string,
        result: CachedSearchResult,
        localityBucket?: string | null,
    ): void {
        if (isFullyEmpty(result)) return;
        const key = resultKey(userId, query, localityBucket);

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
        if (!activeUserId) return;
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

    has(userId: string, query: string, localityBucket?: string | null): boolean {
        return this.get(userId, query, localityBucket) !== undefined;
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
        const userId = activeUserId;
        hydrationStarted = true; // an explicit clear must never be resurrected
        recentsHydrated = true; // the clear defines the state; a late read is epoch-discarded
        pendingPersistPreHydration = false;
        recentsEpoch += 1;
        recentQueries = [];
        emitRecents();
        if (userId) AsyncStorage.removeItem(recentsStorageKey(userId)).catch(() => {});
    },

    clear(): void {
        cache.clear();
        this.clearRecents();
    },
};
