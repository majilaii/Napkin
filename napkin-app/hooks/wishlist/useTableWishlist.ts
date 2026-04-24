/**
 * Query hook: Table wishlist — restaurants saved by any member of a given Table,
 * ranked by member-save-count DESC then most-recent-save DESC.
 * Read-only; this is a derived view — there is no "add to Table wishlist" path.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
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
    const data = await callEdgeFn<TableWishlistItem[]>('wishlist', {
        action: 'list_table',
        body: { table_id: tableId },
    });
    return data ?? [];
}

export function useTableWishlist(tableId: string | null | undefined) {
    return useQuery<TableWishlistItem[], Error>({
        queryKey: queryKeys.wishlist.table(tableId ?? ''),
        queryFn: () => fetchTableWishlist(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
