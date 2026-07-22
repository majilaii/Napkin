/**
 * useUpdateProfile — mutation for display_name, bio, avatar_url, and home_city.
 *
 * Partial payload: only include fields that changed.
 *
 * Optimistic (TICKET / CLAUDE.md mutation doctrine): the change is patched into
 * the caller's cached profile in `onMutate` so every surface reading
 * `users.profile(userId)` — the settings list, the /settings/photo circle, and
 * the profile tab header — flips instantly, with no wait on the upload → save →
 * invalidate → refetch chain (that lag was why a fresh avatar "stayed at J").
 * `onError` rolls back; `onSuccess` reconciles with the authoritative server row
 * (no blanket invalidate — see lib/mutations.md).
 *
 * Two cache identities: useUserProfile keys by IDENTIFIER, so the SAME profile
 * viewed via /u/<username> lives under `users.profile(<username>)` — a second
 * entry the uuid-keyed patch never touched, leaving a stale avatar/name/bio on
 * that "second reality." We read the username off the uuid-keyed cached profile
 * and snapshot / patch / roll back / reconcile that entry in lockstep. (username
 * is not a payload field — see UpdateProfilePayload — so the key we patch can't
 * go stale under us; if it ever becomes editable, the OLD-username key must be
 * handled here too.)
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow, UserProfileResult } from './useUserProfile';

type UpdateProfilePayload = {
    display_name?: string;
    bio?: string | null;
    avatar_url?: string | null;
    home_city?: string | null;
};

type MutationContext = {
    /** Snapshot of the uuid-keyed entry (`users.profile(userId)`). */
    previous?: UserProfileResult;
    /** Snapshot of the username-keyed entry (`users.profile(username)`), when one exists. */
    previousByUsername?: UserProfileResult;
    /** Username the profile was cached under — the second-reality key to roll back / reconcile. */
    username?: string | null;
};

async function updateProfile(payload: UpdateProfilePayload): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_profile',
        body: payload,
    });
}

/** Merge a partial patch into a cached profile result, preserving everything else.
 * Shared with useUpdateReplyPermission — the write depth (data.profile) is the
 * part that's easy to get wrong (TICKET-158 review finding). */
export function patchProfile(
    prev: UserProfileResult | undefined,
    patch: Partial<UserProfileRow>,
): UserProfileResult | undefined {
    if (!prev?.data?.profile) return prev;
    return {
        ...prev,
        data: {
            ...prev.data,
            profile: { ...prev.data.profile, ...patch },
        },
    };
}

export function useUpdateProfile(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<UserProfileRow, Error, UpdateProfilePayload, MutationContext>({
        mutationFn: updateProfile,
        onMutate: async (payload) => {
            if (!userId) return {};
            const key = queryKeys.users.profile(userId);
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<UserProfileResult>(key);

            // Mirror the patch onto the username-keyed "second reality" (the same
            // profile fetched via /u/<username>). Read the username off the
            // uuid-keyed snapshot; only touch a distinct key.
            const username = previous?.data?.profile?.username ?? null;
            let previousByUsername: UserProfileResult | undefined;
            if (username && username !== userId) {
                const usernameKey = queryKeys.users.profile(username);
                await qc.cancelQueries({ queryKey: usernameKey });
                previousByUsername = qc.getQueryData<UserProfileResult>(usernameKey);
                qc.setQueryData<UserProfileResult>(usernameKey, (old) =>
                    patchProfile(old, payload),
                );
            }

            // Only the fields actually present in the payload override the cache
            // (an omitted key must not clobber the cached value). avatar_url: null
            // is a real value (→ monogram), so it patches through.
            qc.setQueryData<UserProfileResult>(key, (old) => patchProfile(old, payload));
            return { previous, previousByUsername, username };
        },
        onError: (_err, _payload, ctx) => {
            if (!userId) return;
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKeys.users.profile(userId), ctx.previous);
            }
            // Roll the username-keyed entry back to its own snapshot.
            if (ctx?.username && ctx.username !== userId && ctx.previousByUsername !== undefined) {
                qc.setQueryData(queryKeys.users.profile(ctx.username), ctx.previousByUsername);
            }
        },
        onSuccess: (row, _payload, ctx) => {
            if (!userId) return;
            const key = queryKeys.users.profile(userId);
            // Reconcile with the authoritative server row. If the profile isn't
            // cached yet (nothing to patch), fall back to a targeted refetch.
            const current = qc.getQueryData<UserProfileResult>(key);
            if (current?.data?.profile) {
                qc.setQueryData<UserProfileResult>(key, (old) => patchProfile(old, row));
            } else {
                qc.invalidateQueries({ queryKey: key });
            }

            // Reconcile the username-keyed entry too — but patch-only. A missing
            // entry means no /u/<username> view is mounted, so there is nothing to
            // refetch (an invalidate on an unobserved key would be a wasted no-op).
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
