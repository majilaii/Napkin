/**
 * useTrending — the two-mode feed rail (TICKET-098 Phase B + TICKET-102).
 *
 * Mode 1 (trending): global list ranked by wishlist intent (distinct savers,
 * never ratings). Rows may legitimately be [] — the rail hides below 3
 * qualifying restaurants.
 *
 * Mode 2 (fallback, TICKET-102): when mode 1 is below the floor, the rail
 * switches SOURCE (not lowers the bar) to restaurants already persisted, ranked
 * by their stored Google rating. Wholly non-user-derived. Both payloads arrive
 * in one round-trip (`{ rows, fallback }` inside `data`) so the client can flip
 * to the fallback on cold start without a second call; `pickRailMode` chooses.
 *
 * Same `queryKeys.feed.trending()` key + 1h staleTime (mirrors the server cache).
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

/** TICKET-102 mode-2 card — Google-rated fallback, no user-derived data. */
export interface FallbackCard {
    restaurant_id: string;
    name: string;
    cuisine: string | null;
    neighborhood: string | null;
    photo_url: string | null;
    /** Stored Google rating — a labeled SIBLING signal, never a Napkin number. */
    google_rating: number;
    google_rating_count: number;
}

export interface TrendingResult {
    rows: TrendingCard[];
    fallback: FallbackCard[];
}

async function fetchTrending(): Promise<TrendingResult> {
    const data = await callEdgeFn<{ rows: TrendingCard[]; fallback: FallbackCard[] }>(
        'feed-trending',
        { method: 'GET' },
    );
    return {
        rows: data?.rows ?? [],
        fallback: data?.fallback ?? [],
    };
}

export function useTrending(enabled: boolean = true) {
    return useQuery<TrendingResult, Error>({
        queryKey: queryKeys.feed.trending(),
        queryFn: fetchTrending,
        enabled,
        staleTime: 1000 * 60 * 60,
    });
}
