/**
 * useMarkWelcomed — one-shot dismiss of the "added to Table" welcome banner (TICKET-029).
 *
 * Mirrors the shape of useMarkSeen.
 * Optimistic: immediately removes the banner from the cached table detail so
 * it disappears without waiting for the server round-trip.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface MarkWelcomedInput {
    tableId: string;
}

async function markWelcomed(input: MarkWelcomedInput): Promise<void> {
    await callEdgeFn<void>('table-management', {
        action: 'mark_welcomed',
        body: { table_id: input.tableId },
    });
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
