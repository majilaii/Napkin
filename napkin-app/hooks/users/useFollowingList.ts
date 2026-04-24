/**
 * useFollowingList — list of users the current caller follows.
 * TICKET-028
 *
 * Used by PeopleSearchPane empty state (suggested people).
 * Calls user-profile action=following_list. Cap 50.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserSearchResult } from './useUserSearch';

async function fetchFollowingList(): Promise<UserSearchResult[]> {
    // We still need supabase here to early-return when there's no session,
    // avoiding a needless edge call. callEdgeFn would auto-attach "" and 401.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];
    const data = await callEdgeFn<UserSearchResult[]>('user-profile', {
        action: 'following_list',
        body: { limit: 50 },
    });
    return (data ?? []) as UserSearchResult[];
}

export function useFollowingList(userId?: string | null) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.following(userId ?? ''),
        queryFn: fetchFollowingList,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
