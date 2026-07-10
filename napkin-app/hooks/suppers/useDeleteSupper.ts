/**
 * useDeleteSupper — the host deletes a supper card; its takes re-home as
 * individual reviews still visible in the Table feed (TICKET-161).
 *
 * Server path: `entry` `action:'delete-supper'` — service-role, host-only. For a
 * v2 supper (table_id set) the server inserts an entry_tables share edge for
 * every roster-authored take (posted_at = the take's created_at) BEFORE deleting
 * the anchor, so each take resurfaces as an ordinary entry card at its original
 * sort position instead of dropping into private-solo limbo. The take `entries`
 * rows are never mutated.
 *
 * Mutate + narrow invalidate of that table's activity key (same shape as
 * useDeleteGathering): a row removal shifts keyset pages in ways a patch can't
 * synthesise — invalidation is the "cursor-order changes" exception in
 * lib/mutations.md. There is no onMutate optimistic patch (nothing to roll
 * back). The supper-detail cache is dropped OUTRIGHT (removeQueries) so a stale
 * re-entry can't flash the deleted supper back into view.
 *
 * A double-tap / already-deleted supper returns a generic 404 (NOT_FOUND) — the
 * same refusal a stranger gets (no enumeration). isSupperGone(err) lets callers
 * treat that as benign success (already gone → navigate back).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn, type UnwrappedError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface DeleteSupperInput {
    supper_id: string;
    /**
     * The Table this supper belongs to; null for legacy v1 suppers. Drives the
     * narrow feed invalidation (v1 has no Table feed to nudge).
     */
    table_id: string | null;
}

export interface DeleteSupperResult {
    deleted: boolean;
}

/** A NOT_FOUND refusal means the supper is already gone — benign for a double-tap. */
export function isSupperGone(err: unknown): boolean {
    return (err as { cause?: UnwrappedError })?.cause?.code === 'NOT_FOUND';
}

export function useDeleteSupper() {
    const qc = useQueryClient();

    return useMutation<DeleteSupperResult, Error, DeleteSupperInput>({
        mutationFn: async (input) =>
            callEdgeFn<DeleteSupperResult>('entry', {
                action: 'delete-supper',
                body: { supper_id: input.supper_id },
            }),
        onSuccess: (_result, input) => {
            // The supper card is gone server-side; narrow to this table (a row
            // removal shifts keyset pages — invalidate, don't patch). Re-homed
            // takes surface as ordinary entry cards on the same refetch.
            if (input.table_id) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            }
            // Drop the detail cache so /supper/[id] can't re-render the deleted
            // supper (a re-entry re-fetches → 404 → "this table isn't available").
            qc.removeQueries({ queryKey: queryKeys.suppers.detail(input.supper_id) });
        },
    });
}
