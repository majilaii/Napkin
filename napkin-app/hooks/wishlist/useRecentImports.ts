/**
 * useRecentImports — recent import batches for the imports hub, the profile
 * Imports strip, and the import-slot machinery.
 *
 * Backed by wishlist `list_imports`: server import_jobs joined to surviving
 * (non-deleted) wishlist items; batches whose spots were all pruned drop out.
 * Cache key is importJobs.all(userId) — every repoint/remove/add-spot mutation
 * already invalidates it, so the band self-heals after corrections.
 *
 * ONE canonical fetch (TICKET-191): the query key is limit-agnostic, so
 * per-call fetch limits made the cached array mount-order-dependent (a limit-4
 * slot mount could truncate the hub's 10 rows). Every consumer now shares
 * RECENT_IMPORTS_FETCH_LIMIT — the max any consumer needs (hub 10 ≥ strip 6 ≥
 * slot latest-only) — and slices locally.
 */
import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistSource } from '@/lib/types/wishlistSource';

export interface RecentImport {
    job_id: string;
    source: WishlistSource | null;
    status: string;
    created_at: string;
    item_count: number;
    preview_names: string[];
}

/** The single fetch limit every consumer shares. Slice locally to show fewer. */
export const RECENT_IMPORTS_FETCH_LIMIT = 10;

export function useRecentImports(userId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.importJobs.all(userId ?? ''),
        queryFn: async () => {
            const res = await callEdgeFn<{ imports: RecentImport[] }>('wishlist', {
                action: 'list_imports',
                body: { limit: RECENT_IMPORTS_FETCH_LIMIT },
            });
            return res?.imports ?? [];
        },
        enabled: !!userId,
        staleTime: 1000 * 60,
    });
}
