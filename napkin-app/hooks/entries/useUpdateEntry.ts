/**
 * useUpdateEntry — entry edits via two paths (by design — see ticket TICKET-027):
 *
 *  1. Non-image scalar fields (rating, content, etc.): direct supabase-js PATCH.
 *     RLS policy `entries_update_own` (auth.uid() = user_id) covers this.
 *     Optimistic patch is applied immediately.
 *
 *  2. `photo_url` routes through `set_entry_hero`, which commits the hero sink
 *     and registry ref transactionally. Companion edits route through
 *     `update-companions` because `entry_companions` is a service-written join
 *     table. Scalar fields remain on the direct, explicitly image-free path.
 *
 * Invalidation: entry detail plus server-derived profile/Spots/Taste aggregates.
 * Table activity and entries.list stay patched in place so edits do not
 * resurface entries in feeds sorted by created_at.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import {
    invalidateEntryTasteCaches,
    invalidateRestaurantEntryCaches,
} from './invalidateEntryTaste';

export interface UpdateEntryInput {
    rating?: number | null;
    content?: string | null;
    dish_description?: string | null;
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
    /** Denormalised hero photo — patch after entry_photos write */
    photo_url?: string | null;
    /**
     * When present, route companion update through the edge function.
     * Pass empty array [] to remove all companions.
     */
    companion_ids?: string[];
    /**
     * Client-only companion rows used to update the review immediately while the
     * edge function persists `companion_ids`. Never sent to Supabase.
     */
    optimisticCompanions?: { user_id: string; display_name: string }[];
}

export function useUpdateEntry(
    entryId: string,
    restaurantId?: string | null,
    userId?: string | null,
) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: UpdateEntryInput) => {
            const {
                companion_ids,
                optimisticCompanions: _previews,
                photo_url,
                ...scalarInput
            } = input;
            const hasPhotoUrl = Object.prototype.hasOwnProperty.call(input, 'photo_url');
            let result: unknown = null;

            if (companion_ids !== undefined) {
                // Companion edit path — edge function (service role)
                result = await callEdgeFn<unknown>('entry', {
                    action: 'update-companions',
                    body: { entry_id: entryId, companion_ids },
                });
            }

            if (hasPhotoUrl) {
                // Image hero + ref binding must commit inside the flag-aware writer.
                const heroResult = await callEdgeFn<{
                    id: string;
                    photo_url: string | null;
                } | null>('entry', {
                    action: 'set_entry_hero',
                    body: { entry_id: entryId, photo_url: photo_url ?? null },
                });
                if (
                    !heroResult
                    || heroResult.id !== entryId
                    || (heroResult.photo_url !== null && typeof heroResult.photo_url !== 'string')
                ) {
                    throw new Error('set_entry_hero returned an invalid result');
                }
                result = heroResult;
            }

            // Direct PATCH is intentionally image-free before B-2 revokes land.
            if (Object.keys(scalarInput).length === 0) return result;

            // TICKET-043: explicit column list excludes table_id (column-level revoke
            // prevents authenticated from reading entries.table_id directly).
            const { data, error } = await supabase
                .from('entries')
                .update({
                    ...scalarInput,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', entryId)
                .select(`
                    id, user_id, restaurant_id, rating, content, dish_description,
                    visited_at, created_at, updated_at, table_night_id, visibility,
                    vibe_rating, flavor_rating, service_rating, value_rating,
                    photo_url, client_nonce, reaction_count, comment_count,
                    top_emojis, public_reaction_count, public_reply_count, public_top_emojis
                `)
                .single();

            if (error) throw error;
            return data ?? result;
        },

        onMutate: async (input) => {
            // Cancel any in-flight queries for this entry
            await qc.cancelQueries({ queryKey: queryKeys.entries.detail(entryId) });

            // Snapshot current cache for rollback
            const previous = qc.getQueryData(queryKeys.entries.detail(entryId));

            // Optimistically patch the detail cache. Companion names are supplied
            // by the picker because the mutation only persists IDs.
            const {
                companion_ids: _companions,
                optimisticCompanions,
                ...scalarPatch
            } = input;
            if (Object.keys(scalarPatch).length > 0 || optimisticCompanions !== undefined) {
                qc.setQueryData(queryKeys.entries.detail(entryId), (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        ...scalarPatch,
                        ...(optimisticCompanions !== undefined
                            ? { companions: optimisticCompanions }
                            : {}),
                    };
                });
            }

            return { previous };
        },

        onError: (_err, _input, context) => {
            // Roll back optimistic update
            if (context?.previous !== undefined) {
                qc.setQueryData(queryKeys.entries.detail(entryId), context.previous);
            }
        },

        onSuccess: (data, input) => {
            // Companion edits already carry the exact display rows selected by the
            // user. Mark the detail stale for the next mount/focus, but do not
            // immediately refetch the active screen: that refetch can replace the
            // optimistic names with an older join-table snapshot and make a saved
            // companion appear to vanish. Scalar-only edits can reconcile now.
            void qc.invalidateQueries({
                queryKey: queryKeys.entries.detail(entryId),
                ...(input.companion_ids !== undefined ? { refetchType: 'none' as const } : {}),
            });

            // TICKET-036 P1-5: scalar edits should appear immediately on the
            // feed card and the table activity card. Without this patch the
            // user edits content/rating, navigates back, and sees the stale
            // value until the next staleTime expiry.
            const {
                companion_ids: _ignored,
                optimisticCompanions: _ignoredPreviews,
                ...scalarPatch
            } = input;
            const { photo_url: _ignoredPhoto, ...tasteScalarPatch } = scalarPatch;

            // Entry detail knows the owner and restaurant even when a writer
            // response is intentionally narrow (companions / hero photo).
            const resultRow = data as {
                user_id?: string;
                restaurant_id?: string | null;
            } | null;
            const ownerId = resultRow?.user_id ?? userId;
            const resolvedRestaurantId = resultRow?.restaurant_id ?? restaurantId ?? null;

            if (Object.keys(scalarPatch).length === 0) {
                if (ownerId) {
                    invalidateRestaurantEntryCaches(qc, ownerId, resolvedRestaurantId);
                }
                return;
            }

            const patchEntry = (e: any) => (e?.id === entryId ? { ...e, ...scalarPatch } : e);

            // The PATCH already persisted server-side; a glitch in these
            // list-cache reconciles must never surface as an error on a saved edit.
            try {
                // feed (useQuery → { entries }) and feed (useCursorPagedQuery → { pages })
                qc.setQueriesData<any>({ queryKey: queryKeys.feed.rootAll() }, (data: any) => {
                    if (!data) return data;
                    if (data.pages) {
                        return { ...data, pages: data.pages.map((p: any) => ({ ...p, rows: p.rows?.map(patchEntry) ?? p.rows })) };
                    }
                    if (data.entries) return { ...data, entries: data.entries.map(patchEntry) };
                    return data;
                });

                // tableActivity (useCursorPagedQuery → { pages: Page<ActivityItem>[] }
                // where each page is the canonical { rows, next_cursor, has_more }
                // envelope — NOT a raw array. Mapping page.map() here treated the page
                // as an array and threw "undefined is not a function" on every scalar
                // edit (same class as the usePostInteractions bug fixed in 5bb6c6d).
                qc.setQueriesData<any>(
                    { queryKey: queryKeys.tables.activityAll() },
                    (data: any) => {
                        if (!data?.pages) return data;
                        return { ...data, pages: data.pages.map((page: any) => ({ ...page, rows: (page.rows ?? []).map(patchEntry) })) };
                    },
                );
            } catch (reconcileErr: any) {
                console.warn('[useUpdateEntry] list-cache reconcile skipped:', reconcileErr?.message);
            }

            if (Object.keys(tasteScalarPatch).length === 0) {
                if (ownerId) {
                    invalidateRestaurantEntryCaches(qc, ownerId, resolvedRestaurantId);
                }
                return;
            }

            if (ownerId) {
                invalidateEntryTasteCaches(qc, ownerId, {
                    restaurantId: resolvedRestaurantId,
                });
            }

            // mySolo cache still isn't reconciled here (uses the entry's user_id
            // per-row shape); the detail invalidation covers detail views and the
            // feed patches above cover the visible-list case for the current user.
        },
    });
}
