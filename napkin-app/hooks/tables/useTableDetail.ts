/**
 * Hook to fetch single table with members.
 *
 * TICKET-029: Response now also includes caller_welcomed_at (TIMESTAMPTZ | null)
 * and caller_role ('admin' | 'member' | null) so the WelcomeBanner and settings
 * affordance can read the necessary state without extra fetches.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Table } from './useTables';

export interface TableMember {
    user_id: string;
    role: 'admin' | 'member';
    joined_at: string;
    welcomed_at?: string | null;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

export interface TableDetail extends Table {
    members: TableMember[];
    /** welcomed_at for the calling user's own membership row. NULL means banner should show (if non-admin). */
    caller_welcomed_at: string | null;
    /** role of the calling user in this table. */
    caller_role: 'admin' | 'member' | null;
}

async function fetchTableDetail(tableId: string): Promise<TableDetail> {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke(`table-management/${tableId}`, {
        method: 'GET',
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
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
