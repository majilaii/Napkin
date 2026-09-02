/**
 * useFollow / useUnfollow — optimistic follow-graph mutations (TICKET-028;
 * candidate caches TICKET-189).
 *
 * Mirrors useToggleReaction pattern:
 *   onMutate: cancel + snapshot, flip is_following in search + profile caches,
 *             increment/decrement followers_count on the target's profile and
 *             following_count on the viewer's profile (TICKET-036 P1-8).
 *             TICKET-189: also snapshot + optimistically REMOVE the target
 *             from the For You candidate caches (feed.followCandidates +
 *             feed.coDiners) — the removal is optimistic, per the canonical
 *             mutations.md lifecycle (Codex P2: "remove on success + rollback"
 *             is contradictory). Centralizing here keeps the candidate caches
 *             warm-correct no matter which FollowButton consumer fires.
 *   onError:  restore the profile/search snapshots. Candidate caches use a
 *             target-scoped inverse patch so one failed follow cannot undo a
 *             different target's concurrent successful removal.
 *   onSuccess: narrow reconciliation only — follow-list pages + the target's
 *              single-id profile + feed.friends(viewerId) (the newly-followed
 *              author's reviews belong in Following now). The candidate
 *              patches stand; no blanket invalidation.
 *
 * Edge function: user-profile action=follow | action=unfollow
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { FollowCandidate } from '@/hooks/feed/useFollowCandidates';
import type { CoDinerCandidate } from '@/hooks/feed/useCoDiners';
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

interface CandidateRemoval<T> {
    candidate: T;
    index: number;
}

function captureCandidateRemoval<T extends { user_id: string }>(
    candidates: T[] | undefined,
    targetUserId: string,
): CandidateRemoval<T> | undefined {
    const index = candidates?.findIndex((candidate) => candidate.user_id === targetUserId) ?? -1;
    if (!candidates || index < 0) return undefined;
    return { candidate: candidates[index], index };
}

function reinsertCandidate<T extends { user_id: string }>(
    candidates: T[] | undefined,
    removal: CandidateRemoval<T>,
): T[] | undefined {
    if (!candidates) return [removal.candidate];
    if (candidates.some((candidate) => candidate.user_id === removal.candidate.user_id)) {
        return candidates;
    }
    const next = [...candidates];
    next.splice(Math.min(removal.index, next.length), 0, removal.candidate);
    return next;
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

            // TICKET-189: For You candidate caches — cancel, capture the
            // target row, and optimistically remove it from BOTH (the
            // v2 mixed rail AND the co-diner rail; whichever is live). The
            // arbiter then drops the whole people block when the last
            // candidate goes — no orphan header/separator.
            let followCandidatesRemoval: CandidateRemoval<FollowCandidate> | undefined;
            let coDinersRemoval: CandidateRemoval<CoDinerCandidate> | undefined;
            if (viewerId) {
                await queryClient.cancelQueries({
                    queryKey: queryKeys.feed.followCandidates(viewerId),
                });
                await queryClient.cancelQueries({ queryKey: queryKeys.feed.coDiners(viewerId) });

                followCandidatesRemoval = captureCandidateRemoval(
                    queryClient.getQueryData<FollowCandidate[]>(
                        queryKeys.feed.followCandidates(viewerId),
                    ),
                    targetUserId,
                );
                if (followCandidatesRemoval) {
                    queryClient.setQueryData<FollowCandidate[]>(
                        queryKeys.feed.followCandidates(viewerId),
                        (prev) => prev?.filter((c) => c.user_id !== targetUserId),
                    );
                }

                coDinersRemoval = captureCandidateRemoval(
                    queryClient.getQueryData<CoDinerCandidate[]>(
                        queryKeys.feed.coDiners(viewerId),
                    ),
                    targetUserId,
                );
                if (coDinersRemoval) {
                    queryClient.setQueryData<CoDinerCandidate[]>(
                        queryKeys.feed.coDiners(viewerId),
                        (prev) => prev?.filter((c) => c.user_id !== targetUserId),
                    );
                }
            }

            return {
                searchSnapshots,
                targetProfileSnapshot,
                viewerProfileSnapshot,
                followCandidatesRemoval,
                coDinersRemoval,
            };
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
            // TICKET-189: target-scoped inverse patches. Never restore a whole
            // array: another target may have completed successfully meanwhile.
            const followCandidatesRemoval = context?.followCandidatesRemoval;
            if (viewerId && followCandidatesRemoval) {
                queryClient.setQueryData<FollowCandidate[]>(
                    queryKeys.feed.followCandidates(viewerId),
                    (prev) => reinsertCandidate(prev, followCandidatesRemoval),
                );
            }
            const coDinersRemoval = context?.coDinersRemoval;
            if (viewerId && coDinersRemoval) {
                queryClient.setQueryData<CoDinerCandidate[]>(
                    queryKeys.feed.coDiners(viewerId),
                    (prev) => reinsertCandidate(prev, coDinersRemoval),
                );
            }
        },

        onSuccess: (_data, { targetUserId }) => {
            // P1-8: cache is already correct from the optimistic patch (search +
            // both profiles + counts + candidate removals). Refetch only the
            // follow-list pages, since those carry server-side ordering /
            // cursors we can't reproduce client-side. Never invalidate the
            // ['users', 'profile'] PREFIX — that nukes every cached profile
            // across the session.
            //
            // Narrow exception (Scope B): re-fetch ONLY the target's own profile
            // by its single-id key. The optimistic patch flips is_following_viewer
            // and bumps followers_count, but it can't synthesize follows_viewer
            // (target→caller) — a private tablemate's real followers_count/social
            // counts only come from the server. Single id, never the prefix.
            queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(targetUserId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followingAll() });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.followListAll() });
            queryClient.invalidateQueries({ queryKey: queryKeys.users.searchAll() });
            // TICKET-189: the newly-followed author's reviews belong in
            // Following now — narrow, viewer-scoped refetch. The candidate
            // patches above stand (no blanket invalidation).
            if (viewerId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.feed.friends(viewerId) });
                queryClient.invalidateQueries({
                    queryKey: queryKeys.users.recentCompanions(viewerId),
                });
            }
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
            queryClient.invalidateQueries({ queryKey: queryKeys.users.searchAll() });
            if (viewerId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.users.recentCompanions(viewerId),
                });
            }
        },
    });
}
