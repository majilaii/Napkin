/**
 * Mutation hook: add a restaurant to the caller's personal wishlist.
 * Accepts either a persisted restaurant_id or a Places payload for ghost restaurants.
 * Idempotent: re-adding an already-saved restaurant returns the existing row silently.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('wishlist', {
        body: { action: 'add', ...input },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

export function useWishlistAdd(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: addToWishlist,
        onSuccess: (item) => {
            if (userId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.wishlist.personal(userId),
                });
                if (item?.restaurant_id) {
                    queryClient.setQueryData(
                        queryKeys.wishlist.check(userId, item.restaurant_id),
                        true,
                    );
                }
            }
            // Invalidate all table wishlist caches — we don't enumerate Tables here
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.tableAll(),
            });
            // Invalidate all Atlas city caches — wished_by_viewer may have changed
            queryClient.invalidateQueries({ queryKey: queryKeys.atlas.all() });
        },
    });
}
