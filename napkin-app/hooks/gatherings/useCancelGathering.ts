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
import { isGatheringDrift } from './useDeleteGathering';

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
            // The upcoming strip also drops the cancelled row (and its day-of reminder
            // reconciles away on the refetch) — nudge it, narrow to this table.
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.upcoming(input.table_id) });
        },
        onError: (error, input) => {
            // GATHERING_CLOSED = the card's 'proposed' was stale (dispatch or
            // expiry won). No patch to roll back — resync so the card re-renders
            // in its true state (where the clear affordance takes over).
            if (isGatheringDrift(error)) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            }
        },
    });
}
