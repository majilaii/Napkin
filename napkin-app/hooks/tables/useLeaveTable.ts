/**
 * useLeaveTable — non-owner member leaves a Table (TICKET-029).
 *
 * Server refuses if caller is the owner (403 OWNER_CANNOT_LEAVE).
 * The UI must never render "Leave" for owners — this is a safety net only.
 *
 * TICKET-036 P0-6: optimistically removes the table from the viewer's
 * tables list (the only cache they're guaranteed to be looking at right
 * after the action). Detail + members caches are invalidated narrowly
 * since the viewer typically navigates away from those screens.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { TableMembership } from './useTables';

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

    return useMutation<LeaveTableResult, Error, LeaveTableInput, { previousList: TableMembership[] | undefined; listKey: readonly unknown[] } | undefined>({
        mutationFn: leaveTable,

        onMutate: async ({ tableId }) => {
            if (!userId) return undefined;
            const listKey = queryKeys.tables.list(userId);
            await queryClient.cancelQueries({ queryKey: listKey });
            const previousList = queryClient.getQueryData<TableMembership[]>(listKey);
            // Optimistically drop the leaving table from the membership list.
            queryClient.setQueryData<TableMembership[]>(listKey, (prev) =>
                prev ? prev.filter((m) => m.tables.id !== tableId) : prev,
            );
            return { previousList, listKey };
        },

        onError: (_err, _vars, context) => {
            if (context?.listKey && context.previousList !== undefined) {
                queryClient.setQueryData(context.listKey, context.previousList);
            }
        },

        onSuccess: (_, { tableId }) => {
            // Detail/members caches are unmounted by the time the leave lands
            // in the typical flow; a narrow invalidate keeps them honest if
            // the user navigates back via deeplink.
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.members(tableId) });
            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.users.ledgerAll(userId) });
            }
        },
    });
}
