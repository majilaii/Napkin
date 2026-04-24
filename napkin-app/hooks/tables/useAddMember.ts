/**
 * useAddMember — add a mutual-follow to a Table (owner only, TICKET-029).
 *
 * Server enforces:
 *   - caller must be the Table owner (403 NOT_OWNER)
 *   - both follow directions must exist (403 NOT_MUTUAL_FOLLOW)
 *   - idempotent: adding an existing member returns already_member=true (no error)
 *
 * On success: invalidates tableMembers + tableDetail caches.
 * On error: typed error_code is surfaced so the UI can render specific copy.
 *
 * TICKET-037: uses shared unwrapInvokeError helper instead of local unwrap.
 * AddMemberError.error_code still exposed for UI branching.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface AddMemberInput {
    tableId: string;
    targetUserId: string;
}

export interface AddMemberResult {
    member_id: string;
    already_member: boolean;
}

export class AddMemberError extends Error {
    constructor(
        message: string,
        public readonly error_code?: 'NOT_OWNER' | 'NOT_MUTUAL_FOLLOW' | string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'AddMemberError';
    }
}

async function addMember(input: AddMemberInput): Promise<AddMemberResult> {
    try {
        return await callEdgeFn<AddMemberResult>('table-management', {
            method: 'POST',
            params: { action: 'add_member' },
            body: { table_id: input.tableId, target_user_id: input.targetUserId },
        });
    } catch (err) {
        // Surface typed AddMemberError so the UI can branch on error_code.
        const cause = (err as { cause?: { code?: string; message?: string; status?: number } }).cause;
        const code = cause?.code && cause.code !== 'LEGACY' && cause.code !== 'UNKNOWN'
            ? cause.code
            : undefined;
        const message = cause?.message ?? (err instanceof Error ? err.message : 'Unknown error');
        throw new AddMemberError(message, code, cause?.status);
    }
}

export function useAddMember(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<AddMemberResult, AddMemberError, AddMemberInput>({
        mutationFn: addMember,
        onSuccess: (_, { tableId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.members(tableId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.tables.list(userId) });
            }
        },
    });
}
