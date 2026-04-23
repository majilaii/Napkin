import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

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
    /** Belt-and-suspenders: optional, only present for viewer's own entries with prior visits */
    prior_visit?: { count: number; last_rating: number | null } | null;
}

export interface TrendingPoster {
    rank: number;
    restaurant: { id: string; name: string; photo_url: string | null };
    logger_count: number;
    average_rating: number | null;
}

export interface FeedPayload {
    entries: FeedEntry[];
    trending: TrendingPoster[];
    windowDays: number;
}

async function fetchFeed(): Promise<FeedPayload> {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
    const res = await fetch(`${supabaseUrl}/functions/v1/feed`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`feed failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data as FeedPayload;
}

export function useFeed(userId: string | undefined) {
    return useQuery<FeedPayload>({
        queryKey: userId ? queryKeys.feed.all(userId) : ['feed', 'anon'],
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
        queryFn: fetchFeed,
    });
}
