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
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow } from './useUserProfile';

type UpdatePrivacyPayload = {
    account_privacy: 'private' | 'public';
    username?: string;
};

async function updatePrivacy(payload: UpdatePrivacyPayload): Promise<UserProfileRow> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'update_privacy', ...payload },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as UserProfileRow;
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
