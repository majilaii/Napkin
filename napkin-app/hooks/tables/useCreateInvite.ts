/**
 * useCreateInvite — mint (or fetch) the live invite code + join URL for a table.
 *
 * Any member may mint; the server returns the existing live code if one exists
 * (one active code per table). No cache patches — the invite doesn't change any
 * cached table shape; the caller just shares the returned join_url.
 *
 * The tableId is the mutation argument (not bound at construction) so a caller
 * can mint for a table created moments earlier (e.g. the new-table flow).
 */
import { useMutation } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';

export interface CreateInviteResult {
    code: string;
    join_url: string;
}

async function createInvite(tableId: string): Promise<CreateInviteResult> {
    return callEdgeFn<CreateInviteResult>('table-management', {
        method: 'POST',
        params: { action: 'create_invite' },
        body: { table_id: tableId },
    });
}

export function useCreateInvite() {
    return useMutation<CreateInviteResult, Error, string>({
        mutationFn: (tableId) => createInvite(tableId),
    });
}
