/**
 * useSetTable — create a Supper v2 "empty table" (TICKET-082 v2).
 *
 * The v2 create path: pick a restaurant + a crew (drawn from a Table's members) and
 * "set the table" — NO review. The server inserts the suppers anchor (table-scoped)
 * and seeds supper_members (host + crew). Everyone, including the host, starts as an
 * empty seat; takes attach later via useAddSupperTake. This replaces the old
 * "log a meal + make-this-a-Supper toggle" path.
 *
 * Creating a supper produces a brand-new feed card whose keyset position the client
 * can't synthesise, so we invalidate the Table activity feed rather than patch
 * (the "server-assigned position" exception in lib/mutations.md). We also drop the
 * supper-detail cache for the fresh id so the confirmation screen reads live state.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { SupperAnchor } from './useSupper';

export interface SetTableInput {
    table_id: string;
    restaurant_id: string;
    /** Picked crew (Table members). The host is always added server-side. */
    member_ids: string[];
}

/** Server returns the anchor + the seeded member count. */
export interface SetTableResult extends SupperAnchor {
    member_count: number;
}

async function setTable(input: SetTableInput): Promise<SetTableResult> {
    return callEdgeFn<SetTableResult>('entry', {
        action: 'set-table',
        body: {
            table_id: input.table_id,
            restaurant_id: input.restaurant_id,
            member_ids: input.member_ids,
        },
    });
}

export function useSetTable() {
    const qc = useQueryClient();

    return useMutation<SetTableResult, Error, SetTableInput>({
        mutationFn: setTable,
        onSuccess: (result, input) => {
            // New feed card — invalidate the whole Table feed (all filter variants).
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            // Seed/refresh the supper-detail cache for the new id.
            qc.invalidateQueries({ queryKey: queryKeys.suppers.detail(result.id) });
        },
    });
}
