/**
 * Infinite query hook: personal wishlist, paginated reverse-chronologically.
 * Cursor: before_created_at (ISO8601). Each page returns up to `limit` items.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistSource } from '@/lib/types/wishlistSource';

export interface WishlistRestaurant {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    photo_url: string | null;
    cuisine: string | null;
    google_rating: number | null;
    price_level: number | null;
    external_id: string | null;
    /** Optional: absent on payloads cached before the lat/lng edge change. */
    lat?: number | null;
    lng?: number | null;
}

export interface PersonalWishlistItem {
    id: string;
    note: string | null;
    created_at: string;
    /** Null for pending async captures (restaurant not yet resolved). */
    restaurant: WishlistRestaurant | null;
    /** TikTok / google_maps / web / screenshot / vision source data (TICKET-053/060). */
    source: WishlistSource | null;
    /** TICKET-060: async capture status from the linked import_jobs row. */
    extraction_status?: 'pending' | 'resolved' | 'needs_confirm' | 'failed' | null;
    job_id?: string | null;
}

export interface PersonalWishlistPage {
    data: PersonalWishlistItem[];
    next_cursor: string | null;
}

const PAGE_LIMIT = 40;

export async function fetchPersonalWishlist(
    before_created_at: string | null,
): Promise<PersonalWishlistPage> {
    const body: Record<string, unknown> = { limit: PAGE_LIMIT };
    if (before_created_at) body.before_created_at = before_created_at;

    // The cursor sits beside `data`, so preserve the full response envelope.
    // The default callEdgeFn behavior intentionally unwraps `data`, which would
    // otherwise turn this into a one-page query capped at PAGE_LIMIT rows.
    const raw = await callEdgeFn<
        { data?: PersonalWishlistItem[]; next_cursor?: string | null } | PersonalWishlistItem[]
    >('wishlist', { action: 'list_personal', body, unwrapData: false });
    if (Array.isArray(raw)) {
        return { data: raw, next_cursor: null };
    }
    return { data: raw?.data ?? [], next_cursor: raw?.next_cursor ?? null };
}

export function useMyWishlist(userId: string | null | undefined) {
    return useInfiniteQuery<PersonalWishlistPage, Error>({
        queryKey: queryKeys.wishlist.personal(userId ?? ''),
        queryFn: ({ pageParam }) =>
            fetchPersonalWishlist((pageParam as string | null) ?? null),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
