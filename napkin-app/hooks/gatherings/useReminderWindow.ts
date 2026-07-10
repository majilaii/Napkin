/**
 * useReminderWindow — the authoritative reconcile-window read that drives the
 * device-local gather reminders (TICKET-159).
 *
 * Server contract (`gatherings` edge fn, action 'reconcile_window',
 * member-gated): rows with gather_on in [today-1, today+90] (HKT), INCLUDING
 * cancelled and expired rows, each carrying status + the CALLER's own RSVP +
 * restaurant {id, name}. reconcileGatherReminders decides keep/cancel/
 * reschedule of the day-of and morning-after pings purely from this STATE —
 * a row's absence inside the window means it was hard-deleted, never merely
 * filtered (findings 5/12/13).
 *
 * Nothing renders this query — it exists to feed the reconcile pass.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

/** One gathering inside the reconcile window. */
export interface ReminderWindowRow {
    id: string;
    /** 'YYYY-MM-DD' — the day of the gathering. */
    gather_on: string;
    /** ALL statuses — cancelled/expired ride along so cancel/keep is stateful. */
    status: 'proposed' | 'dispatched' | 'cancelled' | 'expired';
    supper_id: string | null;
    restaurant: { id: string; name: string | null } | null;
    /** The CALLER's own RSVP (null = hasn't answered). */
    viewer_response: 'in' | 'out' | 'counter' | null;
}

interface ReminderWindowPage {
    rows: ReminderWindowRow[];
}

export function useReminderWindow(tableId: string | null | undefined) {
    return useQuery<ReminderWindowRow[], Error>({
        queryKey: queryKeys.gatherings.reconcileWindow(tableId ?? ''),
        queryFn: async () => {
            const data = await callEdgeFn<ReminderWindowPage>('gatherings', {
                action: 'reconcile_window',
                body: { table_id: tableId },
            });
            return data?.rows ?? [];
        },
        enabled: !!tableId,
        staleTime: 1000 * 60, // dates + RSVPs drive OS schedules; keep it fresh
    });
}
