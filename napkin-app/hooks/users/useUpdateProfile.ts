/**
 * useUpdateProfile — mutation for display_name, bio, avatar_url, username.
 *
 * Partial payload: only include fields that changed.
 * On success, invalidates the caller's own profile query.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileRow } from './useUserProfile';

type UpdateProfilePayload = {
    display_name?: string;
    bio?: string | null;
    avatar_url?: string | null;
};

async function updateProfile(payload: UpdateProfilePayload): Promise<UserProfileRow> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'update_profile', ...payload },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as UserProfileRow;
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
