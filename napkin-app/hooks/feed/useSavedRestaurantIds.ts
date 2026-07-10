/**
 * useSavedRestaurantIds — restaurant ids already in the viewer's local wishlist +
 * journal caches, read with getQueryData (no new fetch). Shared by TrendingRail
 * (mode-2 dedup) and DiscoveryLedger (TICKET-103) so the two discovery surfaces
 * can never fork the dedup logic — the exact drift the 5bb6c6d {rows}-envelope
 * lesson warns against.
 *
 * Empty on a cold install (nothing to dedup against — fine).
 */
import { useMemo } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

export function useSavedRestaurantIds(viewerId: string | null): Set<string> {
    const queryClient = useQueryClient();
    return useMemo(() => {
        const ids = new Set<string>();
        if (!viewerId) return ids;

        // Personal wishlist — InfiniteData<{ data: { restaurant?: { id } }[] }>.
        const wishlist = queryClient.getQueryData<
            InfiniteData<{ data: Array<{ restaurant?: { id?: string } | null }> }>
        >(queryKeys.wishlist.personal(viewerId));
        for (const page of wishlist?.pages ?? []) {
            for (const item of page?.data ?? []) {
                const id = item?.restaurant?.id;
                if (id) ids.add(id);
            }
        }

        // Diary — InfiniteData<{ rows: { restaurant_id }[] }> (page envelopes are
        // { rows }, never page.map — the 5bb6c6d lesson).
        const diary = queryClient.getQueryData<
            InfiniteData<{ rows: Array<{ restaurant_id?: string }> }>
        >(queryKeys.users.diary(viewerId));
        for (const page of diary?.pages ?? []) {
            for (const row of page?.rows ?? []) {
                if (row?.restaurant_id) ids.add(row.restaurant_id);
            }
        }

        return ids;
    }, [queryClient, viewerId]);
}
