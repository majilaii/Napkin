/**
 * useUpdateReplyPermission — mutation for allow_public_replies.
 *
 * Column ships in TICKET-020; enforcement is in TICKET-021.
 * TICKET-037 (P2-14): server now returns full profile shape; onSuccess uses
 * setQueryData for optimistic patching instead of invalidate-only.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

interface ProfileShape {
    user_id: string;
    username?: string | null;
    display_name?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
    account_privacy?: string | null;
    allow_public_replies?: boolean | null;
}

async function updateReplyPermission(allow_public_replies: boolean): Promise<ProfileShape> {
    return callEdgeFn<ProfileShape>('user-profile', {
        action: 'update_reply_permission',
        body: { allow_public_replies },
    });
}

export function useUpdateReplyPermission(userId: string | null | undefined) {
    const qc = useQueryClient();

    return useMutation<ProfileShape, Error, boolean>({
        mutationFn: updateReplyPermission,
        onSuccess: (result) => {
            if (userId) {
                // Optimistically patch the cached profile with the full returned shape
                qc.setQueryData(queryKeys.users.profile(userId), (old: any) => {
                    if (!old?.data) return old;
                    return { ...old, data: { ...old.data, ...result } };
                });
                // Also invalidate to ensure full refresh on next stale window
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
            }
        },
    });
}
