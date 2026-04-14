/**
 * Hook to fetch members of a specific table.
 * Used by create-entry.tsx for the participant tagging UI.
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
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke(
        `table-management/${tableId}`,
        {
            method: 'GET',
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );
    if (error) throw error;
    return data?.data?.members ?? [];
}

export function useTableMembers(tableId: string | null | undefined) {
    return useQuery<TableMember[], Error>({
        queryKey: queryKeys.tables.members(tableId!),
        queryFn: () => fetchTableMembers(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
