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
import type { RestaurantFeaturedListsData } from '@/hooks/restaurants/useRestaurantFeaturedLists';
import type { ListDetailData } from '@/hooks/lists/useList';

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
    /**
     * Public lists (of public accounts, never Table lists) that contain this
     * restaurant. Optional: absent from a page cached before the list read shipped.
     */
    featured_lists?: RestaurantFeaturedListsData;
};

/** A public list read by a guest: the signed-in ListDetailData shape, save state off. */
export type GuestListResult = { data: ListDetailData | null; isNotFound: boolean };

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

async function fetchGuestList(listId: string): Promise<GuestListResult> {
    try {
        const data = await callEdgeFn<ListDetailData | null>('public-browse', {
            action: 'list',
            body: { list_id: listId },
        });
        return { data: data ?? null, isNotFound: !data };
    } catch (err) {
        // A 404 covers private, Table and missing lists alike, by design.
        const cause = (err as Error & { cause?: { status?: number; code?: string } })?.cause;
        if (cause?.status === 404 || cause?.code === 'NOT_FOUND') {
            return { data: null, isNotFound: true };
        }
        throw err;
    }
}

export function useGuestList(listId: string | null | undefined) {
    return useQuery<GuestListResult, Error>({
        queryKey: queryKeys.guest.list(listId ?? ''),
        queryFn: () => fetchGuestList(listId!),
        enabled: !!listId,
        staleTime: FIVE_MINUTES,
    });
}
