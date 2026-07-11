/**
 * useRestaurantSearch — core search hook
 *
 * Fires two queries in parallel:
 *   1. places-search edge function (Google Places API, keyed on query)
 *   2. restaurant-history?action=search (persisted DB rows for user's Tables)
 *
 * Merges and dedupes by external_id (= Google Place ID, renamed in 20251215134700).
 * Returns tiered results:
 *   - visited: persisted restaurants your Tables have logged
 *   - onNapkin: other persisted restaurants
 *   - morePlaces: Google Places ghosts (not yet in Napkin DB)
 *
 * In-memory LRU cache (size 10) keyed by normalized query.
 * Cache lives at module scope — survives tab unmounts, dies on cold start.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { searchCache, type PlacesResult, type PersistedRow, type VisitedRow } from './searchCache';

// ── Types ────────────────────────────────────────────────────────────────────

export type SearchTier = 'visited' | 'onNapkin' | 'morePlaces';

export interface SearchResultRow {
    /** Napkin DB id — present for tier 1/2 rows, absent for ghost rows */
    id?: string;
    /** Google Place ID. Present for tier 1/2 with external_id, and for all tier 3.
     *  external_id is where Google Place IDs are stored (renamed from google_place_id in 20251215134700) */
    placeId?: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    address: string | null;
    /** For tier 1/2: stored photo_url. For tier 3: Places photoReference for thumb URL. */
    photoUrl: string | null;
    photoReference: string | null;
    /**
     * TICKET-057: Places photo attribution HTML synthesized from authorAttributions.
     * Carried through SearchResultRow → placePayload JSON → ghost render so user
     * stories #1/#2 fire on search-origin ghost pages, not only on direct lookups.
     * Null when no attribution available (sentinel path will mark photo_source='none').
     */
    photoAttributionHtml: string | null;
    tier: SearchTier;
    /** Tier 1 only: "visited by [Table]" */
    socialTag?: string;
    /**
     * TICKET-167: visited rows only — ISO timestamp of the most recent Table
     * activity on this restaurant. Drives the within-visited recency sort in
     * mergeUnified. Absent on onNapkin / ghost rows.
     */
    mostRecentActivityAt?: string | null;
    /**
     * Ghost rows: the FULL sanitized Places object from the server (coords,
     * price, rating, categories, phone, hours…). Navigation must pass THIS as
     * placePayload — the trimmed row starves the restaurant page.
     */
    place?: PlacesResult;
    /**
     * TICKET-174: ghost rows only — true when the row came from the server's
     * global fallback pass (nearby bias found nothing). Ranked after all
     * non-fallback rows and rendered city-first under a quiet divider.
     */
    fartherAfield?: boolean;
}

export interface SearchResults {
    visited: SearchResultRow[];
    onNapkin: SearchResultRow[];
    morePlaces: SearchResultRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPlaces(
    query: string,
    coords?: { latitude: number; longitude: number } | null,
): Promise<PlacesResult[]> {
    const body: any = { query, limit: 15 };
    if (coords) {
        body.latitude = coords.latitude;
        body.longitude = coords.longitude;
        body.radius = 10000; // 10 km bias
        // TICKET-174: when the biased pass returns zero (distant name like
        // "kamer" searched from London), the server re-queries with a world
        // rectangle and tags rows fartherAfield. Only meaningful with coords.
        body.global_fallback = true;
    }
    const data = await callEdgeFn<PlacesResult[]>('places-search', { body });
    return data ?? [];
}

/**
 * TICKET-174: coarse location bucket (~0.1° ≈ 11 km, matching the 10 km bias)
 * for cache keys. Results are location-biased, so caching by query text alone
 * replays London results in Amsterdam (and pins pre-fallback empties).
 */
function toCoordsBucket(
    coords?: { latitude: number; longitude: number } | null,
): string | null {
    if (!coords) return null;
    return `${coords.latitude.toFixed(1)},${coords.longitude.toFixed(1)}`;
}

async function fetchPersistedDirect(
    query: string,
): Promise<{ visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] }> {
    return callEdgeFn<{ visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] }>(
        'restaurant-history',
        { method: 'GET', action: 'search', params: { q: query } },
    );
}

function mergeResults(
    places: PlacesResult[],
    persisted: { visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] },
): SearchResults {
    // Build set of external_ids that are already in persisted tiers
    // external_id is where Google Place IDs are stored (renamed from google_place_id in 20251215134700)
    const persistedExternalIds = new Set<string>();
    for (const r of persisted.visitedByMyTables) {
        if (r.external_id) persistedExternalIds.add(r.external_id);
    }
    for (const r of persisted.onNapkin) {
        if (r.external_id) persistedExternalIds.add(r.external_id);
    }

    const visited: SearchResultRow[] = persisted.visitedByMyTables.map((r) => ({
        id: r.id,
        placeId: r.external_id ?? undefined,
        name: r.name,
        city: r.city,
        cuisine: r.cuisine,
        address: r.address ?? null,
        photoUrl: r.photo_url,
        photoReference: null,
        photoAttributionHtml: null,
        tier: 'visited',
        socialTag: `visited by ${r.table_name}`,
        mostRecentActivityAt: r.most_recent_activity_at,
    }));

    const onNapkin: SearchResultRow[] = persisted.onNapkin.map((r) => ({
        id: r.id,
        placeId: r.external_id ?? undefined,
        name: r.name,
        city: r.city,
        cuisine: r.cuisine,
        address: r.address ?? null,
        photoUrl: r.photo_url,
        photoReference: null,
        photoAttributionHtml: null,
        tier: 'onNapkin',
    }));

    // Ghost rows: Places results not already in tier 1/2
    const morePlaces: SearchResultRow[] = places
        .filter((p) => !persistedExternalIds.has(p.id))
        .map((p) => ({
            placeId: p.id,
            name: p.name ?? 'Unknown',
            city: p.city,
            cuisine: p.cuisine,
            address: p.formattedAddress,
            photoUrl: null,
            photoReference: p.photoReference,
            photoAttributionHtml: p.photoAttributionHtml,
            tier: 'morePlaces',
            fartherAfield: p.fartherAfield,
            place: p,
        }));

    return { visited, onNapkin, morePlaces };
}

// ── Unified ranking (TICKET-167) ─────────────────────────────────────────────
// The pure ranking lives in ./mergeUnified (no React / supabase imports) so it
// stays jest-importable. search.tsx imports it from here; the two tier-based
// consumers (TopFourSearchScreen / EditTop4Sheet) stay on `results`.
export { mergeUnified } from './mergeUnified';

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRestaurantSearch(
    query: string,
    userId: string | null | undefined,
    coords?: { latitude: number; longitude: number } | null,
): {
    results: SearchResults;
    isLoading: boolean;
    isPlacesError: boolean;
    refetch: () => void;
} {
    const trimmed = query.trim();
    const enabled = trimmed.length >= 2 && !!userId;
    // TICKET-174: results are location-biased, so both cache layers key on a
    // coarse coords bucket alongside the query text.
    const coordsBucket = toCoordsBucket(coords);

    // Check LRU cache synchronously before React Query fires
    const cachedResult = enabled ? searchCache.get(trimmed, coordsBucket) : undefined;

    const placesQuery = useQuery({
        queryKey: queryKeys.search.places(trimmed, coordsBucket),
        queryFn: async () => {
            const cached = searchCache.get(trimmed, coordsBucket);
            if (cached) return cached.places;
            return fetchPlaces(trimmed, coords);
        },
        enabled: enabled && !cachedResult,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
    });

    const persistedQuery = useQuery({
        queryKey: queryKeys.search.persisted(trimmed, userId ?? ''),
        queryFn: async () => {
            const cached = searchCache.get(trimmed, coordsBucket);
            if (cached) return cached.persisted;
            return fetchPersistedDirect(trimmed);
        },
        enabled: enabled && !cachedResult,
        staleTime: 1000 * 60 * 5,
        retry: 1,
    });

    // Write to cache as a side effect once both succeed
    useEffect(() => {
        if (
            enabled &&
            !cachedResult &&
            placesQuery.isSuccess &&
            persistedQuery.isSuccess &&
            placesQuery.data &&
            persistedQuery.data
        ) {
            // TICKET-174: never pin a fully-empty result set — a transient
            // zero (network blip, pre-fallback response) would otherwise
            // replay as "No results" until the TTL. React Query still
            // dedupes refetches for 5 min under its own key.
            const isEmpty =
                placesQuery.data.length === 0 &&
                persistedQuery.data.visitedByMyTables.length === 0 &&
                persistedQuery.data.onNapkin.length === 0;
            if (isEmpty) return;
            searchCache.set(trimmed, {
                places: placesQuery.data,
                persisted: persistedQuery.data,
                timestamp: Date.now(),
            }, coordsBucket);
        }
    }, [
        enabled,
        cachedResult,
        placesQuery.isSuccess,
        persistedQuery.isSuccess,
        placesQuery.data,
        persistedQuery.data,
        trimmed,
        coordsBucket,
    ]);

    const results = useMemo<SearchResults>(() => {
        if (!enabled) return { visited: [], onNapkin: [], morePlaces: [] };

        if (cachedResult) {
            return mergeResults(cachedResult.places, cachedResult.persisted);
        }

        const places = placesQuery.data ?? [];
        const persisted = persistedQuery.data ?? { visitedByMyTables: [], onNapkin: [] };
        return mergeResults(places, persisted);
    }, [
        enabled,
        cachedResult,
        placesQuery.data,
        persistedQuery.data,
    ]);

    const isLoading = !cachedResult && enabled && (placesQuery.isLoading || persistedQuery.isLoading);
    const isPlacesError = !cachedResult && placesQuery.isError;

    return {
        results,
        isLoading,
        isPlacesError,
        refetch: () => {
            placesQuery.refetch();
            persistedQuery.refetch();
        },
    };
}

/**
 * Returns the last 8 searched queries for the empty-state "Recent searches"
 * list. Subscribed to the store — re-renders when a query is added, on clear,
 * and when the AsyncStorage hydration lands (TICKET-097).
 */
export function useRecentSearches(): readonly string[] {
    return useSyncExternalStore(
        searchCache.subscribeRecents,
        searchCache.getRecentQueries,
        searchCache.getRecentQueries,
    );
}
