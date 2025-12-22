/**
 * Hook to fetch user's tables
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface Table {
    id: string;
    name: string;
    avatar_url: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface TableMembership {
    role: 'admin' | 'member';
    joined_at: string;
    tables: Table;
}

async function fetchUserTables(userId: string): Promise<TableMembership[]> {
    const { data, error } = await supabase.functions.invoke('table-management', {
        method: 'GET',
    });

    if (error) throw error;
    return data?.data || [];
}

export function useTables(userId: string | null | undefined) {
    return useQuery<TableMembership[], Error>({
        queryKey: queryKeys.tables.list(userId!),
        queryFn: () => fetchUserTables(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
