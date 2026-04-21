/**
 * useUserSearch — debounced search for Napkin users by display_name.
 * Used by CompanionPickerSheet (TICKET-027).
 *
 * Calls user-profile edge function action=search.
 * Returns up to 20 results, excluding the current user (enforced server-side).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface UserSearchResult {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
}

async function searchUsers(q: string): Promise<UserSearchResult[]> {
    if (!q || q.trim().length === 0) return [];

    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'search', q: q.trim(), limit: 20 },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return (data?.data ?? []) as UserSearchResult[];
}

export function useUserSearch(q: string, enabled = true) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.search(q),
        queryFn: () => searchUsers(q),
        enabled: enabled && q.trim().length > 0,
        staleTime: 1000 * 30, // 30s — search results are reasonably fresh
        placeholderData: (prev) => prev,
    });
}
