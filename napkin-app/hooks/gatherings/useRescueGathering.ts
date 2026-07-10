/**
 * useRescueGathering — "it happened anyway — set the table" (TICKET-159).
 *
 * The HOST of an EXPIRED gathering creates the supper after the fact: the
 * `gatherings` edge fn `rescue` action re-checks host + expired + unlinked
 * under lock (fn_rescue_expired_gathering) and returns the canonical supper
 * with roster + member_count (SetTableResult shape — the same contract as
 * entry?action=set-table, so SetTableSheet's submit-adapter can take either).
 * Idempotent server-side: a repeat/concurrent completion returns the EXISTING
 * supper, never a second one. The gathering stays 'expired' and gains supper_id.
 *
 * Canonical mutation lifecycle (lib/mutations.md):
 *   onMutate  → cancel + snapshot gatherings.detail(id); optimistically set
 *               supper_id on the cached card (the footer flips to
 *               `see the table →` instantly); return the snapshot.
 *   onError   → restore the snapshot.
 *   onSuccess → reconcile the detail patch with the REAL supper id, then
 *               narrow-invalidate the caches whose server shape the patch
 *               can't synthesise: the Table feed (a brand-new supper card's
 *               keyset position — the set-table exception in mutations.md),
 *               the upcoming strip, and the fresh supper's detail key.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { GatheringCardActivity } from '@/hooks/tables/useTableActivity';
import type { SetTableResult } from '@/hooks/suppers';

export interface RescueGatheringInput {
    gathering_id: string;
    /** Needed for the narrow feed/upcoming invalidations. */
    table_id: string;
    /** Preselected crew (the gather's in/counter members; host toggles freely). */
    member_ids: string[];
}

/** One rescued seat (server also returns the roster alongside SetTableResult). */
export interface RescueRosterMember {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

/** SetTableResult + the seeded roster (finding 16). */
export interface RescueGatheringResult extends SetTableResult {
    roster: RescueRosterMember[];
}

interface MutationContext {
    previous?: GatheringCardActivity;
}

export function useRescueGathering() {
    const qc = useQueryClient();

    return useMutation<RescueGatheringResult, Error, RescueGatheringInput, MutationContext>({
        mutationFn: async (input) =>
            callEdgeFn<RescueGatheringResult>('gatherings', {
                action: 'rescue',
                body: {
                    gathering_id: input.gathering_id,
                    member_ids: input.member_ids,
                },
            }),

        onMutate: async (input): Promise<MutationContext> => {
            const key = queryKeys.gatherings.detail(input.gathering_id);
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<GatheringCardActivity>(key);
            if (previous) {
                // Optimistic: the expired card gains its supper link (footer flips
                // to `see the table →`). The placeholder id is reconciled below.
                qc.setQueryData<GatheringCardActivity>(key, {
                    ...previous,
                    supper_id: previous.supper_id ?? 'optimistic-rescue',
                });
            }
            return { previous };
        },

        onError: (_err, input, ctx) => {
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKeys.gatherings.detail(input.gathering_id), ctx.previous);
            }
        },

        onSuccess: (result, input) => {
            // Reconcile the optimistic placeholder with the REAL supper id.
            qc.setQueryData<GatheringCardActivity>(
                queryKeys.gatherings.detail(input.gathering_id),
                (old) => (old ? { ...old, supper_id: result.id } : old),
            );
            // invalidate: a brand-new supper feed card's keyset position (and the
            // rescued gathering card's server projection) can't be synthesised —
            // the set-table exception in lib/mutations.md. Narrow to this table.
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.upcoming(input.table_id) });
            // Seed/refresh the supper-detail cache for the new id (mirrors useSetTable).
            qc.invalidateQueries({ queryKey: queryKeys.suppers.detail(result.id) });
        },
    });
}
