/**
 * Mutation hook: create a new list.
 * Optionally adds an initial restaurant in the same server call.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

export interface CreateListInput {
    title: string;
    description?: string;
    ranked?: boolean;
    privacy?: 'public' | 'private';
    /** TICKET-108: optional emoji shown on the Lists row + map pin. */
    emoji?: string | null;
    /** UUID of an already-persisted restaurant to add as the initial entry */
    initial_restaurant_id?: string;
    /** Places ghost payload — server will upsert it then add as initial entry */
    initial_restaurant?: RestaurantPayload;
    initial_note?: string;
}

export interface CreatedList {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    privacy: 'public' | 'private';
    /** TICKET-108: user-chosen emoji. Nullable = default teardrop. */
    emoji: string | null;
    created_at: string;
    updated_at: string;
}

async function createList(input: CreateListInput): Promise<CreatedList> {
    return callEdgeFn<CreatedList>('lists', { action: 'create', body: input });
}

export function useCreateList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createList,
        onSuccess: (list, variables) => {
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
                // If we added an initial restaurant, also refresh the containing cache
                const initialRestaurantId = variables.initial_restaurant_id;
                if (initialRestaurantId) {
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.lists.containing(userId, initialRestaurantId),
                    });
                }
            }
        },
    });
}
