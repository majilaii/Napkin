/**
 * useRestaurantClippings — the ON SOCIALS rail's data (TICKET-156).
 *
 * Its OWN query, independent of useRestaurantPage: the page's loading gate, masthead,
 * ledger line, and LOG THIS MEAL CTA render and are interactive without waiting on
 * it. No skeleton — the rail mounts silently and appears only once resolved with
 * ≥1 card.
 *
 * Reads restaurant-history?action=social_clippings, which calls TICKET-155's
 * block-aware predicate (self / circle / strangers), dedupes by canonical-video
 * key, caps at 12, and joins the durable clip_thumbs cache. callEdgeFn strips the
 * outer { data } envelope → the hook receives { rows }.
 */
import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { backfillOwnInstagramThumb } from '@/lib/clipThumbCapture';
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';
import type { ClippingCardData } from '@/components/restaurants/ClippingCard';

/**
 * [ARCH-REVIEW N6]: module-level attempted-set so a permanently-gone IG clip
 * isn't re-fetched on every rail refetch (survives refetches within the session).
 */
const igBackfillAttempted = new Set<string>();

export function useRestaurantClippings(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
) {
    const query = useQuery({
        queryKey: queryKeys.restaurants.clippings(restaurantId ?? ''),
        queryFn: () =>
            callEdgeFn<{ rows: ClippingCardData[] }>('restaurant-history', {
                action: 'social_clippings',
                body: { restaurant_id: restaurantId },
            }),
        enabled: !!restaurantId && !!userId,
        staleTime: 1000 * 60 * 5,
    });

    // TICKET-156 [ARCH-REVIEW N6]: opportunistic on-device IG backfill for the
    // viewer's OWN clip whose durable thumb is still missing (IG can't be fetched
    // server-side — instagramPerception doctrine). Deferred off the paint path via
    // InteractionManager; each dead clip is attempted exactly once per session.
    // (TanStack Query v5 removed useQuery.onSuccess — this useEffect is the v5 way.)
    const rows = query.data?.rows;
    useEffect(() => {
        if (!rows) return;
        for (const row of rows) {
            const url = row.source?.url;
            if (
                row.relationship === 'self' &&
                row.thumb_url === null &&
                !!url &&
                isInstagramSource(row.source as any) &&
                !igBackfillAttempted.has(url)
            ) {
                igBackfillAttempted.add(url);
                InteractionManager.runAfterInteractions(() => {
                    void backfillOwnInstagramThumb(url);
                });
            }
        }
    }, [rows]);

    return query;
}
