/**
 * useUpcomingGatherings — the Table-screen "upcoming" strip (TICKET-128 Part A).
 *
 * Reads future plans for a Table: gatherings with status proposed|dispatched and
 * gather_on >= today, ascending by date. This is the "calendar" — a list of what's
 * booked, on the surface that owns it. No new tab, no month grid.
 *
 * Server contract (`gatherings` edge fn, action 'list_upcoming', member-gated):
 * returns, inside the { data } envelope, a { rows } of UpcomingGathering ordered
 * ascending by gather_on. The edge action is implemented separately (TICKET-127/128
 * server work) — the client compiles against this contract independently.
 *
 * staleTime is short (60s) because dates matter and re-dates (TICKET-127) must
 * surface promptly; the strip just re-renders gather_on on refetch (AC6).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

/** One upcoming plan as rendered by the strip. */
export interface UpcomingGathering {
    id: string;
    /** 'YYYY-MM-DD' — the day of the gathering. */
    gather_on: string;
    status: 'proposed' | 'dispatched';
    /** Restaurant subject. `id` may be absent depending on server projection. */
    restaurant: { id?: string | null; name: string | null } | null;
    /** How many members are 'in'. Proposed rows render this; dispatched show 'gathered'. */
    in_count: number;
    /** The auto-created supper once dispatched — tap target for dispatched rows. */
    supper_id: string | null;
    /** TICKET-127: the CALLER's own RSVP on this gathering (null = hasn't answered). */
    viewer_response: 'in' | 'out' | 'counter' | null;
}

interface UpcomingPage {
    rows: UpcomingGathering[];
}

export function useUpcomingGatherings(tableId: string | null | undefined) {
    return useQuery<UpcomingGathering[], Error>({
        queryKey: queryKeys.gatherings.upcoming(tableId ?? ''),
        queryFn: async () => {
            const data = await callEdgeFn<UpcomingPage>('gatherings', {
                action: 'list_upcoming',
                body: { table_id: tableId },
            });
            return data?.rows ?? [];
        },
        enabled: !!tableId,
        staleTime: 1000 * 60, // 60s — dates matter; re-dates should surface promptly
    });
}
