/**
 * Mutation hook: add a restaurant to the caller's personal wishlist.
 * Accepts either a persisted restaurant_id or a Places payload for ghost restaurants.
 * Idempotent: re-adding an already-saved restaurant returns the existing row silently.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistSource } from '@/lib/types/wishlistSource';

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
    /** Optional source metadata (link import — TICKET-053). Validated server-side. */
    source?: WishlistSource;
}

export interface WishlistItem {
    id: string;
    user_id: string;
    restaurant_id: string;
    note: string | null;
    source: WishlistSource | null;
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
            // TICKET-036 P0-8 / P1-2 / P1-14: snapshot the wishlist-check keys
            // we're about to flip so we can roll back on error. We optimistically
            // mark BOTH the persisted-id key (if known) and the external_id key
            // (if a ghost-restaurant payload) as true; the server will resolve
            // the ghost and we'll write the canonical id key in onSuccess.
            const keys: Array<readonly unknown[]> = [];
            if (input.restaurant_id) {
                keys.push(queryKeys.wishlist.check(userId, input.restaurant_id));
            }
            if (input.restaurant?.external_id) {
                keys.push(queryKeys.wishlist.check(userId, input.restaurant.external_id));
            }
            if (keys.length === 0) return undefined;

            const snapshots: Array<{ key: readonly unknown[]; previous: boolean | undefined }> = [];
            for (const k of keys) {
                await queryClient.cancelQueries({ queryKey: k });
                snapshots.push({ key: k, previous: queryClient.getQueryData<boolean>(k) });
                queryClient.setQueryData(k, true);
            }
            return { snapshots };
        },
        onError: (_err, _input, context) => {
            if (context?.snapshots) {
                for (const { key, previous } of context.snapshots) {
                    queryClient.setQueryData(key, previous);
                }
            }
        },
        onSuccess: (item, input) => {
            if (!userId) return;
            // Authoritative server id — set the canonical check key true.
            if (item?.restaurant_id) {
                queryClient.setQueryData(
                    queryKeys.wishlist.check(userId, item.restaurant_id),
                    true,
                );
            }
            // P1-14: keep the external_id key true too. The hero/heart button
            // is keyed by whichever id the caller had (often external_id for a
            // not-yet-persisted Places result). Without this dual-write the
            // heart goes back to outline once the optimistic state ages out.
            if (input.restaurant?.external_id) {
                queryClient.setQueryData(
                    queryKeys.wishlist.check(userId, input.restaurant.external_id),
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
