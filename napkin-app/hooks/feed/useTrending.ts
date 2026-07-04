/**
 * useTrending — trending wishlist rail (TICKET-098 Phase B).
 *
 * Global (not per-viewer) list of restaurants ranked by wishlist intent:
 * distinct savers, never ratings. The server computes on-read with a 1h cache
 * row; the client mirrors that TTL via staleTime so a session re-fetches at
 * most hourly. Rows may legitimately be [] — the rail hides entirely below 3
 * qualifying restaurants (the client double-gates in TrendingRail).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface TrendingCard {
    restaurant_id: string;
    name: string;
    cuisine: string | null;
    neighborhood: string | null;
    photo_url: string | null;
    /** Distinct savers in the last 7 days — "{n} saved this week". */
    saver_count_7d: number;
}

async function fetchTrending(): Promise<TrendingCard[]> {
    const data = await callEdgeFn<{ rows: TrendingCard[] }>('feed-trending', {
        method: 'GET',
    });
    return data?.rows ?? [];
}

export function useTrending(enabled: boolean = true) {
    return useQuery<TrendingCard[], Error>({
        queryKey: queryKeys.feed.trending(),
        queryFn: fetchTrending,
        enabled,
        staleTime: 1000 * 60 * 60,
    });
}
