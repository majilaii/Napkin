/**
 * useRsvpGathering — answer 'in' | 'out' on a gathering card (TICKET-095).
 *
 * Optimistic per lib/mutations.md: cancel → snapshot → patch → rollback. The
 * table-activity cache is InfiniteData whose pages are `{ rows }` ENVELOPES —
 * map `page.rows`, never `page.map` (that exact mistake caused a prod bug,
 * see project_post_interaction_drift). We patch every cached variant of this
 * table's feed (base key + filter variants) via setQueriesData on the
 * activityForTable prefix. No blanket invalidation — the server returns
 * { gathering_id, response }, which the patch already synthesised.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';

export interface RsvpGatheringInput {
    gathering_id: string;
    /** Needed to scope the cache patch to one table's feed. */
    table_id: string;
    response: 'in' | 'out';
}

export interface RsvpGatheringResult {
    gathering_id: string;
    response: 'in' | 'out';
}

/**
 * Pure patch: update the matching gathering card's viewer_response, the
 * viewer's seat, and recompute in_count from the patched seats (seats are the
 * CURRENT table roster, so counting them matches the server's semantics).
 * Seat ordering is left as-is — the server re-orders on the next refetch.
 * Exported for unit tests.
 */
export function patchGatheringRsvp<TData>(
    data: TData,
    gatheringId: string,
    viewerId: string,
    response: 'in' | 'out',
): TData {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    if (!d?.pages) return data;
    return {
        ...d,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pages: d.pages.map((p: any) =>
            p?.rows
                ? {
                      ...p,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      rows: p.rows.map((r: any) => {
                          if (r?.type !== 'gathering' || r?.id !== gatheringId) return r;
                          const card = r as GatheringCardActivity;
                          const seats = (card.seats ?? []).map((s: GatheringSeat) =>
                              s.user_id === viewerId ? { ...s, response } : s,
                          );
                          return {
                              ...card,
                              viewer_response: response,
                              seats,
                              in_count: seats.filter((s) => s.response === 'in').length,
                          };
                      }),
                  }
                : p,
        ),
    } as TData;
}

export function useRsvpGathering() {
    const qc = useQueryClient();
    const { user } = useAuth();

    return useMutation<RsvpGatheringResult, Error, RsvpGatheringInput>({
        mutationFn: async (input) =>
            callEdgeFn<RsvpGatheringResult>('gatherings', {
                action: 'rsvp',
                body: { gathering_id: input.gathering_id, response: input.response },
            }),

        onMutate: async (input) => {
            const activityKey = queryKeys.tables.activityForTable(input.table_id);
            await qc.cancelQueries({ queryKey: activityKey });
            // Snapshot every cached variant (base + filter keys) for rollback.
            const previous = qc.getQueriesData({ queryKey: activityKey });
            if (user?.id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                qc.setQueriesData<any>({ queryKey: activityKey }, (old: any) =>
                    patchGatheringRsvp(old, input.gathering_id, user.id, input.response),
                );
            }
            return { previous };
        },

        onError: (_err, _input, ctx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any)?.previous?.forEach(([key, data]: [readonly unknown[], unknown]) =>
                qc.setQueryData(key, data),
            );
        },

        // onSuccess: nothing — the patch already matches the server shape
        // ({ gathering_id, response }); no server-only data to reconcile.
    });
}
