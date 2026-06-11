/**
 * useCreateHandoff — mint a wishlist share link (TICKET-072).
 *
 * Calls handoff?action=create (authed, POST).
 * Returns { token, share_url } on success.
 * Empty wishlist → 400 EMPTY_WISHLIST (affordance should already be hidden).
 *
 * No optimistic cache: there is no manage-links UI in v1.
 * No blanket invalidation: the wishlist itself is not changed by creating a share.
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

export interface CreateHandoffResult {
    token: string;
    share_url: string;
}

export function useCreateHandoff() {
    return useMutation({
        mutationFn: async (): Promise<CreateHandoffResult> => {
            return callEdgeFn<CreateHandoffResult>('handoff', {
                action: 'create',
                body: {},
            });
        },
    });
}
