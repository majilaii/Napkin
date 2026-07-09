/**
 * useUpdateUsername — standalone username claim/change mutation.
 *
 * Wraps the `update_username` action (server validates format + uniqueness,
 * 409 on collision). Use this for the settings Username editor; the atomic
 * first-flip (private→public) still writes username via useUpdatePrivacy.
 *
 * On success, invalidates the caller's own profile query (by uuid and by the
 * new handle, mirroring useUpdatePrivacy).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow } from './useUserProfile';

async function updateUsername(username: string): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_username',
        body: { username },
    });
}

export function useUpdateUsername(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<UserProfileRow, Error, string>({
        mutationFn: updateUsername,
        onSuccess: (updated) => {
            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
                if (updated.username) {
                    qc.invalidateQueries({ queryKey: queryKeys.users.profile(updated.username) });
                }
            }
        },
    });
}
