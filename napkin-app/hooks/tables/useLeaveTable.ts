/**
 * useLeaveTable — non-owner member leaves a Table (TICKET-029).
 *
 * Server refuses if caller is the owner (403 OWNER_CANNOT_LEAVE).
 * The UI must never render "Leave" for owners — this is a safety net only.
 *
 * On success: invalidates tables list so the table disappears from the tab.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface LeaveTableInput {
    tableId: string;
}

export interface LeaveTableResult {
    left: boolean;
}

async function leaveTable(input: LeaveTableInput): Promise<LeaveTableResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke(
        'table-management?action=leave_table',
        {
            method: 'POST',
            body: { table_id: input.tableId },
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as LeaveTableResult;
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
