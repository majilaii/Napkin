/**
 * useUserTaste — the taste drill-in payload (TICKET-112).
 *
 * Overall avg + rated entry count, top/bottom cuisines, histogram, and the
 * legacy per-category payload. Self reads include the full journal; permitted
 * public-profile reads aggregate public entries only. The current /taste screen
 * deliberately does not turn flavor/service/value/vibe into a personality-style
 * summary.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface CategoryStat {
    avg: number | null;
    n: number;
}

export interface CuisineStat {
    cuisine: string;
    avg: number;
    n: number;
}

/** One half-star histogram bucket — r is the snapped rating (0.5 … 5.0). */
export interface HistogramBucket {
    r: number;
    n: number;
}

export interface TasteData {
    /** Rated entries (rating not null). Client treats 0 as empty state. */
    entry_count: number;
    overall_avg: number | null;
    categories: {
        flavor: CategoryStat;
        service: CategoryStat;
        value: CategoryStat;
        vibe: CategoryStat;
    };
    top_cuisines: CuisineStat[];    // n>=2, junk venue types excluded, desc, max 3
    bottom_cuisines: CuisineStat[]; // n>=2, disjoint from top, asc, max 3
    /** Sparse half-star buckets (TICKET-150). Absent on stale caches — guard `?? []`. */
    rating_histogram?: HistogramBucket[];
}

async function fetchUserTaste(identifier: string): Promise<TasteData> {
    const data = await callEdgeFn<TasteData>('user-profile', {
        action: 'taste',
        body: { identifier },
    });
    return data;
}

export function useUserTaste(identifier: string | null | undefined) {
    return useQuery<TasteData, Error>({
        queryKey: queryKeys.users.taste(identifier ?? ''),
        queryFn: () => fetchUserTaste(identifier!),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}
