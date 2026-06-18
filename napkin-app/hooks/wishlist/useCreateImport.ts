/**
 * useCreateImport — TICKET-060 R1/R2/R12.
 *
 * The SINGLE fan-out mutation. Calls create_import with destinations (wishlist + table_ids).
 * NO list_ids field (R12 — Lists return when Lists ship).
 *
 * Returns job_id + pending rows. Optimistically inserts:
 *   - a pending wishlist row (if wishlist=true)
 *   - a pending shared_save ActivityItem per table_id (M-2 fix)
 *
 * Snapshot + rollback per canonical mutation pattern (TICKET-036 doctrine).
 * onSuccess invalidates table activity for all ticked Tables (M-2 fix).
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

            const now = new Date().toISOString();
            const pendingId = `pending_${Date.now()}`;
            const wishlistKey = queryKeys.wishlist.personal(userId);

            // Snapshot + cancel in-flight queries
            await queryClient.cancelQueries({ queryKey: wishlistKey });
            const previousWishlist = queryClient.getQueryData(wishlistKey);

            // Snapshot activity caches for all ticked Tables (M-2 fix)
            const previousActivities: Record<string, unknown> = {};
            for (const tableId of input.destinations.table_ids) {
                // [M-1 FIX] Use activityForTable (not activityAll) so the exact cache key is hit
                const actKey = queryKeys.tables.activityForTable(tableId);
                await queryClient.cancelQueries({ queryKey: actKey });
                previousActivities[tableId] = queryClient.getQueryData(actKey);
            }

            // Optimistically prepend a pending wishlist row (if wishlist=true)
            if (input.destinations.wishlist) {
                const optimisticItem: PendingWishlistItem = {
                    id: pendingId,
                    user_id: userId,
                    restaurant_id: null,
                    note: input.note ?? null,
                    source: input.source_url
                        ? { type: 'vision', source_url: input.source_url }
                        : input.image_path
                        ? { type: 'screenshot', upload_path: input.image_path }
                        : null,
                    created_at: now,
                    job_id: pendingId,
                    extraction_status: 'pending',
                    restaurant: null,
                };

                queryClient.setQueryData(wishlistKey, (old: any) => {
                    if (!old) return old;
                    // Handle both paginated and flat shapes
                    if (Array.isArray(old)) {
                        return [optimisticItem, ...old];
                    }
                    // InfiniteData shape. wishlist.personal pages are
                    // { data: PersonalWishlistItem[], next_cursor } (useMyWishlist is
                    // a plain useInfiniteQuery, NOT useCursorPagedQuery) — the field
                    // is `data`, not `rows`. Writing `rows` here silently no-ops.
                    if (old?.pages?.[0]) {
                        const newPages = [...old.pages];
                        newPages[0] = {
                            ...newPages[0],
                            data: [optimisticItem, ...(newPages[0].data ?? [])],
                        };
                        return { ...old, pages: newPages };
                    }
                    return old;
                });
            }

            // [M-2 FIX] Optimistically insert a pending shared_save ActivityItem into
            // each ticked Table's activity feed so the Table feed shows the pending card immediately.
            for (const tableId of input.destinations.table_ids) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                const optimisticSharedSave: any = {
                    id: `pending_share_${tableId}_${Date.now()}`,
                    type: 'shared_save',
                    sort_date: now,
                    created_at: now,
                    table_id: tableId,
                    author: { user_id: userId, display_name: null, avatar_url: null },
                    restaurant: null,
                    note: input.note ?? null,
                    extraction_status: 'pending',
                    extractionStatus: 'pending',
                    reaction_count: 0,
                    reactionCount: 0,
                    top_emojis: [],
                    topEmojis: [],
                    my_reactions: [],
                    myReactions: [],
                    shareId: `pending_share_${tableId}_${Date.now()}`,
                };

                queryClient.setQueryData(actKey, (old: any) => {
                    if (!old) return old;
                    if (old?.pages?.[0]) {
                        const newPages = [...old.pages];
                        newPages[0] = {
                            ...newPages[0],
                            rows: [optimisticSharedSave, ...(newPages[0].rows ?? [])],
                        };
                        return { ...old, pages: newPages };
                    }
                    if (Array.isArray(old)) {
                        return [optimisticSharedSave, ...old];
                    }
                    return old;
                });
            }

            return { previousWishlist, previousActivities };
        },

        onError: (_err, input: CreateImportInput, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
            // Roll back all patched activity caches
            for (const tableId of input.destinations.table_ids) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                const prev = ctx?.previousActivities?.[tableId];
                if (prev !== undefined) {
                    queryClient.setQueryData(actKey, prev);
                }
            }
        },

        onSuccess: (_result, input) => {
            if (!userId) return;
            // Invalidate so the real server state replaces the optimistic row.
            // Narrow: only invalidate the personal wishlist for this user.
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            // [M-2 FIX] Invalidate table activity for each ticked Table.
            // This replaces the optimistic pending card with the real server-created row
            // and will trigger a focus-poll if extraction is still in progress.
            for (const tableId of input.destinations.table_ids) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(tableId),
                });
            }
        },
    });
}
