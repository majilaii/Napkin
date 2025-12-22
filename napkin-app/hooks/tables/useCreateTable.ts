/**
 * Hook to create a new table
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Table } from './useTables';

interface CreateTableInput {
    name: string;
    avatar_url?: string;
}

async function createTable(input: CreateTableInput): Promise<Table> {
    const { data, error } = await supabase.functions.invoke('table-management', {
        body: input,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
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
