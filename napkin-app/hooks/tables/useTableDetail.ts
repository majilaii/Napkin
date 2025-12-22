/**
 * Hook to fetch single table with members
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Table } from './useTables';

export interface TableMember {
    user_id: string;
    role: 'admin' | 'member';
    joined_at: string;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

export interface TableDetail extends Table {
    members: TableMember[];
}

async function fetchTableDetail(tableId: string): Promise<TableDetail> {
    const { data, error } = await supabase.functions.invoke(`table-management/${tableId}`, {
        method: 'GET',
    });

    if (error) throw error;
    return data?.data;
}

export function useTableDetail(tableId: string | null | undefined) {
    return useQuery<TableDetail, Error>({
        queryKey: queryKeys.tables.detail(tableId!),
        queryFn: () => fetchTableDetail(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 2, // 2 minutes
    });
}
