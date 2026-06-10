/**
 * useSaveImportSpots — TICKET-063 multi-spot save mutation.
 *
 * Calls resolve-url?action=save_spots (ARCH-REVIEW-2 #1: lives in resolve-url,
 * not table-shares) with a list of ticked candidates.
 *
 * Per-spot client_nonce generated at call time (post-auth, per ARCH-REVIEW-2 #12).
 * Job-level import_nonce comes from the caller (minted pre-auth and stashed).
 *
 * Follows canonical snapshot → patch → rollback → narrow refetch pattern
 * (napkin-app/lib/mutations.md).
 *
 * onMutate: optimistically prepends pending wishlist rows for each ticked spot.
 * onError: rolls back all patched caches.
 * onSuccess: narrow-invalidates wishlist.personal + per-table activity.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { ResolvedCandidate } from './useResolveUrl';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SaveImportSpotInput {
    candidate: ResolvedCandidate;
    /** Fresh uuid per spot, minted at save time (post-auth). */
    client_nonce: string;
    table_id?: string | null;
    table_client_nonce?: string | null;
}

export interface SaveImportSpotsInput {
    /** Job-level idempotency key, minted pre-auth at share receipt (ARCH-REVIEW-2 #12). */
    import_nonce: string;
    spots: SaveImportSpotInput[];
    /** Optional note — only applied if exactly one spot is ticked (AC: single-spot note). */
    note?: string;
    /** Source provenance (TikTok/Maps/web) for wishlist rows. */
    source?: Record<string, string>;
    /** Optional Table to post a coalesced digest card to. */
    table_id?: string | null;
}

export interface SpotSaveResult {
    candidate_id: string;
    client_nonce: string;
    status: 'saved' | 'already_pinned' | 'failed';
    wishlist_id?: string | null;
    restaurant_id?: string | null;
    error?: string;
}

export interface SaveImportSpotsResult {
    results: SpotSaveResult[];
    summary: {
        saved: number;
        already_pinned: number;
        failed: number;
    };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSaveImportSpots(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: SaveImportSpotsInput): Promise<SaveImportSpotsResult> => {
            const spots = input.spots.map((s) => ({
                candidate_id: s.candidate.candidate_id ?? s.client_nonce,
                client_nonce: s.client_nonce,
                restaurant_id: s.candidate.restaurant_id ?? null,
                external_id: s.candidate.restaurant_id
                    ? null
                    : (s.candidate.restaurant.external_id ?? null),
                restaurant_name: s.candidate.restaurant.name ?? null,
                restaurant_city: s.candidate.restaurant.city ?? null,
                table_id: s.table_id ?? null,
                table_client_nonce: s.table_client_nonce ?? null,
            }));

            return callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                action: 'save_spots',
                body: {
                    import_nonce: input.import_nonce,
                    spots,
                    note: input.note,
                    source: input.source,
                },
            });
        },

        onMutate: async (input: SaveImportSpotsInput) => {
            if (!userId) return {};

            const wishlistKey = queryKeys.wishlist.personal(userId);
            await queryClient.cancelQueries({ queryKey: wishlistKey });
            const previousWishlist = queryClient.getQueryData(wishlistKey);

            const now = new Date().toISOString();

            // Optimistically prepend pending rows for each ticked spot
            queryClient.setQueryData(wishlistKey, (old: any) => {
                if (!old) return old;
                const newRows = input.spots
                    .filter((s) => !s.candidate.already_wishlisted)
                    .map((s) => ({
                        id: `pending_spot_${s.client_nonce}`,
                        user_id: userId,
                        restaurant_id: s.candidate.restaurant_id ?? null,
                        note: input.note ?? null,
                        source: input.source ?? null,
                        created_at: now,
                        job_id: null,
                        extraction_status: s.candidate.restaurant_id ? 'resolved' : 'pending',
                        deletion_status: null,
                        restaurant: s.candidate.restaurant_id
                            ? { id: s.candidate.restaurant_id, name: s.candidate.restaurant.name }
                            : null,
                    }));

                if (!newRows.length) return old;

                if (Array.isArray(old)) {
                    return [...newRows, ...old];
                }
                if (old?.pages?.[0]) {
                    const newPages = [...old.pages];
                    newPages[0] = {
                        ...newPages[0],
                        rows: [...newRows, ...(newPages[0].rows ?? [])],
                    };
                    return { ...old, pages: newPages };
                }
                return old;
            });

            // Snapshot + optimistic-patch per-Table activity if a table_id is set
            const tableId = input.table_id;
            let previousTableActivity: unknown;
            if (tableId) {
                const actKey = queryKeys.tables.activityForTable(tableId);
                await queryClient.cancelQueries({ queryKey: actKey });
                previousTableActivity = queryClient.getQueryData(actKey);

                const optimisticDigest: any = {
                    id: `pending_digest_${input.import_nonce}`,
                    type: 'share_digest',
                    sort_date: now,
                    created_at: now,
                    table_id: tableId,
                    author: { user_id: userId, display_name: null, avatar_url: null },
                    childShares: input.spots.map((s) => ({
                        shareId: `pending_share_${s.client_nonce}`,
                        restaurant: s.candidate.restaurant,
                        extractionStatus: 'resolved',
                    })),
                    reaction_count: 0,
                    reactionCount: 0,
                    top_emojis: [],
                    topEmojis: [],
                };

                queryClient.setQueryData(actKey, (old: any) => {
                    if (!old) return old;
                    if (old?.pages?.[0]) {
                        const newPages = [...old.pages];
                        newPages[0] = {
                            ...newPages[0],
                            rows: [optimisticDigest, ...(newPages[0].rows ?? [])],
                        };
                        return { ...old, pages: newPages };
                    }
                    if (Array.isArray(old)) return [optimisticDigest, ...old];
                    return old;
                });
            }

            return { previousWishlist, previousTableActivity, tableId };
        },

        onError: (_err, input: SaveImportSpotsInput, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
            if (ctx?.tableId && ctx?.previousTableActivity !== undefined) {
                const actKey = queryKeys.tables.activityForTable(ctx.tableId);
                queryClient.setQueryData(actKey, ctx.previousTableActivity);
            }
        },

        onSuccess: (_result, input: SaveImportSpotsInput) => {
            if (!userId) return;
            // Narrow invalidation: personal wishlist + table activity if applicable.
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            if (input.table_id) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(input.table_id),
                });
            }
        },
    });
}
