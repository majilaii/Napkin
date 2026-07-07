/**
 * useJoinByInvite — redeem an invite code → seat the caller in the table.
 *
 * On success the viewer has a new membership, so we invalidate their tables
 * list (narrow, single-user key) plus the joined table's detail + members caches
 * so the destination screen renders fresh. already_member returns 200 too (the
 * server is idempotent) — the same narrow invalidations are harmless.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface JoinByInviteResult {
    table_id: string;
    table_name: string | null;
    already_member: boolean;
}

async function joinByInvite(code: string): Promise<JoinByInviteResult> {
    return callEdgeFn<JoinByInviteResult>('table-management', {
        method: 'POST',
        params: { action: 'join_by_invite' },
        body: { code },
    });
}

export function useJoinByInvite(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<JoinByInviteResult, Error, string>({
        mutationFn: (code) => joinByInvite(code),
        onSuccess: (result) => {
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.tables.list(userId) });
            }
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.detail(result.table_id) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.members(result.table_id) });
        },
    });
}
