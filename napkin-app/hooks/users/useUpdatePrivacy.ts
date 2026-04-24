/**
 * useUpdatePrivacy — atomic privacy flip mutation.
 *
 * Accepts { account_privacy, username? }.
 * When flipping from private (null username) → public, username is required
 * in the same call — the server enforces atomicity.
 *
 * On success, invalidates the caller's own profile query.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow } from './useUserProfile';

type UpdatePrivacyPayload = {
    account_privacy: 'private' | 'public';
    username?: string;
};

async function updatePrivacy(payload: UpdatePrivacyPayload): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_privacy',
        body: payload,
    });
}

export function useUpdatePrivacy(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<UserProfileRow, Error, UpdatePrivacyPayload>({
        mutationFn: updatePrivacy,
        onSuccess: (updated) => {
            if (userId) {
                // Invalidate own profile; identifier can be uuid or username
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
                if (updated.username) {
                    qc.invalidateQueries({ queryKey: queryKeys.users.profile(updated.username) });
                }
            }
        },
    });
}
