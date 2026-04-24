/**
 * useUpdateProfile — mutation for display_name, bio, avatar_url, username.
 *
 * Partial payload: only include fields that changed.
 * On success, invalidates the caller's own profile query.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow } from './useUserProfile';

type UpdateProfilePayload = {
    display_name?: string;
    bio?: string | null;
    avatar_url?: string | null;
};

async function updateProfile(payload: UpdateProfilePayload): Promise<UserProfileRow> {
    return callEdgeFn<UserProfileRow>('user-profile', {
        action: 'update_profile',
        body: payload,
    });
}

export function useUpdateProfile(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<UserProfileRow, Error, UpdateProfilePayload>({
        mutationFn: updateProfile,
        onSuccess: () => {
            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
            }
        },
    });
}
