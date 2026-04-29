/**
 * useRecentlyPostedTables — Tables ordered by the user's most-recent post.
 *
 * TICKET-043: provides the Smart-three ordering source for TableChipsRow.
 * We query entry_tables joined with tables to get the user's Tables sorted by
 * their most-recent post date (desc). Requires the user to be authenticated.
 *
 * RLS: entry_tables SELECT policy admits the author, so this query returns all
 * Tables the user has ever posted to (not just current memberships).
 * The UI component filters against useTables() membership before rendering chips.
 *
 * Returns TableMembership[] (same shape as useTables) so components can compose
 * both hooks without type friction. Only `tables` sub-object is populated;
 * `role` and `joined_at` are mocked as they're not needed for ordering.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { TableMembership } from './useTables';

interface RecentPostRow {
    table_id: string;
    max_posted_at: string;
    tables: {
        id: string;
        name: string;
        avatar_url: string | null;
        owner_id: string;
        created_at: string;
        updated_at: string;
    } | null;
}

async function fetchRecentlyPostedTables(userId: string): Promise<TableMembership[]> {
    // Aggregate by table_id to get the most recent post date per Table.
    // entry_tables RLS (author can see their own rows) covers this.
    const { data, error } = await supabase
        .from('entry_tables')
        .select(`
            table_id,
            max_posted_at:posted_at,
            tables ( id, name, avatar_url, owner_id, created_at, updated_at )
        `)
        .eq('entries.user_id', userId)
        .order('max_posted_at', { ascending: false })
        .limit(20);

    if (error) throw error;

    // Deduplicate by table_id — keep only the most-recent row per Table.
    const seen = new Set<string>();
    const result: TableMembership[] = [];
    for (const row of ((data ?? []) as unknown as RecentPostRow[])) {
        if (!row.tables || seen.has(row.table_id)) continue;
        seen.add(row.table_id);
        result.push({
            role: 'member',
            joined_at: row.tables.created_at,
            tables: row.tables,
        });
    }
    return result;
}

export function useRecentlyPostedTables(userId: string | null | undefined) {
    return useQuery<TableMembership[], Error>({
        queryKey: userId
            ? queryKeys.users.recentlyPostedTables(userId)
            : ['users', 'recentlyPostedTables', 'anon'],
        queryFn: () => fetchRecentlyPostedTables(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
