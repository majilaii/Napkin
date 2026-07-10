/**
 * Mutation hook: add a restaurant to a list (optimistic).
 *
 * Optimistic updates:
 *   - adds list_id to the lists_containing cache immediately
 *   - increments entry_count in the mine cache
 *   Rolls back both on server error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { MyList } from './useMyLists';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

export interface AddToListInput {
    list_id: string;
    restaurant_id?: string;
    restaurant?: RestaurantPayload;
    note?: string;
}

export interface ListEntryResult {
    id: string;
    list_id: string;
    restaurant_id: string;
    note: string | null;
    position: number;
    /** TICKET-115: attribution stamped by the server on table-list adds. */
    added_by?: string | null;
    created_at: string;
}

async function addToList(input: AddToListInput): Promise<ListEntryResult> {
    return callEdgeFn<ListEntryResult>('lists', { action: 'add_entry', body: input });
}

export function useAddToList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: addToList,
        onMutate: async ({ list_id, restaurant_id }) => {
            if (!userId || !restaurant_id) return {};

            // Snapshot for rollback
            const containingKey = queryKeys.lists.containing(userId, restaurant_id);
            const mineKey = queryKeys.lists.mine(userId);

            await queryClient.cancelQueries({ queryKey: containingKey });
            await queryClient.cancelQueries({ queryKey: mineKey });

            const prevContaining = queryClient.getQueryData<string[]>(containingKey);
            const prevMine = queryClient.getQueryData<MyList[]>(mineKey);

            // Optimistically add list_id to containing set
            queryClient.setQueryData<string[]>(containingKey, (old) => {
                if (!old) return [list_id];
                if (old.includes(list_id)) return old;
                return [...old, list_id];
            });

            // Optimistically increment entry_count on the matching list
            queryClient.setQueryData<MyList[]>(mineKey, (old) => {
                if (!old) return old;
                return old.map((l) =>
                    l.id === list_id ? { ...l, entry_count: l.entry_count + 1 } : l,
                );
            });

            return { prevContaining, prevMine, containingKey, mineKey };
        },
        onError: (_err, { restaurant_id }, context: any) => {
            if (!userId || !restaurant_id || !context) return;
            queryClient.setQueryData(context.containingKey, context.prevContaining);
            queryClient.setQueryData(context.mineKey, context.prevMine);
        },
        onSettled: (_data, _err, { list_id }) => {
            // TICKET-036 P1-3: only invalidate the list detail — it's the
            // server's authoritative entries[] (positions, computed fields).
            // Do NOT invalidate `containing` or `mine`: onMutate already patched
            // them and a settle-time invalidation creates a race that flip-flops
            // on rapid add→remove→add sequences.
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list_id) });
            // mapPins isn't patched by onMutate, so a settle invalidation here is
            // safe (no flip-flop race) and refreshes the wishlist map (TICKET-108).
            if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.lists.mapPins(userId) });
        },
    });
}
