/**
 * useFollowingList — list of users the current caller follows.
 * TICKET-028
 *
 * Used by PeopleSearchPane empty state (suggested people).
 * Calls user-profile action=following_list. Cap 50.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserSearchResult } from './useUserSearch';

async function fetchFollowingList(): Promise<UserSearchResult[]> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'following_list', limit: 50 },
        headers: session.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return (data?.data ?? []) as UserSearchResult[];
}

export function useFollowingList(userId?: string | null) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.following(userId ?? ''),
        queryFn: fetchFollowingList,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
