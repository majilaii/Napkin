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

/**
 * Full Places payload forwarded to the server for metadata-complete upserts.
 * Mirrors TopFourPlacePayload shape pattern (fix-pass-2 item 3).
 * When present, the server upserts the restaurant with ALL fields rather than
 * name+city only — prevents metadata regression on first-time saves.
 */
export interface SaveImportPlacePayload {
    external_id?: string | null;
    name?: string | null;
    location?: { address?: string; locality?: string; country?: string };
    latitude?: number | null;
    longitude?: number | null;
    photoReference?: string | null;
    photoAttributionHtml?: string | null;
    googleRating?: number | null;
    googleRatingCount?: number | null;
    priceLevel?: number | null;
    cuisine?: string | null;
}

export interface SaveImportSpotInput {
    candidate: ResolvedCandidate;
    /** Fresh uuid per spot, minted at save time (post-auth). */
    client_nonce: string;
    table_id?: string | null;
    table_client_nonce?: string | null;
    /**
     * Full Places payload from the resolved candidate (fix-pass-2 item 3).
     * When present, the server upserts with all metadata; absent → name+city only.
     */
    place?: SaveImportPlacePayload | null;
}

export interface SaveImportSpotsInput {
    /** Job-level idempotency key, minted pre-auth at share receipt (ARCH-REVIEW-2 #12). */
    import_nonce: string;
    spots: SaveImportSpotInput[];
    /** Optional note — only applied if exactly one spot is ticked (AC: single-spot note). */
    note?: string;
    /** Source provenance (TikTok/Maps/web) for wishlist rows. */
    source?: Record<string, string>;
    /**
     * TICKET-072: when present, the server re-checks revocation immediately before
     * writing and constructs the source authoritatively from the share row (ARCH-2 #1/#4).
     * A revoked token → all spots return SHARE_REVOKED.
     */
    handoff_token?: string;
    // NOTE: top-level table_id removed (TICKET-063 fix-pass-1 item 12).
    // The mutationFn never sent it to the edge function — it was a dead field
    // that keyed off an unimplemented CTA and created a latent feed-cache landmine.
    // Per-spot table_id plumbing is preserved in SaveImportSpotInput for TICKET-063b.
}

export interface SpotSaveResult {
    candidate_id: string;
    client_nonce: string;
    /** 'ghost' = list-only save (pin_wishlist=false): restaurant upserted +
     * restaurant_id returned for list routing, deliberately NOT wishlisted. */
    status: 'saved' | 'already_pinned' | 'ghost' | 'failed';
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
        /** Only non-zero on pin_wishlist=false (list-only) saves. */
        ghost?: number;
    };
    /** Server batch id (minted on import_nonce) — deep-link target for
     * /imports/[jobId] review/fix. Optional: older deploys omit it. */
    job_id?: string | null;
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
                // Fix-pass-2 item 3: forward full place payload for metadata-complete upserts.
                place: s.place ?? null,
            }));

            return callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                action: 'save_spots',
                body: {
                    import_nonce: input.import_nonce,
                    spots,
                    note: input.note,
                    source: input.source,
                    // TICKET-072: pass through when present; server gates revoke + constructs source
                    ...(input.handoff_token ? { handoff_token: input.handoff_token } : {}),
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
                    // wishlist.personal pages are { data, next_cursor } (plain
                    // useInfiniteQuery in useMyWishlist) — field is `data`, not
                    // `rows`. Writing `rows` here silently no-ops the optimistic prepend.
                    const newPages = [...old.pages];
                    newPages[0] = {
                        ...newPages[0],
                        data: [...newRows, ...(newPages[0].data ?? [])],
                    };
                    return { ...old, pages: newPages };
                }
                return old;
            });

            // NOTE: top-level table_id optimistic digest patch removed (fix-pass-1 item 12).
            // The mutationFn never sent table_id to the edge function — the patch was dead
            // code and a latent feed-cache landmine. Per-spot table_id is preserved.

            return { previousWishlist };
        },

        onError: (_err, _input: SaveImportSpotsInput, ctx: any) => {
            if (!userId) return;
            const wishlistKey = queryKeys.wishlist.personal(userId);
            if (ctx?.previousWishlist !== undefined) {
                queryClient.setQueryData(wishlistKey, ctx.previousWishlist);
            }
        },

        onSuccess: (_result, input: SaveImportSpotsInput) => {
            if (!userId) return;
            // Narrow invalidation: personal wishlist.
            queryClient.invalidateQueries({
                queryKey: queryKeys.wishlist.personal(userId),
            });
            // TICKET-063b: when spots carry a table_id, narrowly invalidate that
            // table's activity feed so the shared-spot digest card surfaces.
            // NO optimistic digest patch (spec AC: skip optimistic on share).
            const tableIds = new Set<string>(
                input.spots
                    .filter((s): s is SaveImportSpotInput & { table_id: string } =>
                        typeof s.table_id === 'string' && s.table_id.length > 0,
                    )
                    .map((s) => s.table_id),
            );
            for (const tid of tableIds) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(tid),
                });
            }
        },
    });
}
