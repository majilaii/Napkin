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
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { unwrapInvokeError } from '@/lib/edgeInvoke';

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
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke(
        'table-management?action=add_member',
        {
            method: 'POST',
            body: { table_id: input.tableId, target_user_id: input.targetUserId },
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );

    if (error) {
        const unwrapped = await unwrapInvokeError(error);
        // Support both new envelope shape (error.code) and legacy flat shape (error_code)
        const code = unwrapped.code !== 'LEGACY' && unwrapped.code !== 'UNKNOWN'
            ? unwrapped.code
            : (data?.error_code as string | undefined);
        throw new AddMemberError(unwrapped.message, code, unwrapped.status);
    }

    if (data?.error) {
        // Legacy flat error shape from table-management (still returns { error, error_code })
        throw new AddMemberError(data.error, data.error_code);
    }

    return data?.data as AddMemberResult;
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
