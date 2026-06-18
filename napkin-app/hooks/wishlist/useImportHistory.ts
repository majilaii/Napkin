/**
 * useImportHistory — the caller's import batches (grouped by job_id) for the
 * "recently imported" band + the imports history screen.
 *
 * Each batch = one import (a video / link / screenshot) that landed N spots in
 * the wishlist. Backed by the `wishlist` edge action `list_imports`.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistSource } from '@/lib/types/wishlistSource';

export type ImportJobStatus = 'pending' | 'resolved' | 'needs_confirm' | 'failed';

export interface ImportBatch {
    job_id: string;
    source: WishlistSource | null;
    status: ImportJobStatus;
    created_at: string;
    item_count: number;
    /** Up to 3 restaurant names for an at-a-glance preview. */
    preview_names: string[];
}

async function fetchImports(limit: number): Promise<ImportBatch[]> {
    // callEdgeFn strips the outer { data } envelope → we receive { imports }.
    const res = await callEdgeFn<{ imports: ImportBatch[] }>('wishlist', {
        action: 'list_imports',
        body: { limit },
    });
    return res?.imports ?? [];
}

export function useImportHistory(userId: string | null | undefined, limit = 30) {
    return useQuery({
        queryKey: queryKeys.importJobs.all(userId ?? 'anon'),
        queryFn: () => fetchImports(limit),
        enabled: !!userId,
        staleTime: 1000 * 60, // 1 min — imports land in bursts; keep it fresh-ish
    });
}
