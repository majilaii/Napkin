/**
 * useUpdateEntry — direct supabase-js PATCH on the entries table.
 *
 * Architecture decision: uses client-session UPDATE (not edge function) because
 * the `entries_update_own` RLS policy (auth.uid() = user_id) is already in place.
 * The editable fields are all scalar columns with no side-effects on join tables.
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
}

export function useUpdateEntry(entryId: string) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: UpdateEntryInput) => {
            const { data, error } = await supabase
                .from('entries')
                .update({
                    ...input,
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

            // Optimistically patch the detail cache
            qc.setQueryData(queryKeys.entries.detail(entryId), (old: any) => {
                if (!old) return old;
                return { ...old, ...input };
            });

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
