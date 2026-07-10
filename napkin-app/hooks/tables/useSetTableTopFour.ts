/**
 * useSetTableTopFour — optimistic mutation to update a Table's Top 4.
 *
 * Follows CLAUDE.md TanStack Query mutation doctrine:
 *   onMutate  → snapshot + optimistic patch
 *   onError   → rollback from snapshot
 *   onSuccess → reconcile with server shape + narrow invalidation
 *
 * callEdgeFn used exclusively (no direct supabase.functions.invoke).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { TableTopFourData, TopFourSlot } from './useTableTopFour';

/** Google Places payload for a ghost restaurant not yet in the Napkin DB.
 *  Server upserts via upsertRestaurant before writing the slot. */
export interface TopFourPlacePayload {
    external_id: string;
    name: string;
    location?: { address?: string; locality?: string; country?: string };
    latitude?: number;
    longitude?: number;
    photoReference?: string;
    photoAttributionHtml?: string | null;
    googleRating?: number;
    googleRatingCount?: number;
    priceLevel?: number;
    cuisine?: string;
}

export interface SetTableTopFourInput {
    table_id: string;
    /** Sparse list of changed slots.
     *  Each slot provides either restaurant_id (uuid | null to clear) OR place (ghost upsert). */
    slots: Array<{
        position: 1 | 2 | 3 | 4;
        /** Persisted restaurant UUID, or null to clear the slot. */
        restaurant_id?: string | null;
        /** Google Places payload. Provide this instead of restaurant_id for ghost restaurants. */
        place?: TopFourPlacePayload;
    }>;
}

/**
 * Patch the cached slot array with requested changes.
 * Deletions (restaurant_id = null, no place) remove the position from the array.
 * Additions/swaps upsert the position.
 * For ghost-place slots, we use the place name/city for the optimistic render;
 * the server reconcile will fill the canonical restaurant_id and details.
 */
function patchSlots(
    old: TableTopFourData | undefined,
    slots: SetTableTopFourInput['slots'],
): TableTopFourData {
    if (!old) return { slots: [], last_event: null, suggested: [] };

    let patchedSlots: TopFourSlot[] = [...old.slots];

    for (const change of slots) {
        // Clear slot
        if (change.restaurant_id === null && !change.place) {
            patchedSlots = patchedSlots.filter((s) => s.position !== change.position);
            continue;
        }

        // Ghost place — use place name/city optimistically; server provides real id after reconcile
        const optimisticId = change.restaurant_id ?? change.place?.external_id ?? '';
        const optimisticName = change.place?.name ?? '';
        const optimisticCity = change.place?.location?.locality ?? null;

        const existing = patchedSlots.find((s) => s.position === change.position);
        if (existing) {
            patchedSlots = patchedSlots.map((s) =>
                s.position === change.position
                    ? {
                          ...s,
                          restaurant_id: optimisticId,
                          restaurant: change.place
                              ? { id: optimisticId, name: optimisticName, city: optimisticCity, country: null, photo_url: null, photo_source: null, external_id: change.place.external_id }
                              : s.restaurant,
                      }
                    : s,
            );
        } else {
            // Minimal optimistic slot — server reconcile fills full restaurant details
            patchedSlots = [
                ...patchedSlots,
                {
                    position: change.position,
                    restaurant_id: optimisticId,
                    custom_photo_url: null,
                    updated_by: '',
                    updated_at: new Date().toISOString(),
                    restaurant: {
                        id: optimisticId,
                        name: optimisticName,
                        city: optimisticCity,
                        country: null,
                        photo_url: null,
                        // TICKET-157: a freshly-added slot has no mirrored Places
                        // photo; null falls to typographic until the server reconcile.
                        photo_source: null,
                        external_id: change.place?.external_id ?? null,
                    },
                },
            ].sort((a, b) => a.position - b.position);
        }
    }

    return {
        ...old,
        slots: patchedSlots.sort((a, b) => a.position - b.position),
        // last_event and suggested stay unchanged optimistically; server reconciles
    };
}

export function useSetTableTopFour() {
    const queryClient = useQueryClient();

    return useMutation<TableTopFourData, Error, SetTableTopFourInput>({
        mutationFn: ({ table_id, slots }) =>
            callEdgeFn<TableTopFourData>('table-management', {
                method: 'POST',
                params: { action: 'top_four_set' },
                body: { table_id, slots },
            }),

        onMutate: async ({ table_id, slots }) => {
            const key = queryKeys.tables.topFour(table_id);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<TableTopFourData>(key);
            queryClient.setQueryData<TableTopFourData>(key, (old) => patchSlots(old, slots));
            return { previous };
        },

        onError: (_err, { table_id }, ctx: any) => {
            if (ctx?.previous !== undefined) {
                queryClient.setQueryData(queryKeys.tables.topFour(table_id), ctx.previous);
            }
        },

        onSuccess: (serverData, { table_id }) => {
            // Reconcile with full server response
            queryClient.setQueryData(queryKeys.tables.topFour(table_id), serverData);
            // Narrow invalidation — only this table's activity feed
            queryClient.invalidateQueries({
                queryKey: queryKeys.tables.activityForTable(table_id),
            });
        },
    });
}
