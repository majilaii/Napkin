/**
 * Query hook: every restaurant across the caller's OWN lists, with the owning
 * list's emoji + updated_at, for the wishlist map's list-entry pins (TICKET-108).
 *
 * list_mine returns metadata only (no per-entry coords), so this is a dedicated
 * one-round-trip source keyed on the caller — no N+1 across `get`.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface ListMapPin {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    /** For the map's price filter — parity with the wishlist saves' price_level. */
    price_level: number | null;
    lat: number;
    lng: number;
    list_id: string;
    /** Nullable = the owning list has no emoji (renders as a plain teardrop). */
    emoji: string | null;
    /** ISO-8601 — precedence tiebreak: newest-updated emoji'd list wins. */
    list_updated_at: string | null;
}

async function fetchListMapPins(): Promise<ListMapPin[]> {
    const data = await callEdgeFn<ListMapPin[]>('lists', { action: 'map_pins' });
    return data ?? [];
}

export function useListMapPins(userId: string | null | undefined) {
    return useQuery<ListMapPin[], Error>({
        queryKey: queryKeys.lists.mapPins(userId ?? ''),
        queryFn: fetchListMapPins,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
