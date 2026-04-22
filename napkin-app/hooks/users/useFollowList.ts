/**
 * useFollowList — followers or following of a target user.
 *
 * Backed by user-profile action=follow_list.
 * Gated server-side: requires palate access (self / public / shared tables).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'follow_list', kind, target_user_id: targetUserId, limit: 200 },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return (data?.data ?? []) as FollowListRow[];
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
