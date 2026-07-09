/**
 * useUpdateProfile — mutation for display_name, bio, avatar_url, username.
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
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow, UserProfileResult } from './useUserProfile';

type UpdateProfilePayload = {
    display_name?: string;
    bio?: string | null;
    avatar_url?: string | null;
};

type MutationContext = { previous?: UserProfileResult };

async function updateProfile(payload: UpdateProfilePayload): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_profile',
        body: payload,
    });
}

/** Merge a partial patch into a cached profile result, preserving everything else. */
function patchProfile(
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
            // Only the fields actually present in the payload override the cache
            // (an omitted key must not clobber the cached value). avatar_url: null
            // is a real value (→ monogram), so it patches through.
            qc.setQueryData<UserProfileResult>(key, (old) => patchProfile(old, payload));
            return { previous };
        },
        onError: (_err, _payload, ctx) => {
            if (userId && ctx?.previous !== undefined) {
                qc.setQueryData(queryKeys.users.profile(userId), ctx.previous);
            }
        },
        onSuccess: (row) => {
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
        },
    });
}
