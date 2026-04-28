/**
 * useMarkNotificationRead — optimistic single-row mark-read mutation.
 *
 * TICKET-048: canonical mutation pattern (snapshot → patch → rollback).
 * Patching: flips the matched row to read=true and decrements
 *           pages[0].unread_count by 1 (clamped to 0).
 * No onSuccess invalidation — server result (the updated row) differs from
 * the optimistic state by timestamps only (irrelevant to UI).
 */
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { InboxPage } from './useNotifications';

export function useMarkNotificationRead(userId: string | null | undefined) {
    const qc = useQueryClient();
    const queryKey = queryKeys.notifications.all(userId ?? '');

    return useMutation({
        mutationFn: async (notificationId: string) =>
            callEdgeFn('notifications', {
                body: { action: 'mark_read', notification_id: notificationId },
            }),

        onMutate: async (notificationId: string) => {
            // Cancel in-flight fetches to prevent them overwriting the patch.
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<InfiniteData<InboxPage>>(queryKey);

            qc.setQueryData<InfiniteData<InboxPage>>(queryKey, (old) => {
                if (!old) return old;
                let didFlip = false;
                const pages = old.pages.map((page) => ({
                    ...page,
                    rows: page.rows.map((r) => {
                        if (r.id !== notificationId || r.read) return r;
                        didFlip = true;
                        return { ...r, read: true };
                    }),
                }));
                // Decrement unread_count on first page if we flipped a row.
                if (didFlip && pages.length > 0 && pages[0].unread_count != null) {
                    pages[0] = {
                        ...pages[0],
                        unread_count: Math.max(0, pages[0].unread_count - 1),
                    };
                }
                return { ...old, pages };
            });

            return { previous };
        },

        onError: (_err, _id, ctx) => {
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKey, ctx.previous);
            }
        },

        // No onSuccess invalidation — cache is already correct after the patch.
    });
}
