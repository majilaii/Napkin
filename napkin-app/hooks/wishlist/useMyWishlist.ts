/**
 * Infinite query hook: personal wishlist, paginated reverse-chronologically.
 * Cursor: before_created_at (ISO8601). Each page returns up to `limit` items.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

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
}

export interface PersonalWishlistItem {
    id: string;
    note: string | null;
    created_at: string;
    restaurant: WishlistRestaurant;
}

export interface PersonalWishlistPage {
    data: PersonalWishlistItem[];
    next_cursor: string | null;
}

const PAGE_LIMIT = 40;

async function fetchPersonalWishlist(
    before_created_at: string | null,
): Promise<PersonalWishlistPage> {
    const { data: { session } } = await supabase.auth.getSession();

    const body: Record<string, unknown> = {
        action: 'list_personal',
        limit: PAGE_LIMIT,
    };
    if (before_created_at) body.before_created_at = before_created_at;

    const { data, error } = await supabase.functions.invoke('wishlist', {
        body,
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return { data: data?.data ?? [], next_cursor: data?.next_cursor ?? null };
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
