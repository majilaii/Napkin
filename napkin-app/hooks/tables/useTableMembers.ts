/**
 * Hook to fetch members of a specific table.
 * Used by create-entry.tsx for the participant tagging UI.
 * Queries the DB directly instead of going through the edge function.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface TableMember {
    member_id: string;
    role: string;
    joined_at: string;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

async function fetchTableMembers(tableId: string): Promise<TableMember[]> {
    const { data, error } = await supabase
        .from('table_members')
        .select(`
            member_id,
            role,
            joined_at,
            profiles:profiles!table_members_member_id_fkey (
                display_name
            )
        `)
        .eq('table_id', tableId);

    if (error) throw error;
    return (data as unknown as TableMember[]) ?? [];
}

export function useTableMembers(tableId: string | null | undefined) {
    return useQuery<TableMember[], Error>({
        queryKey: queryKeys.tables.members(tableId!),
        queryFn: () => fetchTableMembers(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
