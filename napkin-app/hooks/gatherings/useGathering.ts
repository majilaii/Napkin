/**
 * useGathering — read one gathering for the detail screen (TICKET-136).
 *
 * Backs /gathering/[id]. Opens INSTANTLY by seeding `initialData` from the feed
 * cache: it scans the `queryKeys.tables.activityAll()` (['tableActivity']) prefix
 * for a row with `type === 'gathering' && id === <id>`. That cached copy is the
 * FRESHEST one — RSVP/reschedule optimistic patches already land there — and it
 * needs no `table_id` on the route (the prefix scan spans every cached table +
 * filter variant). `initialDataUpdatedAt: 0` paints the seed immediately AND
 * fires a reconcile refetch on mount, so a background `get` corrects seat
 * ordering / any drift. Cold deep-link (nothing cached) → brief spinner, expected.
 *
 * The `get` edge action returns the GatheringCardActivity shape nested in `data`;
 * callEdgeFn strips the outer envelope, so the hook receives the card directly.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { GatheringCardActivity } from '@/hooks/tables/useTableActivity';

/** Structured `get` codes that mean the gathering is gone/unreachable for this
 *  viewer — a stale feed seed must yield to the not-available state, and a retry
 *  would only re-confirm. NOT_FOUND covers missing OR cancelled (both 404). */
export const GONE_CODES = new Set(['NOT_FOUND', 'FORBIDDEN', 'INVALID_INPUT', 'UNAUTHORIZED']);

/** Scan every cached table-activity feed for this gathering (freshest copy). */
function findCachedGathering(qc: QueryClient, id: string): GatheringCardActivity | undefined {
    const entries = qc.getQueriesData({ queryKey: queryKeys.tables.activityAll() });
    for (const [, data] of entries) {
        const d = data as { pages?: { rows?: unknown[] }[] } | undefined;
        if (!d?.pages) continue;
        for (const page of d.pages) {
            for (const row of page?.rows ?? []) {
                const r = row as { type?: string; id?: string };
                if (r?.type === 'gathering' && r?.id === id) {
                    return row as GatheringCardActivity;
                }
            }
        }
    }
    return undefined;
}

export function useGathering(id?: string | null) {
    const qc = useQueryClient();

    return useQuery<GatheringCardActivity>({
        queryKey: queryKeys.gatherings.detail(id ?? ''),
        queryFn: () =>
            callEdgeFn<GatheringCardActivity>('gatherings', {
                action: 'get',
                body: { gathering_id: id as string },
            }),
        enabled: !!id,
        staleTime: 1000 * 30,
        // Seed from the feed cache; paint instantly and still reconcile on mount.
        initialData: () => (id ? findCachedGathering(qc, id) : undefined),
        initialDataUpdatedAt: 0,
        // Terminal client errors (gone / forbidden / bad id) settle immediately —
        // no exponential-backoff retry storm against the edge fn, and the screen's
        // not-available branch appears promptly (see GatheringScreen `isGone`).
        retry: (failureCount, error) => {
            const code = (error as { cause?: { code?: string } })?.cause?.code;
            if (code && GONE_CODES.has(code)) return false;
            return failureCount < 2;
        },
    });
}
