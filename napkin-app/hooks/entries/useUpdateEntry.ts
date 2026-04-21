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
                const { data: { session } } = await supabase.auth.getSession();
                const { data, error } = await supabase.functions.invoke('entry', {
                    body: { action: 'update-companions', entry_id: entryId, companion_ids },
                    headers: session?.access_token
                        ? { Authorization: `Bearer ${session.access_token}` }
                        : undefined,
                });
                if (error) throw error;
                if (data?.error) throw new Error(data.error);
                // If no scalar changes, return early
                if (Object.keys(scalarInput).length === 0) return data?.data;
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

        onSuccess: () => {
            // Invalidate detail only — feeds are intentionally not refreshed to
            // preserve sort order (see architectural decision #5).
            qc.invalidateQueries({ queryKey: queryKeys.entries.detail(entryId) });
        },
    });
}
