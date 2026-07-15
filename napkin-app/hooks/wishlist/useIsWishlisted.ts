/**
 * Returns true/false once resolved, and undefined while the server check is unknown.
 *
 * Accepts either a persisted restaurant_id (UUID) or a Places external_id.
 *
 * - UUID: queries the server (cache-independent, correct for users with more
 *   than one page of saves where useMyWishlist hasn't loaded the matching
 *   item yet).
 * - external_id: read-only from cache. The optimistic dual-write in
 *   useWishlistAdd.onSuccess sets this key true so the heart fills in
 *   immediately for ghost-restaurant saves (TICKET-036 P1-14).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checkWishlisted(restaurantId: string): Promise<boolean> {
    const data = await callEdgeFn<{ wishlisted: boolean }>('wishlist', {
        action: 'check',
        body: { restaurant_id: restaurantId },
    });
    return !!data?.wishlisted;
}

export function useIsWishlisted(
    restaurantIdOrExternalId: string | null | undefined,
    userId: string | null | undefined,
    options: { enabled?: boolean } = {},
): boolean | undefined {
    const queryClient = useQueryClient();
    const id = restaurantIdOrExternalId ?? null;
    const isUuid = !!id && UUID_RE.test(id);

    const { data } = useQuery({
        queryKey: id && userId
            ? queryKeys.wishlist.check(userId, id)
            : ['wishlist', 'check', 'disabled'],
        // For UUIDs, fetch from server. For external_ids, the cache value
        // (set by useWishlistAdd dual-write) is the source of truth.
        queryFn: isUuid
            ? () => checkWishlisted(id!)
            : () => Promise.resolve(
                  queryClient.getQueryData<boolean>(queryKeys.wishlist.check(userId!, id!)) ?? false,
              ),
        enabled: !!id && !!userId && (options.enabled ?? true),
        staleTime: 1000 * 60 * 5,
    });
    // Undefined is an intentional third state. Callers must not treat a
    // not-yet-checked persisted restaurant as unsaved and fire the wrong toggle.
    return data;
}
