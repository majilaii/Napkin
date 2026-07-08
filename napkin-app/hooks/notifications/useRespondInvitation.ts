/**
 * useRespondInvitation — accept | decline a pending table invitation (TICKET-133).
 *
 * Canonical mutation pattern (mutations.md: snapshot → patch → rollback → narrow
 * refetch). This hook owns:
 *   - the notifications cache patch (flip the matching row's invitationStatus), and
 *   - on ACCEPT, the tables caches (list / members / detail) that carry
 *     server-derived membership data the response can't synthesise.
 *
 * It does NOT touch the unread count — notifications.tsx fires
 * markRead.mutate(n.id) alongside respond when the row is unread, reusing the
 * existing unread-count decrement (no duplication here).
 */
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { InboxPage, Notification } from './useNotifications';

export interface RespondInvitationInput {
    invitationId: string;
    response: 'accept' | 'decline';
    /** Table the invitation is for — used to scope the accept invalidations. */
    tableId?: string;
    /** The inbox row that triggered this — matched to patch its status. */
    notificationId: string;
}

export interface RespondInvitationResult {
    status: 'accepted' | 'declined';
    table_id?: string;
    table_name?: string | null;
}

export function useRespondInvitation(userId: string | null | undefined) {
    const qc = useQueryClient();
    const queryKey = queryKeys.notifications.all(userId ?? '');

    return useMutation<
        RespondInvitationResult,
        Error,
        RespondInvitationInput,
        { previous?: InfiniteData<InboxPage> }
    >({
        mutationFn: async ({ invitationId, response }) =>
            callEdgeFn<RespondInvitationResult>('table-management', {
                action: 'respond_invitation',
                body: { invitation_id: invitationId, response },
            }),

        onMutate: async ({ notificationId, response }) => {
            // Cancel in-flight inbox fetches so they can't overwrite the patch.
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<InfiniteData<InboxPage>>(queryKey);
            const nextStatus: 'accepted' | 'declined' =
                response === 'accept' ? 'accepted' : 'declined';

            qc.setQueryData<InfiniteData<InboxPage>>(queryKey, (old) => {
                if (!old) return old;
                const pages = old.pages.map((page) => ({
                    ...page,
                    rows: page.rows.map((r): Notification =>
                        r.id === notificationId && r.type === 'table_invite'
                            ? { ...r, invitationStatus: nextStatus }
                            : r,
                    ),
                }));
                return { ...old, pages };
            });

            return { previous };
        },

        onError: (_err, _input, ctx) => {
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKey, ctx.previous);
            }
        },

        onSuccess: (_result, { response, tableId }) => {
            // decline: the notification status patch is authoritative — nothing
            // server-derived to reconcile, so no invalidation.
            if (response !== 'accept') return;

            // invalidate: the new membership is server-derived — the tables list
            // row (name / owner / role / counts) can't be synthesised client-side.
            qc.invalidateQueries({ queryKey: queryKeys.tables.list(userId ?? '') });
            if (tableId) {
                // invalidate: member join display data (avatars, roles) is a
                // server join not present in the respond_invitation response.
                qc.invalidateQueries({ queryKey: queryKeys.tables.members(tableId) });
                qc.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
            }
        },
    });
}
