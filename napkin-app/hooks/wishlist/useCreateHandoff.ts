/**
 * useCreateHandoff — mint a wishlist or per-list share link (TICKET-072 / -074).
 *
 * Calls handoff?action=create (authed, POST).
 * Input: optional { list_id } — when present the server creates a live link for
 * either the caller's personal list or another author's currently-visible public
 * list. The server re-authorizes relayed public lists whenever the link is used.
 * Returns { token, share_url } on success.
 * Empty wishlist/list → 400 EMPTY_WISHLIST / EMPTY_LIST (affordance should
 * already be hidden).
 *
 * No optimistic cache: there is no manage-links UI in v1.
 * No blanket invalidation: the wishlist itself is not changed by creating a share.
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

export interface CreateHandoffInput {
    /** Share a specific owned or visible-public list instead of the wishlist. */
    list_id?: string;
}

export interface CreateHandoffResult {
    token: string;
    share_url: string;
}

export function useCreateHandoff() {
    return useMutation({
        mutationFn: async (input?: CreateHandoffInput): Promise<CreateHandoffResult> => {
            return callEdgeFn<CreateHandoffResult>('handoff', {
                action: 'create',
                body: input?.list_id ? { list_id: input.list_id } : {},
            });
        },
    });
}
