/**
 * Query hook: Table wishlist — restaurants saved by any member of a given Table,
 * ranked by member-save-count DESC then most-recent-save DESC.
 * Read-only; this is a derived view — there is no "add to Table wishlist" path.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistRestaurant } from './useMyWishlist';

export interface TableWishlistMember {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

export interface TableWishlistItem {
    restaurant: WishlistRestaurant;
    count: number;
    members: TableWishlistMember[];
}

async function fetchTableWishlist(tableId: string): Promise<TableWishlistItem[]> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('wishlist', {
        body: { action: 'list_table', table_id: tableId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data ?? [];
}

export function useTableWishlist(tableId: string | null | undefined) {
    return useQuery<TableWishlistItem[], Error>({
        queryKey: queryKeys.wishlist.table(tableId ?? ''),
        queryFn: () => fetchTableWishlist(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
