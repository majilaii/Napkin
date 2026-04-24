/**
 * Hook to start an async Round (group rating session).
 * Calls table-night edge function with action: 'start', which delegates to
 * the start_round RPC (atomic round + participant + entry creation).
 *
 * TICKET-037: response shape is now { night_id, entry_id }.
 * The edge function fetches + returns the full night row after the RPC
 * so callers receive status/revealed_at as before.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface StartRoundInput {
    table_id: string;
    restaurant: {
        external_id: string;
        name: string;
        location?: { address?: string; locality?: string; country?: string };
        types?: string[];
        latitude?: number;
        longitude?: number;
        photoReference?: string;
    };
    participant_ids: string[];
    rating: number;
    notes?: string;
    dish_description?: string;
    photo_url?: string;
    photo_urls?: string[];
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}

async function startRound(input: StartRoundInput) {
    return callEdgeFn('table-night', {
        action: 'start',
        body: {
            table_id: input.table_id,
            restaurant: input.restaurant,
            participant_ids: input.participant_ids,
            is_async: true,
            rating: input.rating,
            notes: input.notes,
            dish_description: input.dish_description,
            photo_url: input.photo_url,
            photo_urls: input.photo_urls,
            vibe_rating: input.vibe_rating,
            flavor_rating: input.flavor_rating,
            service_rating: input.service_rating,
            value_rating: input.value_rating,
        },
    });
}

export function useStartRound(userId?: string | null, tableId?: string | null) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: startRound,
        onSuccess: () => {
            // P0-6: dropped the entries.list invalidate — no useQuery is keyed
            // ['entries', userId] (mySolo uses ['entries', 'mySolo', userId],
            // a sibling subtree, not a descendant). It was a dead invalidate.
            if (tableId) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activity(tableId) });
                qc.invalidateQueries({ queryKey: queryKeys.tableNight.active(tableId) });
            }
            // userId is consumed indirectly via the active-night refetch.
            void userId;
        },
    });
}
