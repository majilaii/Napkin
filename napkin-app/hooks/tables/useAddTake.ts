/**
 * Hook to add your take to a collaborative entry.
 * Updates the caller's entry_participants row with their rating and notes.
 *
 * TICKET-042: replaced blast invalidateQueries with optimistic patch.
 * Finds the matching collaborative_entry or table_night item in the
 * tables.activity InfiniteData cache and splices in / updates the viewer's
 * participant stub. Reconciles by (entry_id, user_id) composite key on
 * success; rolls back from snapshot on error.
 *
 * Post-onSuccess, narrow invalidate of entries.participants(entry_id)
 * fetches the server-joined participant display data (avatar_url, display_name)
 * that the optimistic stub can't faithfully synthesise. This is an "invalidation
 * IS appropriate" case — see lib/mutations.md.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import { snapshotInfinite } from '@/lib/optimistic';
import type { ActivityItem, CollaborativeEntryActivity, TableNightActivity } from '@/hooks/tables/useTableActivity';
import type { InfiniteData } from '@tanstack/react-query';
import type { Page } from '@/lib/pagination';

export interface AddTakeInput {
    entry_id: string;
    table_id: string;
    rating: number | null;
    notes: string | null;
}

export interface TakeResult {
    entry_id: string;
    user_id: string;
    rating: number | null;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
}

async function addTake(input: AddTakeInput): Promise<TakeResult> {
    return callEdgeFn<TakeResult>('entry', {
        action: 'add-take',
        body: {
            entry_id: input.entry_id,
            rating: input.rating,
            notes: input.notes,
        },
    });
}

/**
 * Walk all pages and update the participants[] of the activity item matching
 * `entryId`. Handles both collaborative_entry and table_night item types.
 * If the viewer already has a participant row, updates it in-place (re-rate).
 * If not, pushes a new stub.
 */
function patchActivityParticipant(
    data: InfiniteData<Page<ActivityItem>> | undefined,
    entryId: string,
    viewerId: string,
    mutator: (participant: {
        user_id: string;
        rating: number | null;
        notes: string | null;
        profiles: { display_name: string };
    }) => {
        user_id: string;
        rating: number | null;
        notes: string | null;
        profiles: { display_name: string };
        [key: string]: unknown;
    },
): InfiniteData<Page<ActivityItem>> | undefined {
    if (!data) return undefined;

    const pages = data.pages.map((page) => ({
        ...page,
        rows: page.rows.map((item) => {
            if (item.id !== entryId) return item;
            if (item.type !== 'collaborative_entry' && item.type !== 'table_night') return item;

            const typedItem = item as CollaborativeEntryActivity | TableNightActivity;
            const participants = typedItem.participants ?? [];
            const existing = participants.find((p) => p.user_id === viewerId);

            const nextParticipants = existing
                ? participants.map((p) =>
                      p.user_id === viewerId ? mutator(p) : p,
                  )
                : [
                      ...participants,
                      mutator({
                          user_id: viewerId,
                          rating: null,
                          notes: null,
                          profiles: { display_name: '' },
                      }),
                  ];

            return { ...typedItem, participants: nextParticipants };
        }),
    }));

    return { ...data, pages };
}

interface MutationContext {
    restore: () => void;
    viewerId: string;
}

export function useAddTake() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id ?? '';

    return useMutation<TakeResult, Error, AddTakeInput, MutationContext | undefined>({
        mutationFn: addTake,

        onMutate: async (input) => {
            if (!viewerId) return undefined;

            const key = queryKeys.tables.activity(input.table_id);
            await qc.cancelQueries({ queryKey: key });
            const { restore } = snapshotInfinite<ActivityItem>(qc, key);

            // Splice in optimistic participant stub.
            qc.setQueryData<InfiniteData<Page<ActivityItem>>>(key, (prev) =>
                patchActivityParticipant(prev, input.entry_id, viewerId, (existing) => ({
                    ...existing,
                    rating: input.rating,
                    notes: input.notes,
                    content: input.notes ?? null,
                    status: 'rated',
                    __optimistic: true,
                })),
            );

            return { restore, viewerId };
        },

        onError: (_err, _vars, ctx) => {
            ctx?.restore();
        },

        onSuccess: (serverTake, vars, ctx) => {
            if (!ctx) return;

            const key = queryKeys.tables.activity(vars.table_id);
            // Reconcile by (entry_id, user_id) — strip optimistic flag, merge server fields.
            qc.setQueryData<InfiniteData<Page<ActivityItem>>>(key, (prev) =>
                patchActivityParticipant(prev, vars.entry_id, ctx.viewerId, (existing) => ({
                    ...existing,
                    rating: serverTake.rating,
                    notes: serverTake.notes,
                    content: serverTake.notes ?? null,
                    __optimistic: undefined,
                })),
            );

            // Narrow invalidate: entry-detail participants carry avatar/display_name joins
            // that the optimistic stub can't synthesise. This is a "when invalidation IS
            // appropriate" case — see mutations.md.
            qc.invalidateQueries({ queryKey: queryKeys.entries.participants(vars.entry_id) });
            qc.invalidateQueries({ queryKey: queryKeys.entries.detail(vars.entry_id) });
        },
    });
}
