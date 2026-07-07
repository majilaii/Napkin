/**
 * useDeleteTable — owner deletes a Table (hard delete).
 *
 * Server refuses if the caller isn't the owner (403 NOT_OWNER). The UI only
 * renders "Delete table" for owners — this is a safety net. The FK graph
 * cascades safely: logged meals survive (entries.table_id SET NULL).
 *
 * Lifecycle mirrors useLeaveTable (TICKET-036 P0-6): optimistically drop the
 * table from the viewer's tables list, roll back on error, narrowly invalidate
 * the deleted table's detail + members caches.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { TableMembership } from './useTables';

export interface DeleteTableInput {
    tableId: string;
}

export interface DeleteTableResult {
    deleted: boolean;
}

async function deleteTable(input: DeleteTableInput): Promise<DeleteTableResult> {
    return callEdgeFn<DeleteTableResult>('table-management', {
        method: 'POST',
        params: { action: 'delete_table' },
        body: { table_id: input.tableId },
    });
}

export function useDeleteTable(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<DeleteTableResult, Error, DeleteTableInput, { previousList: TableMembership[] | undefined; listKey: readonly unknown[] } | undefined>({
        mutationFn: deleteTable,

        onMutate: async ({ tableId }) => {
            if (!userId) return undefined;
            const listKey = queryKeys.tables.list(userId);
            await queryClient.cancelQueries({ queryKey: listKey });
            const previousList = queryClient.getQueryData<TableMembership[]>(listKey);
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
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tables.members(tableId) });
        },
    });
}
