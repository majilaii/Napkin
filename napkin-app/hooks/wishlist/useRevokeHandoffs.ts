/**
 * useRevokeHandoffs — revoke all live share links for the caller (TICKET-072).
 *
 * Calls handoff?action=revoke_all (authed, POST).
 * ARCH-REVIEW-2 #12: revoke_all sets revoked_at on ALL outstanding tokens
 * (WHERE owner_id = me AND revoked_at IS NULL). A share created at exactly
 * the cutoff instant may survive — accepted and documented.
 *
 * Returns { revoked_count }.
 *
 * No optimistic cache: there is no manage-links UI in v1.
 * No blanket invalidation: the wishlist itself is not changed by revoking.
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

export interface RevokeHandoffsResult {
    revoked_count: number;
}

export function useRevokeHandoffs() {
    return useMutation({
        mutationFn: async (): Promise<RevokeHandoffsResult> => {
            return callEdgeFn<RevokeHandoffsResult>('handoff', {
                action: 'revoke_all',
                body: {},
            });
        },
    });
}
