/**
 * Hook to fetch the current user's personal Table (their solo diary).
 *
 * The personal Table is created automatically on signup by the handle_new_user
 * DB trigger and is excluded from the default table-management list. This hook
 * calls the list endpoint with include_personal=true and filters client-side to
 * the single personal Table row.
 *
 * Used by TICKET-015 (wishlist) and TICKET-016 (restaurant page / diary view).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Table } from '@/hooks/tables/useTables';

async function fetchPersonalTable(): Promise<Table | null> {
    const { data, error } = await supabase.functions.invoke(
        'table-management?include_personal=true',
        { method: 'GET' },
    );

    if (error) throw error;

    const rows: Array<{ role: string; joined_at: string; tables: Table }> =
        data?.data ?? [];

    const personal = rows.find(row => row.tables?.is_personal === true);
    return personal?.tables ?? null;
}

export function usePersonalTable(userId: string | null | undefined) {
    return useQuery<Table | null, Error>({
        queryKey: queryKeys.personalTable.byUser(userId!),
        queryFn: () => fetchPersonalTable(),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5 minutes — personal Table rarely changes
    });
}
