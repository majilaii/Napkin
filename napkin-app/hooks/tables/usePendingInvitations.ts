/**
 * usePendingInvitations — the set of user_ids with a PENDING invitation to a
 * table (TICKET-133). Backs the AddMemberSheet "invited" chip so an owner who
 * already invited someone sees a quiet state instead of a re-tappable "Add".
 *
 * Member-gated on the server (same table_members check as top_four_get).
 * Returns a Set<string> so membership checks are O(1) and useAddMember can patch
 * it (add the freshly-invited id) without a refetch.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

interface PendingInvitationsResult {
    invited_user_ids: string[];
}

/** Shared literal key so the hook and useAddMember's patch never drift. */
export function pendingInvitesQueryKey(tableId: string | null | undefined) {
    return ['tablePendingInvites', tableId ?? ''] as const;
}

export function usePendingInvitations(
    tableId: string | null | undefined,
    enabled: boolean,
) {
    return useQuery({
        queryKey: pendingInvitesQueryKey(tableId),
        queryFn: async (): Promise<Set<string>> => {
            const res = await callEdgeFn<PendingInvitationsResult>('table-management', {
                action: 'pending_invitations',
                body: { table_id: tableId },
            });
            return new Set(res.invited_user_ids ?? []);
        },
        enabled: enabled && !!tableId,
        staleTime: 1000 * 30,
    });
}
