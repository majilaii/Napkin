/**
 * Mutation hook: add a restaurant to a list (optimistic).
 *
 * Optimistic updates:
 *   - adds list_id to the lists_containing cache immediately
 *   - increments entry_count in the mine cache
 *   Rolls back both on server error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    created_at: string;
}

async function addToList(input: AddToListInput): Promise<ListEntryResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'add_entry', ...input },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
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
        onSettled: (_data, _err, { list_id, restaurant_id }) => {
            if (userId && restaurant_id) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.lists.containing(userId, restaurant_id),
                });
                queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
            }
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list_id) });
        },
    });
}
