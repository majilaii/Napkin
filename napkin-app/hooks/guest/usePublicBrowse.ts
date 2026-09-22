/**
 * usePublicBrowse: signed-out reads for guest mode (TICKET-247).
 *
 * Every hook here talks to the `public-browse` edge function, which never
 * calls auth.getUser and only returns allowlisted public columns. Nothing in
 * this file may import a signed-in hook or read viewer-scoped caches.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { flattenPages, useCursorPagedQuery, type Page } from '@/lib/pagination';
import type {
    PublicReviewCard,
    RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';

export type GuestRestaurantRow = {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    cuisine: string | null;
    price_level: number | null;
    photo_url: string | null;
    photo_source: 'user' | 'table' | 'places' | 'none' | null;
    places_photo_attribution_html: string | null;
    google_rating: number | null;
    google_rating_count: number | null;
    /** Public-eligible reviews only. */
    review_count: number;
};

export type GuestRestaurantPage = {
    restaurant: RestaurantPageRestaurant;
    /** Capped preview (≤3); the paged `reviews` action carries the rest. */
    reviews: PublicReviewCard[];
    reviews_total: number;
};

type RowsEnvelope = { rows: GuestRestaurantRow[] };

export const GUEST_SEARCH_MIN_CHARS = 2;
export const GUEST_SEARCH_MAX_CHARS = 80;

const FIVE_MINUTES = 1000 * 60 * 5;

export function useGuestSearch(q: string) {
    const trimmed = q.trim().slice(0, GUEST_SEARCH_MAX_CHARS);
    return useQuery({
        queryKey: queryKeys.guest.search(trimmed),
        queryFn: async () => {
            const res = await callEdgeFn<RowsEnvelope>('public-browse', {
                action: 'search',
                body: { q: trimmed },
            });
            return res?.rows ?? [];
        },
        enabled: trimmed.length >= GUEST_SEARCH_MIN_CHARS,
        staleTime: FIVE_MINUTES,
        placeholderData: keepPreviousData,
    });
}

export function useGuestRecent() {
    return useQuery({
        queryKey: queryKeys.guest.recent(),
        queryFn: async () => {
            const res = await callEdgeFn<RowsEnvelope>('public-browse', {
                action: 'recent',
                body: {},
            });
            return res?.rows ?? [];
        },
        staleTime: FIVE_MINUTES,
    });
}

export function useGuestRestaurantPage(restaurantId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.guest.page(restaurantId ?? ''),
        queryFn: () => callEdgeFn<GuestRestaurantPage>('public-browse', {
            action: 'page',
            body: { restaurant_id: restaurantId },
        }),
        enabled: !!restaurantId,
        staleTime: FIVE_MINUTES,
    });
}

async function fetchGuestReviewsPage(
    restaurantId: string,
    cursor: string | null,
): Promise<Page<PublicReviewCard>> {
    const body: Record<string, unknown> = { restaurant_id: restaurantId };
    if (cursor) body.cursor = cursor;
    return callEdgeFn<Page<PublicReviewCard>>('public-browse', {
        action: 'reviews',
        body,
    });
}

export function useGuestReviews(restaurantId: string | null | undefined) {
    return useCursorPagedQuery<PublicReviewCard>({
        queryKey: queryKeys.guest.reviews(restaurantId ?? ''),
        fetchPage: (cursor) => fetchGuestReviewsPage(restaurantId!, cursor),
        enabled: !!restaurantId,
        staleTime: FIVE_MINUTES,
    });
}

export { flattenPages };
