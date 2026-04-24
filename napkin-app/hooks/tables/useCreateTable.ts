/**
 * Hook to create a new table
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { Table } from './useTables';

interface CreateTableInput {
    name: string;
    avatar_url?: string;
}

async function createTable(input: CreateTableInput): Promise<Table> {
    return callEdgeFn<Table>('table-management', { body: input });
}

export function useCreateTable(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: createTable,
        onSuccess: () => {
            // Invalidate tables list
            if (userId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.list(userId),
                });
            }
        },
    });
}
