/**
 * useTablesOverlap — per-table `list_table` fan-out for the Discover overlap
 * layer (TICKET-138).
 *
 * Overlap is already computed member-gated at read time by
 * wishlist?action=list_table (`{ restaurant, count, members[≤5] }` per
 * restaurant), and most users have 1–2 tables, so we reuse that endpoint over
 * the viewer's tables via `useQueries` rather than a new "my-tables overlap"
 * edge action. Each query reuses the table Wishlist tab's cache + staleTime
 * (`queryKeys.wishlist.table(viewerId, tableId)`).
 *
 * Lazy: fetches nothing until `enabled` (Discover armed) — the membership read
 * AND the per-table fan-out are both gated, so a wishlist visitor who never
 * opens Discover, and any zero-table user, make no overlap fetches. Zero-table
 * users → useQueries over [] → no network (AC7).
 */
import { useQueries } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useTables } from '@/hooks/tables/useTables';
import type { TableWishlistItem } from './useTableWishlist';

export interface TableOverlapSource {
    tableId: string;
    tableName: string;
    items: TableWishlistItem[];
}

export function useTablesOverlap(
    userId: string | null | undefined,
    opts: { enabled: boolean },
): { sources: TableOverlapSource[]; isLoading: boolean } {
    // Gate the membership read on `enabled` too (a small, deliberate deviation
    // from the design's unconditional `useTables(userId)`): the design's own
    // docstring promises "fetches nothing until Discover armed", and AC7 wants
    // zero new fetches for un-armed / zero-table users. `useTables` is disabled
    // when passed a null id.
    const { data: memberships } = useTables(opts.enabled ? userId : null);
    const tables = opts.enabled && userId
        ? (memberships ?? []).map((m) => m.tables).filter(Boolean)
        : [];

    const results = useQueries({
        queries: tables.map((t) => ({
            queryKey: queryKeys.wishlist.table(userId!, t.id),
            queryFn: () =>
                callEdgeFn<TableWishlistItem[]>('wishlist', {
                    action: 'list_table',
                    body: { table_id: t.id },
                }).then((d) => d ?? []),
            enabled: opts.enabled && !!userId, // lazy arm; zero tables → no queries
            staleTime: 1000 * 60 * 5,
        })),
    });

    return {
        sources: tables.map((t, i) => ({
            tableId: t.id,
            tableName: t.name,
            items: results[i]?.data ?? [],
        })),
        isLoading: results.some((r) => r.isLoading),
    };
}
