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
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { searchCache, type PlacesResult, type PersistedRow, type VisitedRow } from './searchCache';
import { mergeSearchResults } from './mergeSearchResults';

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
    /** Stored photo_url for persisted tier 1/2 rows; ghosts are always null. */
    photoUrl: string | null;
    /**
     * Persisted restaurant-hero provenance. Ghosts and stale cached rows are null;
     * renderers must fail closed rather than infer Places from the URL.
     */
    photoSource?: 'user' | 'table' | 'places' | 'none' | null;
    photoReference: string | null;
    /**
     * Stored attribution for persisted Places photos, or Places API attribution
     * retained on a text-only ghost for later persistence. Null when unavailable.
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
}

export interface SearchResults {
    visited: SearchResultRow[];
    onNapkin: SearchResultRow[];
    morePlaces: SearchResultRow[];
}

type SearchCoordinates = { latitude: number; longitude: number };

interface RestaurantSearchOptions {
    /** Silently bias Places results when foreground location is already granted. */
    grantedLocationBias?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPlaces(
    query: string,
    coords?: SearchCoordinates | null,
): Promise<PlacesResult[]> {
    const body: { query: string; limit: number; lat?: number; lng?: number } = {
        query,
        limit: 15,
    };
    if (coords) {
        body.lat = coords.latitude;
        body.lng = coords.longitude;
    }
    const data = await callEdgeFn<PlacesResult[]>('places-search', { body });
    return data ?? [];
}

async function fetchPersistedDirect(
    query: string,
): Promise<{ visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] }> {
    return callEdgeFn<{ visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] }>(
        'restaurant-history',
        { method: 'GET', action: 'search', params: { q: query } },
    );
}

// ── Unified ranking (TICKET-167) ─────────────────────────────────────────────
// The pure ranking lives in ./mergeUnified (no React / supabase imports) so it
// stays jest-importable. search.tsx imports it from here; the two tier-based
// consumers (TopFourSearchScreen / EditTop4Sheet) stay on `results`.
export { mergeUnified } from './mergeUnified';

// ── Hook ─────────────────────────────────────────────────────────────────────

function useGrantedSearchLocation(enabled: boolean): {
    coords: SearchCoordinates | null;
    resolved: boolean;
} {
    const [coords, setCoords] = useState<SearchCoordinates | null>(null);
    const [resolved, setResolved] = useState(false);
    const lookupRef = useRef<Promise<SearchCoordinates | null> | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const lookup = lookupRef.current ?? (lookupRef.current = (async () => {
            try {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status !== 'granted') return null;

                const location =
                    (await Location.getLastKnownPositionAsync()) ??
                    (await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    }));
                return location
                    ? {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                    }
                    : null;
            } catch {
                // Search remains global when a granted-only location read fails.
                return null;
            }
        })());
        let active = true;

        void lookup.then((location) => {
            if (!active) return;
            setCoords(location);
            setResolved(true);
        });

        return () => {
            active = false;
        };
    }, [enabled]);

    return { coords, resolved: !enabled || resolved };
}

export function useRestaurantSearch(
    query: string,
    userId: string | null | undefined,
    options?: RestaurantSearchOptions | null,
): {
    results: SearchResults;
    isLoading: boolean;
    isPlacesError: boolean;
    refetch: () => void;
    coords: SearchCoordinates | null;
} {
    const trimmed = query.trim();
    const enabled = trimmed.length >= 2 && !!userId;
    const { coords, resolved: locationResolved } = useGrantedSearchLocation(
        options?.grantedLocationBias === true,
    );

    // Check LRU cache synchronously before React Query fires
    const cachedResult = enabled ? searchCache.get(trimmed) : undefined;

    const placesQuery = useQuery({
        queryKey: queryKeys.search.places(trimmed),
        queryFn: async () => {
            const cached = searchCache.get(trimmed);
            if (cached) return cached.places;
            return fetchPlaces(trimmed, coords);
        },
        enabled: enabled && locationResolved && !cachedResult,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
    });

    const persistedQuery = useQuery({
        queryKey: queryKeys.search.persisted(trimmed, userId ?? ''),
        queryFn: async () => {
            const cached = searchCache.get(trimmed);
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
            searchCache.set(trimmed, {
                places: placesQuery.data,
                persisted: persistedQuery.data,
                timestamp: Date.now(),
            });
        }
    }, [
        enabled,
        cachedResult,
        placesQuery.isSuccess,
        persistedQuery.isSuccess,
        placesQuery.data,
        persistedQuery.data,
        trimmed,
    ]);

    const results = useMemo<SearchResults>(() => {
        if (!enabled) return { visited: [], onNapkin: [], morePlaces: [] };

        if (cachedResult) {
            return mergeSearchResults(cachedResult.places, cachedResult.persisted);
        }

        const places = placesQuery.data ?? [];
        const persisted = persistedQuery.data ?? { visitedByMyTables: [], onNapkin: [] };
        return mergeSearchResults(places, persisted);
    }, [
        enabled,
        cachedResult,
        placesQuery.data,
        persistedQuery.data,
    ]);

    const isLoading =
        !cachedResult &&
        enabled &&
        (!locationResolved || placesQuery.isLoading || persistedQuery.isLoading);
    const isPlacesError = !cachedResult && placesQuery.isError;

    return {
        results,
        isLoading,
        isPlacesError,
        coords,
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
