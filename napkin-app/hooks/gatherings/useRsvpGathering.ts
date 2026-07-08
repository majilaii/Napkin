/**
 * useRsvpGathering — answer 'in' | 'out' | 'counter' on a gathering card
 * (TICKET-095, counter added TICKET-127).
 *
 * Optimistic per lib/mutations.md: cancel → snapshot → patch → rollback. The
 * table-activity cache is InfiniteData whose pages are `{ rows }` ENVELOPES —
 * map `page.rows`, never `page.map` (that exact mistake caused a prod bug,
 * see project_post_interaction_drift). We patch every cached variant of this
 * table's feed (base key + filter variants) via setQueriesData on the
 * activityForTable prefix. No blanket invalidation — the server returns
 * { gathering_id, response, counter_on }, which the patch already synthesised.
 *
 * A 'counter' carries counter_on ('YYYY-MM-DD'); 'in'/'out' clear it. The patch
 * moves the viewer between the seat ledger and the counters chip row and keeps
 * in_count honest.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type {
    GatheringCardActivity,
    GatheringSeat,
    GatheringCounter,
} from '@/hooks/tables/useTableActivity';

export type RsvpResponse = 'in' | 'out' | 'counter';

export interface RsvpGatheringInput {
    gathering_id: string;
    /** Needed to scope the cache patch to one table's feed. */
    table_id: string;
    response: RsvpResponse;
    /** Required when response === 'counter' ('YYYY-MM-DD'); ignored otherwise. */
    counter_on?: string | null;
}

export interface RsvpGatheringResult {
    gathering_id: string;
    response: RsvpResponse;
    counter_on: string | null;
}

/**
 * Pure per-card patch: update ONE gathering card's viewer_response, the viewer's
 * seat, the counters chip row, and recompute in_count from the patched seats
 * (seats are the CURRENT table roster, so counting them matches the server).
 * - counter: viewer's seat.response → 'counter'; upsert the viewer's counter row.
 * - in/out: viewer's seat.response → in/out; drop any prior counter of theirs.
 * Seat ordering is left as-is — the server re-orders on the next refetch.
 *
 * This is the SINGLE BRAIN (TICKET-136): both the feed InfiniteData patch
 * (patchGatheringRsvp) and the detail single-object cache (gatherings.detail)
 * map their card(s) through this exact helper, so the two surfaces can never
 * drift. Exported for unit tests.
 */
export function patchGatheringCard(
    card: GatheringCardActivity,
    viewerId: string,
    response: RsvpResponse,
    counterOn?: string | null,
): GatheringCardActivity {
    const seats = (card.seats ?? []).map((s: GatheringSeat) =>
        s.user_id === viewerId ? { ...s, response } : s,
    );
    const viewerName =
        (card.seats ?? []).find((s) => s.user_id === viewerId)?.display_name ?? null;
    // Rebuild the counters row: drop the viewer's old entry, then re-add it only
    // when they're now countering.
    const others = (card.counters ?? []).filter((c: GatheringCounter) => c.user_id !== viewerId);
    const counters =
        response === 'counter' && counterOn
            ? [...others, { user_id: viewerId, display_name: viewerName, counter_on: counterOn }]
            : others;
    return {
        ...card,
        viewer_response: response,
        seats,
        counters,
        in_count: seats.filter((s) => s.response === 'in').length,
    };
}

/**
 * Pure patch: map the matching gathering card in a table-activity InfiniteData
 * cache through patchGatheringCard (one brain). Non-matching rows keep identity.
 * Exported for unit tests.
 */
export function patchGatheringRsvp<TData>(
    data: TData,
    gatheringId: string,
    viewerId: string,
    response: RsvpResponse,
    counterOn?: string | null,
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
                      rows: p.rows.map((r: any) =>
                          r?.type === 'gathering' && r?.id === gatheringId
                              ? patchGatheringCard(r as GatheringCardActivity, viewerId, response, counterOn)
                              : r,
                      ),
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
                body: {
                    gathering_id: input.gathering_id,
                    response: input.response,
                    ...(input.response === 'counter' ? { counter_on: input.counter_on } : {}),
                },
            }),

        onMutate: async (input) => {
            const activityKey = queryKeys.tables.activityForTable(input.table_id);
            const detailKey = queryKeys.gatherings.detail(input.gathering_id);
            await qc.cancelQueries({ queryKey: activityKey });
            await qc.cancelQueries({ queryKey: detailKey });
            // Snapshot every cached variant (base + filter keys) for rollback,
            // plus the detail single-object cache (TICKET-136).
            const previous = qc.getQueriesData({ queryKey: activityKey });
            const previousDetail = qc.getQueryData<GatheringCardActivity>(detailKey);
            if (user?.id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                qc.setQueriesData<any>({ queryKey: activityKey }, (old: any) =>
                    patchGatheringRsvp(old, input.gathering_id, user.id, input.response, input.counter_on),
                );
                // Detail cache — patch through the SAME helper (one brain). Only when
                // the detail is already cached (never synthesise a spurious entry).
                if (previousDetail) {
                    qc.setQueryData<GatheringCardActivity>(
                        detailKey,
                        patchGatheringCard(previousDetail, user.id, input.response, input.counter_on),
                    );
                }
            }
            return { previous, previousDetail };
        },

        onError: (_err, input, ctx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ctx as any)?.previous?.forEach(([key, data]: [readonly unknown[], unknown]) =>
                qc.setQueryData(key, data),
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const previousDetail = (ctx as any)?.previousDetail;
            if (previousDetail !== undefined) {
                qc.setQueryData(queryKeys.gatherings.detail(input.gathering_id), previousDetail);
            }
        },

        // The feed patch already matches the server shape, but the upcoming strip has
        // no optimistic patch of its own — nudge it (narrow, this table only) so the
        // in-count refreshes and the day-of reminder reconcile re-runs after an RSVP.
        // The detail cache reconciles seat ordering the patch left as-is.
        onSuccess: (_result, input) => {
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.upcoming(input.table_id) });
            qc.invalidateQueries({ queryKey: queryKeys.gatherings.detail(input.gathering_id) });
        },
    });
}
