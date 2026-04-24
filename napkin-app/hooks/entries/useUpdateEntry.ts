/**
 * useUpdateEntry — entry edits via two paths (by design — see ticket TICKET-027):
 *
 *  1. Scalar-only fields (rating, content, etc.): direct supabase-js PATCH.
 *     RLS policy `entries_update_own` (auth.uid() = user_id) covers this.
 *     Optimistic patch is applied immediately.
 *
 *  2. companion_ids present: routes through the `entry` edge function
 *     (action='update-companions') because `entry_companions` is a join table
 *     that edge functions access via service-role (no direct-client RLS write path
 *     is needed from the app layer). Scalar fields can be bundled with this call.
 *
 * Invalidation: only queryKeys.entries.detail(entryId) — NOT tables.activity or
 * entries.list, to preserve feed sort order (created_at is the sort key; edits
 * should not resurface entries in Tablemate feeds).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

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
}

export function useUpdateEntry(entryId: string) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: UpdateEntryInput) => {
            const { companion_ids, ...scalarInput } = input;

            if (companion_ids !== undefined) {
                // Companion edit path — edge function (service role)
                const result = await callEdgeFn<unknown>('entry', {
                    action: 'update-companions',
                    body: { entry_id: entryId, companion_ids },
                });
                // If no scalar changes, return early
                if (Object.keys(scalarInput).length === 0) return result;
            }

            // Scalar edit path — direct PATCH (only when there are scalar fields to update)
            if (Object.keys(scalarInput).length === 0) return null;

            const { data, error } = await supabase
                .from('entries')
                .update({
                    ...scalarInput,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', entryId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        onMutate: async (input) => {
            // Cancel any in-flight queries for this entry
            await qc.cancelQueries({ queryKey: queryKeys.entries.detail(entryId) });

            // Snapshot current cache for rollback
            const previous = qc.getQueryData(queryKeys.entries.detail(entryId));

            // Optimistically patch the detail cache — only scalar fields
            const { companion_ids: _companions, ...scalarPatch } = input;
            if (Object.keys(scalarPatch).length > 0) {
                qc.setQueryData(queryKeys.entries.detail(entryId), (old: any) => {
                    if (!old) return old;
                    return { ...old, ...scalarPatch };
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

        onSuccess: (_data, input) => {
            // Invalidate detail so it refetches the canonical row (companions, etc).
            qc.invalidateQueries({ queryKey: queryKeys.entries.detail(entryId) });

            // TICKET-036 P1-5: scalar edits should appear immediately on the
            // feed card and the table activity card. Without this patch the
            // user edits content/rating, navigates back, and sees the stale
            // value until the next staleTime expiry.
            const { companion_ids: _ignored, ...scalarPatch } = input;
            if (Object.keys(scalarPatch).length === 0) return;

            const patchEntry = (e: any) => (e?.id === entryId ? { ...e, ...scalarPatch } : e);

            // feed (useQuery → { entries }) and feed (useCursorPagedQuery → { pages })
            qc.setQueriesData<any>({ queryKey: queryKeys.feed.rootAll() }, (data: any) => {
                if (!data) return data;
                if (data.pages) {
                    return { ...data, pages: data.pages.map((p: any) => ({ ...p, rows: p.rows?.map(patchEntry) ?? p.rows })) };
                }
                if (data.entries) return { ...data, entries: data.entries.map(patchEntry) };
                return data;
            });

            // tableActivity (useInfiniteQuery → { pages: ActivityItem[][] })
            qc.setQueriesData<{ pages?: any[][] }>(
                { queryKey: queryKeys.tables.activityAll() },
                (data) => {
                    if (!data?.pages) return data;
                    return { ...data, pages: data.pages.map((page) => page.map(patchEntry)) };
                },
            );

            // No userId in scope here; mySolo cache uses the entry's user_id which
            // we don't have access to without an extra fetch. The detail invalidation
            // covers any user navigating to detail; the feed patches above cover the
            // visible-list case for the current user.
        },
    });
}
