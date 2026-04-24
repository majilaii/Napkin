/**
 * useLastSeenAt — fetch + update a user's last_seen_at for a Table.
 *
 * Used by the "unseen dot" system (TICKET-010).
 *
 * useLastSeenAt(tableId, userId)
 *   Cheap 1-row query on table_members.last_seen_at via the table-management
 *   edge function. staleTime: 0 so the value refetches on every tab focus.
 *
 * useMarkSeen()
 *   Fire-and-forget mutation that writes last_seen_at = now() for the caller
 *   on a given table. Module-level debounce (30s per tableId) prevents
 *   hammering when the user tab-switches rapidly.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Module-level debounce map ───────────────────────────────────────────────
// Keyed by tableId → timestamp of the last successful mutate() call.
// Persists for the app's lifetime (survives hook unmounts / remounts).
// See Architecture Decision #6 in TICKET-010 for why this is module-level
// rather than useRef or mutationKey.
const _lastMarkSeenAt = new Map<string, number>();

/** Test helper — reset debounce state between test cases. Not used at runtime. */
export function _resetMarkSeenDebounce(): void {
    _lastMarkSeenAt.clear();
}

const DEBOUNCE_MS = 30_000; // 30 seconds

// ── useLastSeenAt ───────────────────────────────────────────────────────────

async function fetchLastSeenAt(
    tableId: string,
    _userId: string
): Promise<string | null> {
    const data = await callEdgeFn<{ last_seen_at: string | null } | null>(
        'table-management',
        {
            method: 'GET',
            action: 'last_seen',
            params: { table_id: tableId },
        }
    );
    return data?.last_seen_at ?? null;
}

export function useLastSeenAt(
    tableId: string | null | undefined,
    userId: string | null | undefined
) {
    return useQuery<string | null, Error>({
        queryKey: queryKeys.tables.lastSeen(tableId!, userId!),
        queryFn: () => fetchLastSeenAt(tableId!, userId!),
        enabled: !!tableId && !!userId,
        // staleTime: 0 so the value refetches on every tab focus / table switch.
        staleTime: 0,
    });
}

// ── useMarkSeen ─────────────────────────────────────────────────────────────

interface MarkSeenInput {
    tableId: string;
}

interface MarkSeenResult {
    last_seen_at: string;
}

export function useMarkSeen() {
    const queryClient = useQueryClient();

    return useMutation<MarkSeenResult, Error, MarkSeenInput, { previous: string | null | undefined; userId: string } | undefined>({
        mutationFn: async ({ tableId }) => {
            // Debounce: if we fired for this tableId within the last 30s, skip.
            const last = _lastMarkSeenAt.get(tableId) ?? 0;
            if (Date.now() - last < DEBOUNCE_MS) {
                // Return a no-op result (the caller ignores the value anyway).
                // We need to still return a valid shape so TS is happy.
                return { last_seen_at: new Date(last).toISOString() };
            }

            _lastMarkSeenAt.set(tableId, Date.now());

            return await callEdgeFn<MarkSeenResult>('table-management', {
                method: 'POST',
                params: { action: 'mark_seen' },
                body: { table_id: tableId },
            });
        },

        onMutate: async ({ tableId }) => {
            // Optimistic write: immediately mark now() in the cache so dots
            // clear on the next render without waiting for the server round-trip.
            // We get the userId from the current session.
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id;
            if (!userId) return;

            const key = queryKeys.tables.lastSeen(tableId, userId);
            // P0-8: snapshot previous value so onError can roll back. Without
            // this, a server failure leaves the cache stuck at now() forever
            // and the unseen-dot system breaks until app restart.
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<string | null>(key);
            const now = new Date().toISOString();
            queryClient.setQueryData<string | null>(key, now);
            return { previous, userId };
        },

        onError: (_err, { tableId }, context) => {
            // P0-8: revert the optimistic now() write on failure. If onMutate
            // bailed (no userId), context is undefined — safe to no-op.
            _lastMarkSeenAt.delete(tableId);
            if (context && context.userId) {
                const key = queryKeys.tables.lastSeen(tableId, context.userId);
                queryClient.setQueryData<string | null | undefined>(key, context.previous);
            }
        },

        onSuccess: (result, { tableId }) => {
            // Server confirmed — update cache with the authoritative value, BUT
            // never overwrite a newer cached value. Protects against the
            // debounced-no-op path (which returns the old stored timestamp)
            // stomping on the fresh now() that onMutate just wrote.
            supabase.auth.getSession().then(({ data: { session } }) => {
                const userId = session?.user?.id;
                if (!userId) return;
                const key = queryKeys.tables.lastSeen(tableId, userId);
                const cached = queryClient.getQueryData<string | null>(key);
                if (
                    !cached ||
                    new Date(result.last_seen_at).getTime() >= new Date(cached).getTime()
                ) {
                    queryClient.setQueryData<string | null>(key, result.last_seen_at);
                }
            });
        },
    });
}
