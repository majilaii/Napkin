/**
 * useCancelGathering — host calls off a proposed gathering (TICKET-095).
 *
 * Simple mutate + narrow invalidate of that table's activity key: the card is
 * excluded server-side once cancelled (fn_table_activity_page filters
 * status <> 'cancelled'), so a refetch makes it disappear. Row removal shifts
 * keyset pages in ways a patch can't synthesise — invalidation is the
 * "cursor-order changes" exception in lib/mutations.md.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface CancelGatheringInput {
    gathering_id: string;
    /** Needed for the narrow feed invalidation. */
    table_id: string;
}

export interface CancelGatheringResult {
    cancelled: boolean;
}

export function useCancelGathering() {
    const qc = useQueryClient();

    return useMutation<CancelGatheringResult, Error, CancelGatheringInput>({
        mutationFn: async (input) =>
            callEdgeFn<CancelGatheringResult>('gatherings', {
                action: 'cancel',
                body: { gathering_id: input.gathering_id },
            }),
        onSuccess: (_result, input) => {
            // invalidate: cancelled rows drop server-side; narrow to this table.
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
        },
    });
}
