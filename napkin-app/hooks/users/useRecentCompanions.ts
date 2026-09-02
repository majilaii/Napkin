/**
 * useRecentCompanions — top-5 companions the caller has tagged most often.
 *
 * The user-profile action ranks historical tags, then filters against the
 * current mutual-follow and block graph before returning up to five profiles.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserSearchResult } from './useUserSearch';

async function fetchRecentCompanions(): Promise<UserSearchResult[]> {
    return callEdgeFn<UserSearchResult[]>('user-profile', {
        action: 'recent_companions',
        body: {},
    });
}

export function useRecentCompanions(userId?: string | null) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.recentCompanions(userId ?? ''),
        queryFn: fetchRecentCompanions,
        enabled: !!userId,
        staleTime: 1000 * 60 * 10, // 10 min — recent companions don't change quickly
    });
}
