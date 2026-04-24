/**
 * useFeed — cursor-paginated cross-Table chronological feed.
 * TICKET-035: converted from single useQuery to useCursorPagedQuery.
 *
 * Trending rail is only in pages[0].trending; pages 1+ return null.
 * Consumers read trending from `data?.pages?.[0]?.trending ?? []`.
 *
 * Wire shape (per page):
 *   { rows, next_cursor, has_more, trending, window_days }
 */
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';

export interface FeedEntry {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    visited_at: string | null;
    created_at: string;
    sort_date: string;
    photos: string[];
    photo_count: number;
    reaction_count: number;
    comment_count: number;
    top_emojis: string[];
    my_reactions: string[];
    restaurant: { id: string; name: string; photo_url: string | null } | null;
    author: { display_name: string; avatar_url: string | null };
    /** Only present for viewer's own entries with prior visits */
    prior_visit?: { count: number; last_rating: number | null } | null;
}

export interface TrendingPoster {
    rank: number;
    restaurant: { id: string; name: string; photo_url: string | null };
    logger_count: number;
    average_rating: number | null;
}

/**
 * Wire shape of a single feed page from the server.
 * `trending` is populated only on page 0 (null on subsequent pages).
 */
export type FeedPage = Page<FeedEntry> & {
    trending: TrendingPoster[] | null;
    window_days: number;
};

/**
 * Legacy flat aggregate — built by consumers from pages[0].
 * windowDays comes from pages[0].window_days.
 */
export interface FeedPayload {
    entries: FeedEntry[];
    trending: TrendingPoster[];
    windowDays: number;
}


async function fetchFeedPage(
    cursor: string | null,
    token: string | null,
): Promise<FeedPage> {
    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
    const res = await fetch(`${supabaseUrl}/functions/v1/feed`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token ?? ''}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`feed failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data as FeedPage;
}

export function useFeed(userId: string | undefined) {
    return useCursorPagedQuery<FeedEntry>({
        queryKey: userId ? queryKeys.feed.all(userId) : ['feed', 'anon'],
        fetchPage: fetchFeedPage,
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages of entries. */
export function flattenFeed(data: ReturnType<typeof useFeed>['data']): FeedEntry[] {
    return flattenPages(data);
}
