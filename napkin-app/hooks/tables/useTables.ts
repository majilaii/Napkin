/**
 * Hook to fetch user's tables
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface Table {
    id: string;
    name: string;
    avatar_url: string | null;
    owner_id: string;
    created_at: string;
    updated_at: string;
}

export interface TableMembership {
    role: 'admin' | 'member';
    joined_at: string;
    tables: Table;
}

async function fetchUserTables(_userId: string): Promise<TableMembership[]> {
    const data = await callEdgeFn<TableMembership[]>('table-management', {
        method: 'GET',
    });
    return data ?? [];
}

export function useTables(userId: string | null | undefined) {
    return useQuery<TableMembership[], Error>({
        queryKey: queryKeys.tables.list(userId!),
        queryFn: () => fetchUserTables(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
