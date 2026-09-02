/**
 * useUserSearch — debounced search for Napkin users by display_name.
 * Used by CompanionPickerSheet (TICKET-027), PeopleSearchPane (TICKET-028),
 * and AddMemberSheet (TICKET-029).
 *
 * Calls user-profile edge function action=search.
 * Returns up to 20 results, excluding the current user (enforced server-side).
 *
 * TICKET-029: When mutualOnly=true the hook passes mutual_only=true to the edge
 * function and every result row includes is_mutual: boolean.
 * The query key is distinct (includes 'mutual' suffix) so mutual/non-mutual
 * results don't collide in the cache.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

/** Result when mutualOnly is false (or omitted) */
export interface UserSearchResult {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    /** Present when returned from people-search (TICKET-028). Undefined for companion picker usage. */
    is_following?: boolean;
    /** Present only when request was made with mutualOnly=true (TICKET-029): target→caller. */
    follows_caller?: boolean;
    /** Present only when request was made with mutualOnly=true (TICKET-029). */
    is_mutual?: boolean;
}

interface SearchOptions {
    /** When true, restrict results to mutual follows and include is_mutual. */
    mutualOnly: boolean;
}

async function searchUsers(q: string, options: SearchOptions): Promise<UserSearchResult[]> {
    if (!q || q.trim().length === 0) return [];

    const body: Record<string, unknown> = {
        q: q.trim(),
        limit: 20,
    };
    if (options.mutualOnly) body.mutual_only = true;

    const data = await callEdgeFn<UserSearchResult[]>('user-profile', {
        action: 'search',
        body,
    });
    return (data ?? []) as UserSearchResult[];
}

/**
 * Search users by display_name.
 *
 * @param q         Search query.
 * @param enabled   Whether to run the query (default true). Pass false to suppress firing.
 * @param options   Search options. `mutualOnly` (required in options object) keeps caches distinct.
 */
export function useUserSearch(
    q: string,
    enabled = true,
    options: SearchOptions = { mutualOnly: false },
) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.search(q, { mutualOnly: options.mutualOnly }),
        queryFn: () => searchUsers(q, options),
        enabled: enabled && q.trim().length > 0,
        staleTime: 1000 * 30, // 30s — search results are reasonably fresh
        placeholderData: (prev) => prev,
    });
}
