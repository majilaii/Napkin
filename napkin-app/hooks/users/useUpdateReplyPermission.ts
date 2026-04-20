/**
 * useUpdateReplyPermission — mutation for allow_public_replies.
 *
 * Column ships in TICKET-020; enforcement is in TICKET-021.
 * On success, invalidates the caller's own profile query.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

async function updateReplyPermission(allow_public_replies: boolean): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'update_reply_permission', allow_public_replies },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
}

export function useUpdateReplyPermission(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<void, Error, boolean>({
        mutationFn: updateReplyPermission,
        onSuccess: () => {
            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
            }
        },
    });
}
