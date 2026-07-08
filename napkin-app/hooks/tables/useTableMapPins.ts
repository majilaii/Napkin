/**
 * useTableMapPins — the table's been-together map pins (TICKET-139).
 *
 * Backs the /table-map "Been together" layer: the table's group meals (suppers +
 * legacy rounds) with coordinates, one row per restaurant (most-recent group meal
 * wins; `suppers_count` for "×N"), member-gated by table-atlas's existing
 * `checkMembership`. Lazy-armed on the first "Been together" select.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface TableMapPin {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    lat: number;
    lng: number;
    supper_id: string | null;
    gathered_on: string;
    participants: { user_id: string; display_name: string; avatar_url: string | null }[];
    suppers_count: number;
}

export function useTableMapPins(tableId: string | null | undefined, opts?: { enabled?: boolean }) {
    return useQuery<TableMapPin[], Error>({
        queryKey: queryKeys.atlas.mapPins(tableId ?? ''),
        queryFn: async () => {
            const data = await callEdgeFn<{ rows?: TableMapPin[] }>('table-atlas', {
                action: 'map_pins',
                body: { table_id: tableId },
            });
            return data?.rows ?? [];
        },
        enabled: !!tableId && (opts?.enabled ?? true), // lazy-armed on first "Been together" select
        staleTime: 1000 * 60 * 5,
    });
}
