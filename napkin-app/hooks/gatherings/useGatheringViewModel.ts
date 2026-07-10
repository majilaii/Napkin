/**
 * useGatheringViewModel — the pure derivations a gathering surface needs
 * (TICKET-136). ONE brain for the seat filters, the counter alignment tally, the
 * `in_count`-beats guard, the source label, and the murmur fallback — the exact
 * math whose divergence between the feed card and the detail screen would be a
 * subtle, silent correctness bug.
 *
 * Pure `(gathering, viewerId) => derivations`. No hooks, no side effects, no
 * mutation wiring — trivially unit-testable and callable from both GatheringCard
 * and GatheringDetail. It intentionally does NOT compute `showControls` (that
 * folds in the surface-local `changing` state); it returns the flags each surface
 * combines with its own local UI state.
 */
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';
import { dateLeaf, firstName, orderSeats } from '@/components/gatherings/gatheringFormat';

export interface GatheringViewModel {
    isHost: boolean;
    isProposed: boolean;
    isDispatched: boolean;
    isExpired: boolean;
    /** dispatched but the supper link died (supper_id null). */
    supperCancelled: boolean;
    /** host may clear a dead gathering (unrescued expired or supper-cancelled).
     *  TICKET-159: a rescued gathering (expired + supper_id) is NOT clearable. */
    canClear: boolean;
    /** TICKET-159: host-only `it happened anyway — set the table` (expired, unlinked). */
    canRescue: boolean;
    /** TICKET-159: expired but rescued — the card/detail offer `see the table →`. */
    isRescued: boolean;
    /** calendar-leaf pieces for gather_on, or null when unparseable. */
    leaf: { wd: string; day: string; mo: string } | null;
    /** seats with response 'in', viewer-first ordering. */
    ins: GatheringSeat[];
    /** seats with response 'out', viewer-first ordering. */
    outs: GatheringSeat[];
    /** seats still undecided (response null). A counter is NOT "waiting". */
    waiting: GatheringSeat[];
    /** "waiting on Clara" / "waiting on 3 more" — null when nobody's undecided. */
    waitingLine: string | null;
    /** total seat count (= current member count). */
    memberCount: number;
    /** the best-clustered counter date (excludes the current gather_on), or null. */
    bestCounterDate: string | null;
    /** how many members proposed bestCounterDate. */
    bestCounterN: number;
    /** show the alignment nudge: proposed, clusters (>=2), beats the current in_count. */
    showAlignment: boolean;
    /** "date moved · was <old>" until the viewer re-answers on the new date. */
    showDateMoved: boolean;
    /** "pinned from tiktok" — only when the host's pin carries a URL. */
    sourceLabel: string | null;
    restaurantName: string;
    /** the host's note, else the host's ask ("… wants to gather the table"). */
    murmur: string;
}

export function useGatheringViewModel(
    gathering: GatheringCardActivity,
    viewerId?: string,
): GatheringViewModel {
    const {
        restaurant,
        host_user_id,
        host_name,
        note,
        gather_on,
        status,
        supper_id,
        seats,
        in_count,
        viewer_response,
        counters = [],
        source_url = null,
        source_type = null,
        rescheduled_from = null,
    } = gathering;

    const isHost = !!viewerId && viewerId === host_user_id;
    const isProposed = status === 'proposed';
    const isDispatched = status === 'dispatched';
    const isExpired = status === 'expired';

    const supperCancelled = isDispatched && !supper_id;
    // TICKET-159: a RESCUED gathering (expired + supper_id) carries the supper's
    // provenance — not clearable (the server's delete guard rejects it too).
    const canClear = isHost && ((isExpired && !supper_id) || supperCancelled);
    const canRescue = isHost && isExpired && !supper_id;
    const isRescued = isExpired && !!supper_id;

    const leaf = dateLeaf(gather_on);
    const ins = orderSeats(seats.filter((s) => s.response === 'in'), viewerId);
    const outs = orderSeats(seats.filter((s) => s.response === 'out'), viewerId);
    // Waiting = still undecided; a counter is a definitive answer, not "waiting".
    const waiting = seats.filter((s) => s.response === null);
    const waitingNames = waiting
        .map((s) => (s.user_id === viewerId ? 'you' : firstName(s.display_name)))
        .filter(Boolean) as string[];
    const waitingLine =
        waiting.length === 0
            ? null
            : waiting.length === 1 && waitingNames[0]
              ? `waiting on ${waitingNames[0]}`
              : `waiting on ${waiting.length} more`;

    // Alignment: the best counter date, shown only when it clusters (>= 2) AND
    // beats the current date's in-count.
    const memberCount = seats.length;
    const counterTally = new Map<string, number>();
    for (const c of counters) {
        if (c.counter_on === gather_on) continue; // never surface the current date
        counterTally.set(c.counter_on, (counterTally.get(c.counter_on) ?? 0) + 1);
    }
    let bestCounterDate: string | null = null;
    let bestCounterN = 0;
    for (const [date, n] of counterTally) {
        if (n > bestCounterN) {
            bestCounterN = n;
            bestCounterDate = date;
        }
    }
    const showAlignment =
        isProposed && !!bestCounterDate && bestCounterN >= 2 && bestCounterN > in_count;

    // "date moved · was <old>" until the viewer re-answers on the new date.
    const showDateMoved = isProposed && !!rescheduled_from && viewer_response === null;

    // Source line: only when the host's pin carries a URL.
    const srcType = source_type ? source_type.toLowerCase().replace(/_/g, ' ') : null;
    const sourceLabel = source_url ? `pinned from ${srcType ?? 'a link'}` : null;

    const restaurantName = restaurant?.name ?? 'a spot';
    const murmur = note
        ? note
        : isHost
          ? 'you want to gather the table'
          : `${firstName(host_name) ?? 'someone'} wants to gather the table`;

    return {
        isHost,
        isProposed,
        isDispatched,
        isExpired,
        supperCancelled,
        canClear,
        canRescue,
        isRescued,
        leaf,
        ins,
        outs,
        waiting,
        waitingLine,
        memberCount,
        bestCounterDate,
        bestCounterN,
        showAlignment,
        showDateMoved,
        sourceLabel,
        restaurantName,
        murmur,
    };
}
