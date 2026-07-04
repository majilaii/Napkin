/**
 * useCreateGathering — propose a future gathering at a restaurant to a Table
 * (TICKET-095 "Gather the table").
 *
 * Creates the gathering (server also auto-RSVPs the host 'in'). A new feed card
 * appears whose keyset position the client can't synthesise, so we invalidate
 * the Table activity feed rather than patch — the "server-assigned position"
 * exception in lib/mutations.md (same call as useSetTable).
 *
 * ALREADY_PROPOSED (409, one active proposal per table+restaurant) surfaces on
 * `error.cause.code` — use isAlreadyProposed(err) in the sheet to Alert
 * "already gathering for this spot."
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn, type UnwrappedError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface CreateGatheringInput {
    table_id: string;
    restaurant_id: string;
    /** YYYY-MM-DD — strictly after today (HKT), within 90 days. */
    gather_on: string;
    note?: string;
}

/** The raw gathering row the server returns (inside the { data } envelope). */
export interface GatheringRow {
    id: string;
    table_id: string;
    restaurant_id: string;
    host_user_id: string;
    note: string | null;
    gather_on: string;
    status: 'proposed' | 'dispatched' | 'cancelled' | 'expired';
    supper_id: string | null;
    created_at: string;
    updated_at: string;
}

/** True when the error is the 409 "one active proposal per spot" conflict. */
export function isAlreadyProposed(err: unknown): boolean {
    return (err as { cause?: UnwrappedError })?.cause?.code === 'ALREADY_PROPOSED';
}

export function useCreateGathering() {
    const qc = useQueryClient();

    return useMutation<GatheringRow, Error, CreateGatheringInput>({
        mutationFn: async (input) =>
            callEdgeFn<GatheringRow>('gatherings', {
                action: 'create',
                body: {
                    table_id: input.table_id,
                    restaurant_id: input.restaurant_id,
                    gather_on: input.gather_on,
                    ...(input.note ? { note: input.note } : {}),
                },
            }),
        onSuccess: (_result, input) => {
            // invalidate: a new feed card's keyset position is server-assigned —
            // the client can't synthesise it. Narrow: this table only.
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
        },
    });
}
