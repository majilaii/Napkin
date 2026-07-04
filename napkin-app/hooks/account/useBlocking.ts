/**
 * Blocking hooks (TICKET-090, guideline 1.2).
 *
 * Block/unblock a user + the caller's blocked list. Enforcement is server-side
 * (user-profile / post-interactions / feed filter on blocked_users); these
 * hooks mutate the edge state and refresh the affected caches narrowly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface BlockedUserRow {
    user_id: string;
    created_at: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
}

export function useBlockedUsers(enabled = true) {
    return useQuery({
        queryKey: queryKeys.account.blocked(),
        queryFn: async () => {
            const data = await callEdgeFn<{ rows: BlockedUserRow[] }>('account', {
                action: 'blocked_list',
                body: {},
            });
            return data.rows;
        },
        enabled,
        staleTime: 1000 * 60 * 5,
    });
}

/** Shared cache fallout of a block/unblock — the target's profile surfaces and
 * the aggregate feed re-read against the new blocked_users state. */
function invalidateBlockFallout(queryClient: ReturnType<typeof useQueryClient>, targetId: string) {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(targetId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.diary(targetId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.spots(targetId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.reviews(targetId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.feed.rootAll() });
}

export function useBlockUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (targetUserId: string) => {
            await callEdgeFn('account', { action: 'block', body: { user_id: targetUserId } });
            return targetUserId;
        },
        onSuccess: (targetUserId) => {
            invalidateBlockFallout(queryClient, targetUserId);
            queryClient.invalidateQueries({ queryKey: queryKeys.account.blocked() });
        },
    });
}

export function useUnblockUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (targetUserId: string) => {
            await callEdgeFn('account', { action: 'unblock', body: { user_id: targetUserId } });
            return targetUserId;
        },
        onMutate: async (targetUserId: string) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.account.blocked() });
            const previous = queryClient.getQueryData<BlockedUserRow[]>(queryKeys.account.blocked());
            queryClient.setQueryData<BlockedUserRow[]>(
                queryKeys.account.blocked(),
                (old) => (old ?? []).filter((row) => row.user_id !== targetUserId),
            );
            return { previous };
        },
        onError: (_err, _targetUserId, ctx) => {
            if (ctx?.previous !== undefined) {
                queryClient.setQueryData(queryKeys.account.blocked(), ctx.previous);
            }
        },
        onSuccess: (targetUserId) => {
            invalidateBlockFallout(queryClient, targetUserId);
        },
    });
}
