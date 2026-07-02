/**
 * useRecentImports — recent import batches for the wishlist band + imports hub.
 *
 * Backed by wishlist `list_imports`: server import_jobs joined to surviving
 * (non-deleted) wishlist items; batches whose spots were all pruned drop out.
 * Cache key is importJobs.all(userId) — every repoint/remove/add-spot mutation
 * already invalidates it, so the band self-heals after corrections.
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

export function useRecentImports(userId: string | null | undefined, limit = 5) {
    return useQuery({
        queryKey: queryKeys.importJobs.all(userId ?? ''),
        queryFn: async () => {
            const res = await callEdgeFn<{ imports: RecentImport[] }>('wishlist', {
                action: 'list_imports',
                body: { limit },
            });
            return res?.imports ?? [];
        },
        enabled: !!userId,
        staleTime: 1000 * 60,
    });
}
