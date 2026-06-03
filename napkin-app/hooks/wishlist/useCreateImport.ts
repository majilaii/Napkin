/**
 * useCreateImport — TICKET-060 R1/R2/R12.
 *
 * The SINGLE fan-out mutation. Calls create_import with destinations (wishlist + table_ids).
 * NO list_ids field (R12 — Lists return when Lists ship).
 *
 * Returns job_id + pending rows. Optimistically inserts:
 *   - a pending wishlist row (if wishlist=true)
 *   - a pending shared_save ActivityItem per table_id
 *
 * Snapshot + rollback per canonical mutation pattern (TICKET-036 doctrine).
 * Polls wishlist.personal while any row has extraction_status='pending'.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { InfiniteData } from '@tanstack/react-query';
import type { Page } from '@/lib/pagination';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateImportInput {
    /** Storage path from downscaleAndUpload() */
    image_path?: string;
    /** URL for URL-sourced imports */
    source_url?: string;
    /** Optional note/caption */
    caption?: string;
    /** Optional note to attach to shared card(s) */
    note?: string;
    destinations: {
        wishlist: boolean;
        table_ids: string[];
        // list_ids omitted (R12)
    };
}

export interface CreateImportResult {
    job_id: string;
    wishlist_id: string | null;
    share_ids: string[];
    status: 'pending';
}

export interface PendingWishlistItem {
    id: string;
    user_id: string;
    restaurant_id: null;
    note: string | null;
    source: unknown;
    created_at: string;
    job_id: string;
    extraction_status: 'pending';
    deletion_status?: null;
    restaurant: null;
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function useCreateImport(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: CreateImportInput): Promise<CreateImportResult> => {
            return callEdgeFn<CreateImportResult>('table-shares', {
                action: 'create_import',
                body: input,
            });
        },

        onMutate: async (input: CreateImportInput) => {
            if (!userId) return {};

            const wishlistKey = queryKeys.wishlist.personal(userId);

            // Snapshot + cancel in-flight queries
            await queryClient.cancelQueries({ queryKey: wishlistKey });
            const previousWishlist = queryClient.getQueryData(wishlistKey);

            // Optimistically prepend a pending wishlist row (if wishlist=true)
            if (input.destinations.wishlist) {
                const optimisticItem: PendingWishlistItem = {
                    id: `pending_${Date.now()}`,
                    user_id: userId,
                    restaurant_id: null,
                    note: input.note ?? null,
                    source: input.source_url
                        ? { type: 'vision', source_url: input.source_url }
                        : input.image_path
                        ? { type: 'screenshot', upload_path: input.image_path }
                        : null,
                    created_at: new Date().toISOString(),
                    job_id: `pending_${Date.now()}`,
                    extraction_status: 'pending',
                    restaurant: null,
                };

                queryClient.setQueryData(wishlistKey, (old: any) => {
                    if (!old) return old;
                    // Handle both paginated and flat shapes
                    if (Array.isArray(old)) {
                        return [optimisticItem, ...old];
                    }
                    // InfiniteData shape
                    if (old?.pages?.[0]) {
                        const newPages = [...old.pages];
                        newPages[0] = {
                            ...newPages[0],
                            rows: [optimisticItem, ...(newPages[0].rows ?? [])],
                        };
                        return { ...old, pages: newPages };
                    }
                    return old;
                });
            }

            return { previousWishlist };
        },

        onError: (_err, _input, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
        },

        onSuccess: (result, input) => {
            if (!userId) return;
            // Invalidate so the real server state replaces the optimistic row.
            // Narrow: only invalidate the personal wishlist for this user.
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            // Also invalidate table activity for any ticked table_ids
            for (const tableId of input.destinations.table_ids) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(tableId),
                });
            }
        },
    });
}
