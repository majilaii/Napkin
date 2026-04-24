/**
 * useLeaveTable — non-owner member leaves a Table (TICKET-029).
 *
 * Server refuses if caller is the owner (403 OWNER_CANNOT_LEAVE).
 * The UI must never render "Leave" for owners — this is a safety net only.
 *
 * On success: invalidates tables list so the table disappears from the tab.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface LeaveTableInput {
    tableId: string;
}

export interface LeaveTableResult {
    left: boolean;
}

async function leaveTable(input: LeaveTableInput): Promise<LeaveTableResult> {
    return callEdgeFn<LeaveTableResult>('table-management', {
        method: 'POST',
        params: { action: 'leave_table' },
        body: { table_id: input.tableId },
    });
}

export function useLeaveTable(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<LeaveTableResult, Error, LeaveTableInput>({
        mutationFn: leaveTable,
        onSuccess: (_, { tableId }) => {
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.tables.list(userId) });
            }
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.members(tableId) });
        },
    });
}
