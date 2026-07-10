/**
 * useUpdateReplyPermission — mutation for allow_public_replies.
 *
 * Column ships in TICKET-020; enforcement is in TICKET-021.
 *
 * Follows the canonical optimistic lifecycle (lib/mutations.md), mirroring
 * useUpdateProfile: onMutate snapshots + patches BOTH cache identities (the
 * uuid-keyed profile and the username-keyed "second reality"), onError rolls
 * back, onSuccess reconciles with the authoritative server row — no blanket
 * invalidate racing the patch.
 *
 * History (TICKET-158 review finding): the old onSuccess spread the flat
 * profile row into `old.data` — one level ABOVE where useUserProfile actually
 * nests it (`old.data.profile`) — so the "optimistic" write landed at a depth
 * nobody reads and the REPLIES chips only flipped after the refetch. The
 * shared patchProfile helper owns the write depth now.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow, UserProfileResult } from './useUserProfile';
import { patchProfile } from './useUpdateProfile';

type MutationContext = {
    /** Snapshot of the uuid-keyed entry (`users.profile(userId)`). */
    previous?: UserProfileResult;
    /** Snapshot of the username-keyed entry, when one exists. */
    previousByUsername?: UserProfileResult;
    /** Username the profile was cached under — the second-reality key. */
    username?: string | null;
};

async function updateReplyPermission(allow_public_replies: boolean): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_reply_permission',
        body: { allow_public_replies },
    });
}

export function useUpdateReplyPermission(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<UserProfileRow, Error, boolean, MutationContext>({
        mutationFn: updateReplyPermission,
        onMutate: async (allow_public_replies) => {
            if (!userId) return {};
            const key = queryKeys.users.profile(userId);
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<UserProfileResult>(key);

            const username = previous?.data?.profile?.username ?? null;
            let previousByUsername: UserProfileResult | undefined;
            if (username && username !== userId) {
                const usernameKey = queryKeys.users.profile(username);
                await qc.cancelQueries({ queryKey: usernameKey });
                previousByUsername = qc.getQueryData<UserProfileResult>(usernameKey);
                qc.setQueryData<UserProfileResult>(usernameKey, (old) =>
                    patchProfile(old, { allow_public_replies }),
                );
            }

            qc.setQueryData<UserProfileResult>(key, (old) =>
                patchProfile(old, { allow_public_replies }),
            );
            return { previous, previousByUsername, username };
        },
        onError: (_err, _input, ctx) => {
            if (!userId) return;
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKeys.users.profile(userId), ctx.previous);
            }
            if (ctx?.username && ctx.username !== userId && ctx.previousByUsername !== undefined) {
                qc.setQueryData(queryKeys.users.profile(ctx.username), ctx.previousByUsername);
            }
        },
        onSuccess: (row, _input, ctx) => {
            if (!userId) return;
            const key = queryKeys.users.profile(userId);
            // Reconcile with the authoritative server row; targeted refetch only
            // when there was nothing cached to patch.
            const current = qc.getQueryData<UserProfileResult>(key);
            if (current?.data?.profile) {
                qc.setQueryData<UserProfileResult>(key, (old) => patchProfile(old, row));
            } else {
                qc.invalidateQueries({ queryKey: key });
            }

            const uname = ctx?.username;
            if (uname && uname !== userId) {
                const usernameKey = queryKeys.users.profile(uname);
                if (qc.getQueryData<UserProfileResult>(usernameKey)?.data?.profile) {
                    qc.setQueryData<UserProfileResult>(usernameKey, (old) =>
                        patchProfile(old, row),
                    );
                }
            }
        },
    });
}
