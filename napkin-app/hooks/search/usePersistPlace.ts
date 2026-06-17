/**
 * usePersistPlace — upsert a Google Place into `restaurants` and return its
 * Napkin id.
 *
 * The profile Top 4 picker can feature a place the user has never logged. The
 * curated-pick RPC needs a real restaurant_id, but a ghost search result only
 * carries a Google Place ID. This calls places-search with persist=true, which
 * upserts the row (idempotent, non-destructive merge) and echoes restaurant_id
 * back on the sanitized result.
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { PlacesResult } from './searchCache';

export function usePersistPlace() {
    return useMutation({
        mutationFn: async (placeId: string): Promise<string> => {
            const arr = await callEdgeFn<PlacesResult[]>('places-search', {
                body: { place_id: placeId, persist: true },
            });
            const id = arr?.[0]?.restaurant_id;
            if (!id) throw new Error('could not save this place — try again');
            return id;
        },
    });
}
