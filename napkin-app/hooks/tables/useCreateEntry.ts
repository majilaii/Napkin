/**
 * Hook to create a meal log entry.
 * Calls the entry edge function which handles restaurant upsert,
 * table sharing, and user_restaurant_status updates.
 *
 * TICKET-037 (P2-13): reads optional `warnings` from response and surfaces
 * a toast when companion tagging partially fails.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/providers/ToastProvider';

export interface CreateEntryInput {
    restaurant?: {
        external_id: string;
        name: string;
        location?: {
            address?: string;
            locality?: string;
            country?: string;
        };
        types?: string[];
        latitude?: number;
        longitude?: number;
        photoReference?: string;
    };
    rating?: number | null;
    content?: string;
    dish_description?: string;
    cooked_by?: string;
    visited_at?: string;
    table_id?: string;
    visibility?: 'private' | 'friends' | 'table' | 'both';
    participant_ids?: string[];
    /** Companion tagging — who was there (distinct from Round participant_ids) */
    companion_ids?: string[];
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
    photo_url?: string;
    photo_urls?: string[];
}

async function createEntry(input: CreateEntryInput): Promise<any> {
    // The entry edge function returns { data: EntryRow, warnings?: [...] }.
    // callEdgeFn returns whatever's at `data.data` — we lose `warnings`.
    // Fall back to direct invoke for this one call so we can read the warnings
    // envelope. (Acceptable exception to the callEdgeFn doctrine — documented
    // here, and warnings is a TICKET-037 P2-13 quirk that the helper API
    // doesn't yet expose. If a third hook needs envelope access we'll
    // generalize callEdgeFn to return { data, meta }.)
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('entry', {
        body: input,
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const entryRow = data?.data ?? {};
    if (data?.warnings) {
        (entryRow as any).__warnings = data.warnings;
    }
    return entryRow;
}

export function useCreateEntry(userId?: string | null, tableId?: string | null) {
    const qc = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: createEntry,
        onSuccess: (result) => {
            // Surface companion tag failures as a non-blocking toast (TICKET-037 P2-13)
            const warnings: Array<{ type: string }> | undefined = (result as any)?.__warnings;
            if (warnings?.some((w) => w.type === 'companion_tag_failed')) {
                toast.show("Couldn't tag some friends.");
            }

            if (userId) {
                qc.invalidateQueries({ queryKey: queryKeys.entries.list(userId) });
                qc.invalidateQueries({ queryKey: queryKeys.entries.mySolo(userId) });
                // Any day-page currently mounted must refresh to show the new slot.
                // Prefix match against ['entriesForDay', userId, ...] across dates.
                qc.invalidateQueries({ queryKey: queryKeys.entries.forDayAll(userId) });
                qc.invalidateQueries({ queryKey: queryKeys.feed.all(userId) });
            }
            if (tableId) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activity(tableId) });
                qc.invalidateQueries({ queryKey: queryKeys.atlas.index(tableId) });
                // (was duplicate ['atlas', tableId] literal — same as atlas.index, removed)
            }
        },
    });
}
