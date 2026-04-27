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

export interface SetTableTopFourInput {
    table_id: string;
    /** Sparse list of changed slots. position + restaurant_id (null = clear). */
    slots: Array<{ position: 1 | 2 | 3 | 4; restaurant_id: string | null }>;
}

/**
 * Patch the cached slot array with requested changes.
 * Deletions (restaurant_id = null) remove the position from the array.
 * Additions/swaps upsert the position.
 */
function patchSlots(
    old: TableTopFourData | undefined,
    slots: SetTableTopFourInput['slots'],
): TableTopFourData {
    if (!old) return { slots: [], last_event: null, suggested: [] };

    let patchedSlots: TopFourSlot[] = [...old.slots];

    for (const change of slots) {
        if (change.restaurant_id === null) {
            // Remove the position
            patchedSlots = patchedSlots.filter((s) => s.position !== change.position);
        } else {
            // Find existing or create minimal optimistic slot
            const existing = patchedSlots.find((s) => s.position === change.position);
            if (existing) {
                patchedSlots = patchedSlots.map((s) =>
                    s.position === change.position
                        ? { ...s, restaurant_id: change.restaurant_id! }
                        : s,
                );
            } else {
                // Minimal optimistic slot — server reconcile will fill restaurant details
                patchedSlots = [
                    ...patchedSlots,
                    {
                        position: change.position,
                        restaurant_id: change.restaurant_id,
                        custom_photo_url: null,
                        updated_by: '',
                        updated_at: new Date().toISOString(),
                        restaurant: {
                            id: change.restaurant_id,
                            name: '',
                            city: null,
                            country: null,
                            photo_url: null,
                            external_id: null,
                        },
                    },
                ].sort((a, b) => a.position - b.position);
            }
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
                action: 'top_four_set',
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
