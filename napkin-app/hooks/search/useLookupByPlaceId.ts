/**
 * Place lookup by Google Place ID (`ChIJ…`).
 *
 * Two distinct uses, one endpoint:
 *
 *   1. `useLookupByPlaceId(placeId)` — recovers from missing / lost ghost
 *      payload. The restaurant detail page accepts a `placeId` URL param;
 *      when there's no `placePayload`, we hit places-search (Place Details
 *      mode) to synthesize a ghost on demand.
 *
 *   2. `useLazyBackfillRestaurant({ enabled, externalId })` — heals stale
 *      persisted rows that pre-date Places metadata extraction (city/photo
 *      missing). Fires once with `persist=true` so the server upserts the
 *      fresh fields and mirrors the hero photo to Storage. Side-effecty;
 *      only runs when `enabled`. Refetches the page on success.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { PlacesResult } from './searchCache';

export function shouldLookupPlaceDetails(args: {
    isGhost: boolean;
    placeId: string | null | undefined;
    placePayload: Partial<PlacesResult> | null;
}): boolean {
    const { isGhost, placeId, placePayload } = args;
    if (!isGhost || !placeId) return false;
    if (!placePayload) return true;
    return placePayload.deferred === true
        || placePayload.latitude == null
        || placePayload.longitude == null
        || placePayload.googleRating == null;
}

async function lookupByPlaceId(
    placeId: string,
    persist: boolean,
): Promise<PlacesResult[]> {
    return (await callEdgeFn<PlacesResult[]>('places-search', {
        body: { place_id: placeId, persist },
    })) ?? [];
}

/**
 * Look up a single Place by its Google Place ID.
 * Used for ghost deep-link recovery when no placePayload was passed.
 *
 * Does NOT persist by default; pure read.
 */
export function useLookupByPlaceId(
    placeId: string | null | undefined,
    options?: { enabled?: boolean },
) {
    return useQuery({
        queryKey: ['places', 'lookup', placeId ?? ''],
        queryFn: async () => {
            const arr = await lookupByPlaceId(placeId!, false);
            return arr[0] ?? null;
        },
        enabled: !!placeId && (options?.enabled ?? true),
        staleTime: 1000 * 60 * 60, // 1h — places rarely change
    });
}

/**
 * Fire-and-forget backfill for a stale persisted restaurant.
 *
 * Conditions to trigger (all required):
 *  - `enabled` true (caller decides — typically when row is missing city
 *    AND/OR photo_url AND we have an external_id to resolve).
 *  - external_id is a real Google Place ID (`ChIJ…`).
 *
 * Runs at most once per externalId per session via `firedRef`. On success,
 * invalidates the restaurant page query so the user sees freshened data.
 */
export function useLazyBackfillRestaurant(args: {
    enabled: boolean;
    externalId: string | null | undefined;
    restaurantId: string | null | undefined;
    tableId?: string | null;
}) {
    const { enabled, externalId, restaurantId, tableId } = args;
    const qc = useQueryClient();
    const firedRef = useRef<Set<string>>(new Set());

    const mutation = useMutation({
        mutationFn: async (placeId: string) => {
            return lookupByPlaceId(placeId, /* persist */ true);
        },
        onSuccess: () => {
            if (restaurantId) {
                qc.invalidateQueries({
                    queryKey: queryKeys.restaurants.page(restaurantId, tableId ?? undefined),
                });
            }
        },
        // Don't surface errors — backfill is best-effort.
        onError: (e) => console.warn('[lazyBackfillRestaurant] failed', e),
    });

    useEffect(() => {
        if (!enabled) return;
        if (!externalId || !externalId.startsWith('ChIJ')) return;
        if (firedRef.current.has(externalId)) return;
        firedRef.current.add(externalId);
        mutation.mutate(externalId);
        // Intentionally exclude `mutation` from deps — we only want to fire
        // on enabled/externalId change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, externalId]);

    return mutation;
}
