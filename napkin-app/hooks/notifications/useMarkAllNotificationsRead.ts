/**
 * useMarkAllNotificationsRead — optimistic bulk mark-all-read mutation.
 *
 * TICKET-048: canonical mutation pattern (snapshot → patch → rollback).
 * Patching: sets read=true on every row across all cached pages.
 *           Sets pages[0].unread_count = 0.
 * No onSuccess invalidation — bulk write is identical on client and server;
 * focus refetch will reconcile any drift on the next screen-visit.
 *
 * The mark_all_read server action clears ALL unread for the user (not just the
 * visible page) — the bell is account-scoped, not page-scoped.
 */
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { InboxPage } from './useNotifications';

export function useMarkAllNotificationsRead(userId: string | null | undefined) {
    const qc = useQueryClient();
    const queryKey = queryKeys.notifications.all(userId ?? '');

    return useMutation({
        mutationFn: async () =>
            callEdgeFn<{ updated: number }>('notifications', {
                body: { action: 'mark_all_read' },
            }),

        onMutate: async () => {
            // Cancel in-flight fetches to prevent them overwriting the patch.
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<InfiniteData<InboxPage>>(queryKey);

            qc.setQueryData<InfiniteData<InboxPage>>(queryKey, (old) => {
                if (!old) return old;
                const pages = old.pages.map((page, idx) => ({
                    ...page,
                    rows: page.rows.map((r) => (r.read ? r : { ...r, read: true })),
                    unread_count: idx === 0 ? 0 : page.unread_count,
                }));
                return { ...old, pages };
            });

            return { previous };
        },

        onError: (_err, _vars, ctx) => {
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKey, ctx.previous);
            }
        },

        // No onSuccess invalidation — bulk write is identical on both sides.
    });
}
