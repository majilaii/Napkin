/**
 * useDeleteGathering — host clears a dead gathering off the table for good.
 *
 * Server path: `gatherings` `action:'delete'` — hard DELETE (rsvps cascade),
 * allowed for proposed / expired / cancelled and for a dispatched row whose
 * supper link died (supper_id null). A dispatched gathering with a live supper
 * is refused server-side (GATHERING_LOCKED).
 *
 * Mutate + narrow invalidate of that table's activity key, same shape as
 * useCancelGathering: row removal shifts keyset pages in ways a patch can't
 * synthesise — invalidation is the "cursor-order changes" exception in
 * lib/mutations.md. On a state-drift refusal (the card's status is stale) we
 * also invalidate so the card re-renders in its true state.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn, type UnwrappedError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface DeleteGatheringInput {
    gathering_id: string;
    /** Needed for the narrow feed invalidation. */
    table_id: string;
}

export interface DeleteGatheringResult {
    deleted: boolean;
}

/** Server refusals that mean the card was stale — refetch shows the truth. */
const DRIFT_CODES = new Set(['GATHERING_LOCKED', 'GATHERING_CLOSED', 'NOT_FOUND']);

export function isGatheringDrift(err: unknown): boolean {
    const code = (err as { cause?: UnwrappedError })?.cause?.code;
    return !!code && DRIFT_CODES.has(code);
}

export function useDeleteGathering() {
    const qc = useQueryClient();

    return useMutation<DeleteGatheringResult, Error, DeleteGatheringInput>({
        mutationFn: async (input) =>
            callEdgeFn<DeleteGatheringResult>('gatherings', {
                action: 'delete',
                body: { gathering_id: input.gathering_id },
            }),
        onSuccess: (_result, input) => {
            // invalidate: the row is gone server-side; narrow to this table.
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            // The upcoming strip also drops the deleted row (and its day-of reminder
            // reconciles away on the refetch) — nudge it, narrow to this table.
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.upcoming(input.table_id) });
            // Drop the detail cache so /gathering/[id] can't re-render the deleted
            // row as live (a re-entry re-fetches → get 404 → not-available).
            qc.removeQueries({ queryKey: queryKeys.gatherings.detail(input.gathering_id) });
        },
        onError: (error, input) => {
            // No optimistic patch to roll back — but a drift refusal means the
            // card lied about its status; resync it.
            if (isGatheringDrift(error)) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            }
        },
    });
}
