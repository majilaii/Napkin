/**
 * useRescheduleGathering — the host moves a proposed gathering to a new date
 * (TICKET-127 AC8).
 *
 * Server semantics (`gatherings` action 'reschedule'): counters whose counter_on
 * = the new date flip to 'in' (counter_on cleared); every prior 'in' is DELETED
 * (reset to unanswered — they agreed to a different day) EXCEPT the host, who is
 * re-asserted 'in' (they chose the new date); 'out' and counters for other dates
 * persist; rescheduled_from records the old date.
 *
 * Optimistic per lib/mutations.md: the card sort_date is created_at, so the feed
 * position never moves on a re-date — the whole change is a within-row rewrite the
 * client CAN synthesise (patchGatheringReschedule applies the exact reset rules).
 * No invalidation: onSuccess has nothing the patch didn't already produce.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn, type UnwrappedError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type {
    GatheringCardActivity,
    GatheringSeat,
    GatheringCounter,
} from '@/hooks/tables/useTableActivity';
import type { GatheringRow } from './useCreateGathering';

export interface RescheduleGatheringInput {
    gathering_id: string;
    /** Needed to scope the cache patch to one table's feed. */
    table_id: string;
    /** The new day ('YYYY-MM-DD'). */
    new_date: string;
    /** The current gather_on, snapshotted as rescheduled_from by the patch. */
    old_date: string;
}

/** Server refusals that mean the card's 'proposed' was stale — refetch shows truth. */
const DRIFT_CODES = new Set(['GATHERING_CLOSED', 'NOT_FOUND']);

export function isRescheduleDrift(err: unknown): boolean {
    const code = (err as { cause?: UnwrappedError })?.cause?.code;
    return !!code && DRIFT_CODES.has(code);
}

/**
 * Pure patch: apply AC8's re-date reset to the matching gathering card.
 *   • counters naming the new date  → seat flips to 'in', counter row dropped.
 *   • the host's seat                → stays 'in' (they chose the new date).
 *   • any other prior 'in' seat      → reset to null (unanswered).
 *   • 'out' seats + other counters   → untouched.
 *   • gather_on = new date, rescheduled_from = old date.
 * in_count + the viewer's viewer_response are recomputed from the patched seats.
 * Exported for unit tests.
 */
export function patchGatheringReschedule<TData>(
    data: TData,
    gatheringId: string,
    viewerId: string,
    newDate: string,
    oldDate: string,
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
                          // Members who countered the new date flip to 'in'.
                          const flipped = new Set(
                              (card.counters ?? [])
                                  .filter((c: GatheringCounter) => c.counter_on === newDate)
                                  .map((c) => c.user_id),
                          );
                          const seats = (card.seats ?? []).map((s: GatheringSeat) => {
                              if (flipped.has(s.user_id)) return { ...s, response: 'in' as const };
                              // The host chose the new date → their 'in' persists (server
                              // re-asserts it after the prior-'in' reset). Mirror that here.
                              if (s.user_id === card.host_user_id) return { ...s, response: 'in' as const };
                              if (s.response === 'in') return { ...s, response: null };
                              return s;
                          });
                          const counters = (card.counters ?? []).filter(
                              (c: GatheringCounter) => c.counter_on !== newDate,
                          );
                          const viewerResp =
                              seats.find((s) => s.user_id === viewerId)?.response ?? null;
                          return {
                              ...card,
                              gather_on: newDate,
                              rescheduled_from: oldDate,
                              seats,
                              counters,
                              in_count: seats.filter((s) => s.response === 'in').length,
                              viewer_response: viewerResp,
                          };
                      }),
                  }
                : p,
        ),
    } as TData;
}

export function useRescheduleGathering() {
    const qc = useQueryClient();
    const { user } = useAuth();

    return useMutation<GatheringRow, Error, RescheduleGatheringInput>({
        mutationFn: async (input) =>
            callEdgeFn<GatheringRow>('gatherings', {
                action: 'reschedule',
                body: { gathering_id: input.gathering_id, new_date: input.new_date },
            }),

        onMutate: async (input) => {
            const activityKey = queryKeys.tables.activityForTable(input.table_id);
            await qc.cancelQueries({ queryKey: activityKey });
            const previous = qc.getQueriesData({ queryKey: activityKey });
            // Reschedule is host-only, so the viewer performing it IS the host.
            if (user?.id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                qc.setQueriesData<any>({ queryKey: activityKey }, (old: any) =>
                    patchGatheringReschedule(old, input.gathering_id, user.id, input.new_date, input.old_date),
                );
            }
            return { previous };
        },

        onError: (error, input, ctx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any)?.previous?.forEach(([key, data]: [readonly unknown[], unknown]) =>
                qc.setQueryData(key, data),
            );
            // A drift refusal means the card lied about being proposed — resync.
            if (isRescheduleDrift(error)) {
                qc.invalidateQueries({ queryKey: queryKeys.tables.activityForTable(input.table_id) });
            }
        },

        // onSuccess: the upcoming strip reads gather_on server-side and has no
        // optimistic patch of its own — nudge it so a moved date surfaces promptly.
        // The detail cache (TICKET-136) gets a cheap settle-invalidate too: the
        // date-move + RSVP resets are complex, so a single refetch is the safe
        // reconcile (the feed patch already synthesised the within-row rewrite).
        onSuccess: (_result, input) => {
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.upcoming(input.table_id) });
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.detail(input.gathering_id) });
        },
    });
}
