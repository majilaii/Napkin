/**
 * useFollowList — followers or following of a target user.
 *
 * Backed by user-profile action=follow_list.
 * Gated server-side: requires palate access (self / public / shared tables).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export type FollowListKind = 'followers' | 'following';

export interface FollowListRow {
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    is_following: boolean;
}

async function fetchFollowList(
    targetUserId: string,
    kind: FollowListKind,
): Promise<FollowListRow[]> {
    const data = await callEdgeFn<FollowListRow[]>('user-profile', {
        action: 'follow_list',
        body: { kind, target_user_id: targetUserId, limit: 200 },
    });
    return (data ?? []) as FollowListRow[];
}

export function useFollowList(
    targetUserId: string | null | undefined,
    kind: FollowListKind,
) {
    return useQuery<FollowListRow[]>({
        queryKey: queryKeys.users.followList(targetUserId ?? '', kind),
        queryFn: () => fetchFollowList(targetUserId!, kind),
        enabled: !!targetUserId,
        staleTime: 1000 * 60 * 2,
    });
}
