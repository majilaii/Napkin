/**
 * Mutation hook: add a restaurant to the caller's personal wishlist.
 * Accepts either a persisted restaurant_id or a Places payload for ghost restaurants.
 * Idempotent: re-adding an already-saved restaurant returns the existing row silently.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

/** Shape of a Places ghost restaurant payload (matches _shared/restaurant.ts RestaurantInput) */
export interface RestaurantPayload {
    external_id: string;
    name: string;
    location?: {
        address?: string;
        locality?: string;
        country?: string;
    };
    types?: string[];
    latitude?: number;
    longitude?: number;
    photoReference?: string;
    googleRating?: number;
    googleRatingCount?: number;
    priceLevel?: number;
    cuisine?: string;
}

export interface WishlistAddInput {
    /** Persisted restaurant UUID. Provide this OR `restaurant`, not both. */
    restaurant_id?: string;
    /** Places payload for a ghost restaurant. Server will upsert before saving. */
    restaurant?: RestaurantPayload;
    note?: string;
}

export interface WishlistItem {
    id: string;
    user_id: string;
    restaurant_id: string;
    note: string | null;
    created_at: string;
}

async function addToWishlist(input: WishlistAddInput): Promise<WishlistItem> {
    return callEdgeFn<WishlistItem>('wishlist', { action: 'add', body: input });
}

export function useWishlistAdd(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: addToWishlist,
        onMutate: async (input) => {
            if (!userId) return undefined;
            // TICKET-036 P0-8 / P1-2: snapshot the wishlist-check key for the
            // restaurant we're optimistically saving, so we can roll back on error.
            const checkKey = input.restaurant_id
                ? queryKeys.wishlist.check(userId, input.restaurant_id)
                : null;
            if (checkKey) {
                await queryClient.cancelQueries({ queryKey: checkKey });
                const previous = queryClient.getQueryData<boolean>(checkKey);
                queryClient.setQueryData(checkKey, true);
                return { checkKey, previous };
            }
            return undefined;
        },
        onError: (_err, _input, context) => {
            if (context?.checkKey) {
                queryClient.setQueryData(context.checkKey, context.previous);
            }
        },
        onSuccess: (item) => {
            if (!userId) return;
            // Authoritative server id — set the canonical check key true.
            // For ghost (external_id) saves the optimistic key may have been
            // a different id; rely on next-focus refetch for the canonical key.
            if (item?.restaurant_id) {
                queryClient.setQueryData(
                    queryKeys.wishlist.check(userId, item.restaurant_id),
                    true,
                );
            }
            // Personal wishlist needs a refetch — it's the source of truth list.
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            // TICKET-036 P1-2: do NOT invalidate every cached Table wishlist nor
            // every Atlas city. Both have their own staleTime and refetch on focus;
            // a single heart tap shouldn't cause N+M refetches across the app.
        },
    });
}
