/**
 * Mutation hook: bulk-add many restaurants to a list (the "import from saved
 * sources" fast path — e.g. multi-select from the wishlist).
 *
 * Follows the TICKET-036 mutation doctrine:
 *   - onMutate snapshots `mine` and optimistically bumps entry_count by N
 *     (an upper bound — server skips dupes).
 *   - onError rolls back.
 *   - onSuccess reconciles entry_count with the server's authoritative total
 *     and patches each added restaurant's `containing` cache.
 *   - onSettled narrowly invalidates ONLY the list detail (authoritative
 *     entries[] with positions) — never the wider `mine`/`containing` prefixes.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { MyList } from './useMyLists';
import type { ListEntryResult } from './useAddToList';

export interface AddEntriesInput {
    list_id: string;
    /** Already-persisted restaurant UUIDs (e.g. wishlist items' restaurant.id). */
    restaurant_ids: string[];
}

export interface AddEntriesResult {
    added: ListEntryResult[];
    added_count: number;
    skipped_count: number;
    /** Authoritative entry_count after the insert (dupes already skipped). */
    entry_count: number;
}

async function addEntries(input: AddEntriesInput): Promise<AddEntriesResult> {
    return callEdgeFn<AddEntriesResult>('lists', { action: 'add_entries', body: input });
}

export function useAddEntriesToList(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: addEntries,
        onMutate: async ({ list_id, restaurant_ids }) => {
            if (!userId) return {};
            const mineKey = queryKeys.lists.mine(userId);
            await queryClient.cancelQueries({ queryKey: mineKey });
            const prevMine = queryClient.getQueryData<MyList[]>(mineKey);

            // Optimistic upper-bound bump; reconciled to the server total onSuccess.
            queryClient.setQueryData<MyList[]>(mineKey, (old) =>
                old
                    ? old.map((l) =>
                          l.id === list_id
                              ? { ...l, entry_count: l.entry_count + restaurant_ids.length }
                              : l,
                      )
                    : old,
            );

            return { prevMine, mineKey };
        },
        onError: (_err, _input, context: any) => {
            if (context?.prevMine !== undefined && context?.mineKey) {
                queryClient.setQueryData(context.mineKey, context.prevMine);
            }
        },
        onSuccess: (result, { list_id }) => {
            if (!userId) return;

            // Reconcile entry_count with the authoritative server total.
            queryClient.setQueryData<MyList[]>(queryKeys.lists.mine(userId), (old) =>
                old
                    ? old.map((l) =>
                          l.id === list_id ? { ...l, entry_count: result.entry_count } : l,
                      )
                    : old,
            );

            // Patch each added restaurant's containing-set IF already cached
            // (don't synthesize a set that was never fetched).
            for (const entry of result.added) {
                const containingKey = queryKeys.lists.containing(userId, entry.restaurant_id);
                queryClient.setQueryData<string[]>(containingKey, (old) => {
                    if (!old) return old;
                    return old.includes(list_id) ? old : [...old, list_id];
                });
            }
        },
        onSettled: (_data, _err, { list_id }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list_id) });
            // Refresh the wishlist map's emoji pins (TICKET-108).
            if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.lists.mapPins(userId) });
        },
    });
}
