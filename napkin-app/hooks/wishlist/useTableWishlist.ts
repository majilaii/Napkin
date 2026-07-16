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
    /** Exact save id only when this viewer personally saved the restaurant. */
    viewer_item_id: string | null;
}

async function fetchTableWishlist(tableId: string): Promise<TableWishlistItem[]> {
    const data = await callEdgeFn<TableWishlistItem[]>('wishlist', {
        action: 'list_table',
        body: { table_id: tableId },
    });
    return data ?? [];
}

export function useTableWishlist(
    userId: string | null | undefined,
    tableId: string | null | undefined,
) {
    const queryKey = userId && tableId
        ? queryKeys.wishlist.table(userId, tableId)
        : queryKeys.wishlist.tableDisabled();

    return useQuery<TableWishlistItem[], Error>({
        queryKey,
        queryFn: () => fetchTableWishlist(tableId!),
        enabled: !!userId && !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
