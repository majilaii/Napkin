/**
 * useMergeCandidate — check if another Table member has already logged the
 * same restaurant on a similar date (within ±18 hours) in the target Table.
 *
 * Used by the compose sheet (Trigger B) to surface the MergeCandidateCard
 * before the user saves their entry.
 *
 * The candidate entry must NOT be already bound to any round (merged or
 * Round-Mode) and must NOT have a table_night_id set.
 *
 * Returns `null` when no candidate exists — silence is the default.
 * TICKET-044.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MergeCandidate {
    entry_id: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    rating: number | null;
    visited_at: string;
    created_at: string;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchMergeCandidate(
    tableId: string,
    restaurantId: string,
    visitedAtIso: string,
): Promise<MergeCandidate | null> {
    return callEdgeFn<MergeCandidate | null>('entry', {
        method: 'GET',
        action: 'merge_candidate',
        params: {
            table_id: tableId,
            restaurant_id: restaurantId,
            visited_at: visitedAtIso,
        },
    });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @param tableId     Table the user is composing into.
 * @param restaurantId Restaurant being logged.
 * @param visitedAtIso ISO-8601 string for the visited_at the composer has chosen.
 *
 * All three must be set for the query to fire; any undefined → disabled.
 */
export function useMergeCandidate(
    tableId: string | null | undefined,
    restaurantId: string | null | undefined,
    visitedAtIso: string | null | undefined,
) {
    return useQuery<MergeCandidate | null, Error>({
        queryKey: queryKeys.rounds.merge_candidate(
            tableId ?? '',
            restaurantId ?? '',
            visitedAtIso ?? '',
        ),
        queryFn: () => fetchMergeCandidate(tableId!, restaurantId!, visitedAtIso!),
        enabled: !!tableId && !!restaurantId && !!visitedAtIso,
        // 30s stale — compose sessions are short; a 2nd refetch catches the
        // "A's entry got bound between card-render and tap" edge case on field change.
        staleTime: 1000 * 30,
        // Never throw — a null / network error should be silent (compose proceeds).
        throwOnError: false,
    });
}
