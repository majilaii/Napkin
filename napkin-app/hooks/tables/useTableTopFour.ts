/**
 * useTableTopFour — fetch a Table's Top 4 slots, last edit event, and suggested list.
 *
 * Keyed: queryKeys.tables.topFour(tableId)
 * Depends on: table-management?action=top_four_get
 */

import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TopFourSlot {
    position: 1 | 2 | 3 | 4;
    restaurant_id: string;
    custom_photo_url: string | null;
    updated_by: string;
    updated_at: string;
    restaurant: {
        id: string;
        name: string;
        city: string | null;
        country: string | null;
        photo_url: string | null;
        external_id: string | null;
    };
}

export interface TopFourLastEvent {
    actor_id: string;
    actor_name: string | null;
    actor_avatar_url: string | null;
    event_type: 'added' | 'removed' | 'swapped';
    position: 1 | 2 | 3 | 4;
    prev_restaurant: { id: string; name: string | null } | null;
    next_restaurant: { id: string; name: string | null } | null;
    created_at: string;
}

export interface TopFourSuggested {
    restaurant: {
        id: string;
        name: string;
        city: string | null;
        country: string | null;
        photo_url: string | null;
    };
    saved_by_n_members: number;
}

export interface TableTopFourData {
    slots: TopFourSlot[];
    last_event: TopFourLastEvent | null;
    suggested: TopFourSuggested[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTableTopFour(tableId: string | null | undefined) {
    return useQuery<TableTopFourData>({
        queryKey: queryKeys.tables.topFour(tableId ?? ''),
        queryFn: () =>
            callEdgeFn<TableTopFourData>('table-management', {
                action: 'top_four_get',
                body: { table_id: tableId },
            }),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: true,
    });
}
