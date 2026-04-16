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
import { useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
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
    /** For tier 1/2: stored photo_url. For tier 3: Places photoReference for thumb URL. */
    photoUrl: string | null;
    photoReference: string | null;
    tier: SearchTier;
    /** Tier 1 only: "visited by [Table]" */
    socialTag?: string;
}

export interface SearchResults {
    visited: SearchResultRow[];
    onNapkin: SearchResultRow[];
    morePlaces: SearchResultRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPlaces(query: string): Promise<PlacesResult[]> {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('places-search', {
        body: { query, limit: 15 },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    return data?.data ?? [];
}

async function fetchPersistedDirect(
    query: string,
): Promise<{ visitedByMyTables: VisitedRow[]; onNapkin: PersistedRow[] }> {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const encodedQ = encodeURIComponent(query);
    const url = `${supabaseUrl}/functions/v1/restaurant-history?action=search&q=${encodedQ}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`restaurant-history search failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data;
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
        photoUrl: r.photo_url,
        photoReference: null,
        tier: 'visited',
        socialTag: `visited by ${r.table_name}`,
    }));

    const onNapkin: SearchResultRow[] = persisted.onNapkin.map((r) => ({
        id: r.id,
        placeId: r.external_id ?? undefined,
        name: r.name,
        city: r.city,
        cuisine: r.cuisine,
        photoUrl: r.photo_url,
        photoReference: null,
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
            photoUrl: null,
            photoReference: p.photoReference,
            tier: 'morePlaces',
        }));

    return { visited, onNapkin, morePlaces };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRestaurantSearch(
    query: string,
    userId: string | null | undefined,
): {
    results: SearchResults;
    isLoading: boolean;
    isPlacesError: boolean;
    refetch: () => void;
} {
    const trimmed = query.trim();
    const enabled = trimmed.length >= 2 && !!userId;

    // Check LRU cache synchronously before React Query fires
    const cachedResult = enabled ? searchCache.get(trimmed) : undefined;

    const placesQuery = useQuery({
        queryKey: queryKeys.search.places(trimmed),
        queryFn: async () => {
            const cached = searchCache.get(trimmed);
            if (cached) return cached.places;
            return fetchPlaces(trimmed);
        },
        enabled: enabled && !cachedResult,
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

/** Returns the last 5 searched queries for the empty-state "Recent searches" list */
export function useRecentSearches(): readonly string[] {
    return searchCache.getRecentQueries();
}
