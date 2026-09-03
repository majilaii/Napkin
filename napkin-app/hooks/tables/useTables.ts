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
    /** Optional on richer cached table-list projections; omit UI count when absent. */
    member_count?: number;
    /** LEGACY — the column was dropped by `20260427000010_remove_personal_tables.sql`
     * and `table-management` never selects it, so this is `undefined` on every wire
     * shape today. Kept as a typed, defensive branch: absent = social. Do not build
     * personal-table affordances against it. */
    is_personal?: boolean;
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
