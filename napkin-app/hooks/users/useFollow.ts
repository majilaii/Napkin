/**
 * useFollow / useUnfollow — optimistic follow-graph mutations (TICKET-028).
 *
 * Mirrors useToggleReaction pattern:
 *   onMutate: cancel + snapshot, flip is_following in search cache + profile cache
 *   onError:  restore snapshots
 *   onSuccess: invalidate search family + profile + following list
 *
 * Edge function: user-profile action=follow | action=unfollow
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileResult } from './useUserProfile';
import type { UserSearchResult } from './useUserSearch';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function invokeFollow(targetUserId: string, action: 'follow' | 'unfollow') {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action, target_user_id: targetUserId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as { following: boolean };
}

// ── useFollow ─────────────────────────────────────────────────────────────────

export function useFollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ targetUserId }: { targetUserId: string }) =>
            invokeFollow(targetUserId, 'follow'),

        onMutate: async ({ targetUserId }) => {
            // Cancel in-flight queries that we're about to mutate
            await queryClient.cancelQueries({ queryKey: ['users', 'search'] });
            await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(targetUserId) });

            // Snapshot search cache (any active search query)
            const searchSnapshots: Array<{ key: readonly unknown[]; data: UserSearchResult[] }> = [];
            queryClient.getQueriesData<UserSearchResult[]>({ queryKey: ['users', 'search'] })
                .forEach(([key, data]) => {
                    if (data) searchSnapshots.push({ key, data });
                });

            // Flip is_following in all cached search result lists that contain this user
            for (const { key, data } of searchSnapshots) {
                queryClient.setQueryData<UserSearchResult[]>(key, (prev) =>
                    prev
                        ? prev.map((u) =>
                            u.user_id === targetUserId ? { ...u, is_following: true } : u
                          )
                        : prev
                );
            }

            // Snapshot profile cache and flip is_following_viewer
            const profileSnapshot = queryClient.getQueryData<UserProfileResult>(
                queryKeys.users.profile(targetUserId)
            );
            if (profileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(targetUserId),
                    (prev) =>
                        prev?.data
                            ? { ...prev, data: { ...prev.data, is_following_viewer: true } }
                            : prev
                );
            }

            return { searchSnapshots, profileSnapshot };
        },

        onError: (_err, { targetUserId }, context) => {
            // Restore search snapshots
            if (context?.searchSnapshots) {
                for (const { key, data } of context.searchSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
            // Restore profile snapshot
            if (context?.profileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(targetUserId),
                    context.profileSnapshot
                );
            }
        },

        onSuccess: (_data, _vars) => {
            // Invalidate search family (next search refetches with up-to-date is_following)
            queryClient.invalidateQueries({ queryKey: ['users', 'search'] });
            // Invalidate all profile caches (refreshes follower/following counts on
            // both sides + is_following_viewer on the target)
            queryClient.invalidateQueries({ queryKey: ['users', 'profile'] });
            // Invalidate following list (legacy hook — caller's following list)
            queryClient.invalidateQueries({ queryKey: ['users', 'following'] });
            // Invalidate any followers/following list screens currently mounted
            queryClient.invalidateQueries({ queryKey: ['users', 'followList'] });
        },
    });
}

// ── useUnfollow ───────────────────────────────────────────────────────────────

export function useUnfollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ targetUserId }: { targetUserId: string }) =>
            invokeFollow(targetUserId, 'unfollow'),

        onMutate: async ({ targetUserId }) => {
            await queryClient.cancelQueries({ queryKey: ['users', 'search'] });
            await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(targetUserId) });

            const searchSnapshots: Array<{ key: readonly unknown[]; data: UserSearchResult[] }> = [];
            queryClient.getQueriesData<UserSearchResult[]>({ queryKey: ['users', 'search'] })
                .forEach(([key, data]) => {
                    if (data) searchSnapshots.push({ key, data });
                });

            for (const { key, data } of searchSnapshots) {
                queryClient.setQueryData<UserSearchResult[]>(key, (prev) =>
                    prev
                        ? prev.map((u) =>
                            u.user_id === targetUserId ? { ...u, is_following: false } : u
                          )
                        : prev
                );
            }

            const profileSnapshot = queryClient.getQueryData<UserProfileResult>(
                queryKeys.users.profile(targetUserId)
            );
            if (profileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(targetUserId),
                    (prev) =>
                        prev?.data
                            ? { ...prev, data: { ...prev.data, is_following_viewer: false } }
                            : prev
                );
            }

            return { searchSnapshots, profileSnapshot };
        },

        onError: (_err, { targetUserId }, context) => {
            if (context?.searchSnapshots) {
                for (const { key, data } of context.searchSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
            if (context?.profileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(targetUserId),
                    context.profileSnapshot
                );
            }
        },

        onSuccess: (_data, _vars) => {
            queryClient.invalidateQueries({ queryKey: ['users', 'search'] });
            queryClient.invalidateQueries({ queryKey: ['users', 'profile'] });
            queryClient.invalidateQueries({ queryKey: ['users', 'following'] });
            queryClient.invalidateQueries({ queryKey: ['users', 'followList'] });
        },
    });
}
