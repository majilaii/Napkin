/**
 * useFollow / useUnfollow — optimistic follow-graph mutations (TICKET-028).
 *
 * Mirrors useToggleReaction pattern:
 *   onMutate: cancel + snapshot, flip is_following in search + profile caches,
 *             increment/decrement followers_count on the target's profile and
 *             following_count on the viewer's profile (TICKET-036 P1-8).
 *   onError:  restore snapshots
 *   onSuccess: narrow refetch of follow-list pages only — every other surface
 *              (search, both profiles) is already correct from the optimistic
 *              patch and shouldn't trigger a refetch.
 *
 * Edge function: user-profile action=follow | action=unfollow
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { UserProfileResult } from './useUserProfile';
import type { UserSearchResult } from './useUserSearch';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invokeFollow(targetUserId: string, action: 'follow' | 'unfollow') {
    return callEdgeFn<{ following: boolean }>('user-profile', {
        action,
        body: { target_user_id: targetUserId },
    });
}

/**
 * Patch a UserProfileResult: flip is_following_viewer and bump
 * followers_count by `delta`. Used on the target's cached profile.
 */
function patchTargetProfile(
    prev: UserProfileResult | undefined,
    isFollowing: boolean,
    delta: 1 | -1,
): UserProfileResult | undefined {
    if (!prev?.data) return prev;
    return {
        ...prev,
        data: {
            ...prev.data,
            is_following_viewer: isFollowing,
            stats: prev.data.stats
                ? {
                      ...prev.data.stats,
                      followers_count: Math.max(0, prev.data.stats.followers_count + delta),
                  }
                : prev.data.stats,
        },
    };
}

/**
 * Patch the viewer's own UserProfileResult: bump following_count
 * by `delta`. Followers/is_following_viewer stay untouched.
 */
function patchViewerProfile(
    prev: UserProfileResult | undefined,
    delta: 1 | -1,
): UserProfileResult | undefined {
    if (!prev?.data) return prev;
    return {
        ...prev,
        data: {
            ...prev.data,
            stats: prev.data.stats
                ? {
                      ...prev.data.stats,
                      following_count: Math.max(0, prev.data.stats.following_count + delta),
                  }
                : prev.data.stats,
        },
    };
}

// ── useFollow ─────────────────────────────────────────────────────────────────

export function useFollow() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    return useMutation({
        mutationFn: ({ targetUserId }: { targetUserId: string }) =>
            invokeFollow(targetUserId, 'follow'),

        onMutate: async ({ targetUserId }) => {
            // Cancel in-flight queries that we're about to mutate
            await queryClient.cancelQueries({ queryKey: queryKeys.users.searchAll() });
            await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(targetUserId) });
            if (viewerId) {
                await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(viewerId) });
            }

            // Snapshot search cache (any active search query)
            const searchSnapshots: Array<{ key: readonly unknown[]; data: UserSearchResult[] }> = [];
            queryClient.getQueriesData<UserSearchResult[]>({ queryKey: queryKeys.users.searchAll() })
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

            // Snapshot + patch target profile (flip follow + bump followers_count)
            const targetProfileSnapshot = queryClient.getQueryData<UserProfileResult>(
                queryKeys.users.profile(targetUserId)
            );
            if (targetProfileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(targetUserId),
                    (prev) => patchTargetProfile(prev, true, +1),
                );
            }

            // Snapshot + patch viewer profile (bump following_count)
            const viewerProfileSnapshot = viewerId
                ? queryClient.getQueryData<UserProfileResult>(queryKeys.users.profile(viewerId))
                : undefined;
            if (viewerId && viewerProfileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(viewerId),
                    (prev) => patchViewerProfile(prev, +1),
                );
            }

            return { searchSnapshots, targetProfileSnapshot, viewerProfileSnapshot };
        },

        onError: (_err, { targetUserId }, context) => {
            // Restore search snapshots
            if (context?.searchSnapshots) {
                for (const { key, data } of context.searchSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
            // Restore target profile snapshot
            if (context?.targetProfileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(targetUserId),
                    context.targetProfileSnapshot
                );
            }
            // Restore viewer profile snapshot
            if (viewerId && context?.viewerProfileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(viewerId),
                    context.viewerProfileSnapshot
                );
            }
        },

        onSuccess: (_data, { targetUserId }) => {
            // P1-8: cache is already correct from the optimistic patch (search +
            // both profiles + counts). Refetch only the follow-list pages, since
            // those carry server-side ordering / cursors we can't reproduce
            // client-side. Never invalidate the ['users', 'profile'] PREFIX —
            // that nukes every cached profile across the session.
            //
            // Narrow exception (Scope B): re-fetch ONLY the target's own profile
            // by its single-id key. The optimistic patch flips is_following_viewer
            // and bumps followers_count, but it can't synthesize follows_viewer
            // (target→caller) — a private tablemate's real followers_count/social
            // counts only come from the server. Single id, never the prefix.
            queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(targetUserId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followingAll() });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followListAll() });
        },
    });
}

// ── useUnfollow ───────────────────────────────────────────────────────────────

export function useUnfollow() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    return useMutation({
        mutationFn: ({ targetUserId }: { targetUserId: string }) =>
            invokeFollow(targetUserId, 'unfollow'),

        onMutate: async ({ targetUserId }) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.users.searchAll() });
            await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(targetUserId) });
            if (viewerId) {
                await queryClient.cancelQueries({ queryKey: queryKeys.users.profile(viewerId) });
            }

            const searchSnapshots: Array<{ key: readonly unknown[]; data: UserSearchResult[] }> = [];
            queryClient.getQueriesData<UserSearchResult[]>({ queryKey: queryKeys.users.searchAll() })
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

            const targetProfileSnapshot = queryClient.getQueryData<UserProfileResult>(
                queryKeys.users.profile(targetUserId)
            );
            if (targetProfileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(targetUserId),
                    (prev) => patchTargetProfile(prev, false, -1),
                );
            }

            const viewerProfileSnapshot = viewerId
                ? queryClient.getQueryData<UserProfileResult>(queryKeys.users.profile(viewerId))
                : undefined;
            if (viewerId && viewerProfileSnapshot?.data) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(viewerId),
                    (prev) => patchViewerProfile(prev, -1),
                );
            }

            return { searchSnapshots, targetProfileSnapshot, viewerProfileSnapshot };
        },

        onError: (_err, { targetUserId }, context) => {
            if (context?.searchSnapshots) {
                for (const { key, data } of context.searchSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
            if (context?.targetProfileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(targetUserId),
                    context.targetProfileSnapshot
                );
            }
            if (viewerId && context?.viewerProfileSnapshot) {
                queryClient.setQueryData(
                    queryKeys.users.profile(viewerId),
                    context.viewerProfileSnapshot
                );
            }
        },

        onSuccess: (_data, { targetUserId }) => {
            // P1-8: same scoping as useFollow.onSuccess — narrow follow-list
            // refetch plus a single-id re-fetch of the target's profile so
            // follows_viewer + real social counts reconcile. Never the
            // ['users', 'profile'] prefix.
            queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(targetUserId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followingAll() });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followListAll() });
        },
    });
}
