/**
 * useImportBatch — the spots from one import batch (batch-detail screen).
 * Backed by the `wishlist` edge action `list_import_items`.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { WishlistSource } from '@/lib/types/wishlistSource';
export type ImportJobStatus = 'pending' | 'resolved' | 'needs_confirm' | 'failed';

export interface ImportBatchRestaurant {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    photo_url: string | null;
    cuisine: string | null;
    google_rating: number | null;
    price_level: number | null;
    external_id: string | null;
    lat: number | null;
    lng: number | null;
}

export interface ImportBatchItem {
    id: string;
    note: string | null;
    created_at: string;
    restaurant: ImportBatchRestaurant | null;
}

export interface ImportBatchDetail {
    job: {
        job_id: string;
        source: WishlistSource | null;
        status: ImportJobStatus;
        created_at: string;
    };
    items: ImportBatchItem[];
}

async function fetchBatch(jobId: string): Promise<ImportBatchDetail> {
    // callEdgeFn strips the outer { data } envelope → we receive { job, items }.
    return callEdgeFn<ImportBatchDetail>('wishlist', {
        action: 'list_import_items',
        body: { job_id: jobId },
    });
}

export function useImportBatch(jobId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.importJobs.detail(jobId ?? 'none'),
        queryFn: () => fetchBatch(jobId as string),
        enabled: !!jobId,
        staleTime: 1000 * 60,
    });
}
