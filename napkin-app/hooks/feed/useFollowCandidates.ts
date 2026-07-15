/**
 * useFollowCandidates — the people-to-follow v2 mixed rail read (TICKET-189).
 *
 * user-profile action=follow_candidates: co-diners FIRST (Ring 1), then
 * recently-active public authors (the honest second source — public accounts
 * with ≥1 publicly-eligible log in 30d), deduplicated server-side (the
 * co-diner id set is excluded inside the public-authors RPC before its
 * LIMIT), capped at 8.
 *
 * Cache lifecycle: useFollow OWNS the candidate-cache patches (optimistic
 * removal on follow, rollback on error) — this hook is a plain read; the
 * block renders whatever the cache holds and the arbiter drops the whole
 * block when the last candidate goes.
 *
 * Flag-gated: FOR_YOU_PEOPLE_V2 off → enabled:false (the co-diner-only path
 * stays on useCoDiners, unchanged).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { FOR_YOU_PEOPLE_V2 } from '@/constants/flags';

export interface FollowCandidate {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    kind: 'co_diner' | 'public';
    /** co_diner only — distinct meal-events shared with the viewer. */
    meals_together?: number;
    /** public only — publicly-eligible logs in the last 30 days. */
    logs_30d?: number;
}

async function fetchFollowCandidates(): Promise<FollowCandidate[]> {
    // callEdgeFn unwraps { data: [...] } to the array.
    const data = await callEdgeFn<FollowCandidate[]>('user-profile', {
        action: 'follow_candidates',
    });
    return Array.isArray(data) ? data : [];
}

export function useFollowCandidates(userId: string | null | undefined) {
    return useQuery<FollowCandidate[], Error>({
        queryKey: queryKeys.feed.followCandidates(userId ?? ''),
        queryFn: fetchFollowCandidates,
        enabled: !!userId && FOR_YOU_PEOPLE_V2,
        staleTime: 1000 * 60 * 5,
    });
}
