/**
 * useMarkWelcomed — one-shot dismiss of the "added to Table" welcome banner (TICKET-029).
 *
 * Mirrors the shape of useMarkSeen.
 * Optimistic: immediately removes the banner from the cached table detail so
 * it disappears without waiting for the server round-trip.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface MarkWelcomedInput {
    tableId: string;
}

async function markWelcomed(input: MarkWelcomedInput): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke(
        'table-management?action=mark_welcomed',
        {
            method: 'POST',
            body: { table_id: input.tableId },
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
}

export function useMarkWelcomed() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, MarkWelcomedInput>({
        mutationFn: markWelcomed,

        onMutate: async ({ tableId }) => {
            // Optimistic: set caller_welcomed_at to a non-null string so the banner hides
            const key = queryKeys.tables.detail(tableId);
            const prev = queryClient.getQueryData(key);
            queryClient.setQueryData(key, (old: any) => {
                if (!old) return old;
                return { ...old, caller_welcomed_at: new Date().toISOString() };
            });
            return { prev };
        },

        onError: (_err, { tableId }, context: any) => {
            // Roll back the optimistic update on failure
            if (context?.prev !== undefined) {
                queryClient.setQueryData(queryKeys.tables.detail(tableId), context.prev);
            }
        },
    });
}
