/**
 * useCreateEntryWithMerge — combined mutation: create B's entry AND bind both
 * A's and B's entries to a new merged round atomically.
 *
 * Wire: POST entry?action=merge_with
 *   Body: { action: 'merge_with', entry_a_id, table_id, restaurant_id?, visited_at,
 *           client_nonce, ...b_payload }
 *   Response: { data: MergeResult, merge_outcome: 'merged' | 'conflict_fell_back' | 'solo' }
 *
 * Cache paths on success:
 *   - B's diary  (queryKeys.users.diary(authedUserId))           — swap nonce -> merged round
 *   - Target Table activity (all cached filter variants)          — removeByMatch(entry_a_id),
 *                                                                   swapByNonce(B's nonce -> merged round)
 *   - Restaurant page table history                               — narrow invalidate
 *   - rounds.detail seed (merged round id)                        — setQueryData
 *
 * On `conflict_fell_back`: B's entry saved as solo; toast shown; optimistic state
 * rolled back and table activity + diary are invalidated (server refetch).
 *
 * IMPORTANT: this hook NEVER patches any cache key other than
 * queryKeys.users.diary(authedUserId) on the diary axis.
 * Public-profile diary caches are NEVER touched — Tables are private.
 * TICKET-044 doctrine: both layers (server projection + client patcher) enforce this.
 *
 * Snapshot/rollback uses snapshotInfinite from lib/optimistic.ts.
 * All optimistic state is rolled back atomically on error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import {
    snapshotInfinite,
    swapByMatch,
    removeByMatch,
    prependToInfinitePages,
} from '@/lib/optimistic';
import type { Page } from '@/lib/pagination';
import type { ActivityItem, TableNightActivity } from '@/hooks/tables/useTableActivity';
import type { DiaryEntryRow } from '@/hooks/users/useUserProfile';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Server response from entry?action=merge_with
 */
export interface MergeResult {
    /** B's newly-created entry id. */
    entry_id: string;
    /** The new merged round's id (a table_nights.id UUID). Null when conflict_fell_back. */
    round_id: string | null;
    /** A's entry id that was bound into the round. */
    entry_a_id: string;
    restaurant_id: string | null;
    visited_at: string;
    created_at: string;
    rating: number | null;
    content: string | null;
    /** Merged-round participant payloads, if server included them. */
    participants?: Array<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        rating: number | null;
        notes: string | null;
    }>;
    average_rating: number | null;
    restaurant: {
        id: string;
        name: string;
        city: string | null;
        photo_url: string | null;
    } | null;
}

/**
 * The wire shape after callEdgeFn unwraps the outer { data } envelope.
 * `merge_outcome` is nested INSIDE `data` on the server so it survives the strip.
 */
export interface MergeWithResult extends MergeResult {
    merge_outcome: 'merged' | 'conflict_fell_back' | 'solo';
}

export interface CreateEntryWithMergeInput {
    /** A-side entry that B is merging with. */
    entry_a_id: string;
    /** Table the round will be scoped to. */
    table_id: string;
    /** Restaurant UUID (required for server predicate recheck). */
    restaurant_id: string;
    /** ISO-8601 visited_at for B's entry. */
    visited_at: string;
    /** Idempotency nonce — caller must generate before onMutate (uuid). */
    client_nonce: string;
    // ── B's entry payload ──────────────────────────────────────────────────────
    rating?: number | null;
    content?: string | null;
    dish_description?: string | null;
    photo_url?: string | null;
    photo_urls?: string[];
    /** Restaurant stub for ghost-upsert (server uses external_id). */
    restaurant?: {
        external_id: string;
        name: string;
        location?: { address?: string; locality?: string; country?: string };
        latitude?: number;
        longitude?: number;
        photoReference?: string;
        photoAttributionHtml?: string | null;
    } | null;
}

interface MutationContext {
    restores: Array<() => void>;
    nonce: string;
    entry_a_id: string;
    table_id: string;
    restaurant_id: string;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function callMergeWith(input: CreateEntryWithMergeInput): Promise<MergeWithResult> {
    const { entry_a_id, table_id, restaurant_id, visited_at, client_nonce, ...bPayload } = input;
    return callEdgeFn<MergeWithResult>('entry', {
        body: {
            action: 'merge_with',
            entry_a_id,
            table_id,
            restaurant_id,
            visited_at,
            client_nonce,
            ...bPayload,
        },
    });
}

// ── Optimistic helpers ────────────────────────────────────────────────────────

/**
 * Build an optimistic TableNightActivity row for a merged round.
 * Uses placeholder ids until the server responds.
 */
function buildOptimisticMergedRound(
    input: CreateEntryWithMergeInput,
    userId: string,
    nonce: string,
): TableNightActivity {
    const now = new Date().toISOString();
    return {
        type: 'table_night',
        round_kind: 'merged',
        id: `optimistic-${nonce}`,
        restaurant_id: input.restaurant_id,
        host_user_id: userId,
        status: null as any,   // merged rounds have status=NULL
        created_at: now,
        revealed_at: null,
        is_async: false,
        sort_date: input.visited_at,
        average_rating: input.rating ?? null,
        reaction_count: 0,
        comment_count: 0,
        top_emojis: [],
        my_reactions: [],
        restaurants: {
            id: '',
            name: input.restaurant?.name ?? '',
            address: input.restaurant?.location?.address ?? null,
            city: input.restaurant?.location?.locality ?? null,
            photo_url: null,
        },
        participants: [],
    };
}

/**
 * Build a reconciled TableNightActivity from the server's MergeResult.
 * Adapts the server participant shape (flat) to the client shape (nested profiles).
 */
function buildServerMergedRound(result: MergeResult): TableNightActivity {
    const participants: TableNightActivity['participants'] = (result.participants ?? []).map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        rating: p.rating,
        notes: p.notes,
        profiles: { display_name: p.display_name, avatar_url: p.avatar_url },
    }));

    const restaurant = result.restaurant
        ? {
              id: result.restaurant.id,
              name: result.restaurant.name,
              address: null as string | null,
              city: result.restaurant.city,
              photo_url: result.restaurant.photo_url,
          }
        : {
              id: result.restaurant_id ?? '',
              name: '',
              address: null as string | null,
              city: null as string | null,
              photo_url: null,
          };

    return {
        type: 'table_night',
        round_kind: 'merged',
        id: result.round_id ?? `merged-${result.entry_id}`,
        restaurant_id: result.restaurant_id ?? '',
        host_user_id: '',
        status: null as any,
        created_at: result.created_at,
        revealed_at: result.visited_at,
        is_async: false,
        sort_date: result.visited_at,
        average_rating: result.average_rating,
        reaction_count: 0,
        comment_count: 0,
        top_emojis: [],
        my_reactions: [],
        restaurants: restaurant,
        participants,
    };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCreateEntryWithMerge() {
    const qc = useQueryClient();
    const { user } = useAuth();
    const toast = useToast();

    return useMutation<MergeWithResult, Error, CreateEntryWithMergeInput, MutationContext>({
        mutationFn: callMergeWith,

        onMutate: async (input): Promise<MutationContext> => {
            const { entry_a_id, table_id, restaurant_id, client_nonce: nonce } = input;
            const restores: Array<() => void> = [];

            if (user?.id) {
                // ── B's diary — InfiniteData<Page<DiaryEntryRow>> ───────────────
                // WHITELIST: only the authed user's own diary is ever patched.
                // Never touch another user's diary key — Tables are private.
                const diaryKey = queryKeys.users.diary(user.id);
                await qc.cancelQueries({ queryKey: diaryKey });
                const { restore: restoreDiary } = snapshotInfinite<DiaryEntryRow>(qc, diaryKey);
                restores.push(restoreDiary);
                // Optimistically prepend a merged-round placeholder to diary.
                const optimisticDiaryRow: DiaryEntryRow = {
                    entry_id: `optimistic-${nonce}`,
                    restaurant_id,
                    restaurant_name: input.restaurant?.name ?? '',
                    city: input.restaurant?.location?.locality ?? null,
                    photo_url: null,
                    rating: input.rating ?? null,
                    note: input.content ?? null,
                    visited_at: input.visited_at,
                    created_at: new Date().toISOString(),
                    round_kind: 'merged',
                    round_id: null,
                };
                qc.setQueryData<InfiniteData<Page<DiaryEntryRow>>>(diaryKey, (old) =>
                    prependToInfinitePages(old, optimisticDiaryRow),
                );

                // ── Target Table activity — all cached filter variants ────────
                const allActivityCacheEntries = qc.getQueryCache().findAll({
                    queryKey: queryKeys.tables.activityForTable(table_id),
                    exact: false,
                });
                for (const cacheEntry of allActivityCacheEntries) {
                    const actKey = cacheEntry.queryKey;
                    await qc.cancelQueries({ queryKey: actKey });
                    const { restore: restoreActivity } = snapshotInfinite<ActivityItem>(qc, actKey);
                    restores.push(restoreActivity);
                    // Remove A's solo entry (it's being converted to a merged round).
                    qc.setQueryData<InfiniteData<Page<ActivityItem>>>(actKey as any, (old) =>
                        removeByMatch<ActivityItem>(old, (row: ActivityItem) => row.id === entry_a_id) ?? old,
                    );
                    // Prepend the optimistic merged-round card.
                    const optimisticRound = buildOptimisticMergedRound(input, user.id, nonce);
                    qc.setQueryData<InfiniteData<Page<ActivityItem>>>(actKey as any, (old) =>
                        prependToInfinitePages(old, optimisticRound as ActivityItem),
                    );
                }
            }

            return { restores, nonce, entry_a_id, table_id, restaurant_id };
        },

        onError: (_err, _input, context) => {
            if (!context) return;
            for (const restore of context.restores) {
                restore();
            }
        },

        onSuccess: (result, input, context) => {
            if (!context || !user?.id) return;
            const { nonce, entry_a_id, table_id, restaurant_id } = context;
            const { merge_outcome } = result;

            if (merge_outcome === 'conflict_fell_back' || merge_outcome === 'solo') {
                // Merge failed — B's entry saved as solo. Toast and roll back
                // any merged-round optimistic state.
                toast.show("saved — couldn't form a round.");

                // Roll back all caches to pre-optimistic state.
                for (const restore of context.restores) {
                    restore();
                }

                // Re-invalidate to pick up the server state (A unchanged, B newly solo).
                qc.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(table_id),
                    exact: false,
                });
                qc.invalidateQueries({ queryKey: queryKeys.users.diary(user.id) });
                return;
            }

            // ── merge_outcome === 'merged' ────────────────────────────────────

            const serverRound = buildServerMergedRound(result);

            // ── 1. Reconcile B's diary ────────────────────────────────────────
            // WHITELIST: only authedUserId's diary.
            // DiaryEntryRow uses entry_id, not id — use swapByMatch.
            const diaryKey = queryKeys.users.diary(user.id);
            // Restaurant info isn't in the v1 server response — fall back to the
            // input payload (same data the optimistic row used).
            const serverDiaryRow: DiaryEntryRow = {
                entry_id: result.entry_id,
                restaurant_id: result.restaurant_id ?? '',
                restaurant_name: result.restaurant?.name ?? input.restaurant?.name ?? '',
                city: result.restaurant?.city ?? input.restaurant?.location?.locality ?? null,
                photo_url: result.restaurant?.photo_url ?? null,
                rating: result.rating,
                note: result.content,
                visited_at: result.visited_at,
                created_at: result.created_at,
                round_kind: 'merged',
                round_id: result.round_id,
            };
            qc.setQueryData<InfiniteData<Page<DiaryEntryRow>>>(diaryKey, (old) =>
                swapByMatch<DiaryEntryRow>(
                    old,
                    (row: DiaryEntryRow) => row.entry_id === `optimistic-${nonce}`,
                    () => serverDiaryRow,
                ),
            );

            // ── 2. Patch A's diary — skipped (privacy doctrine) ──────────────
            // We don't know A's user_id from here. Server reconciles on next refetch.
            // WHITELIST: only queryKeys.users.diary(authedUserId) is ever patched.

            // ── 3. Reconcile Table activity ───────────────────────────────────
            const allActivityCacheEntries = qc.getQueryCache().findAll({
                queryKey: queryKeys.tables.activityForTable(table_id),
                exact: false,
            });
            for (const cacheEntry of allActivityCacheEntries) {
                const actKey = cacheEntry.queryKey;
                qc.setQueryData<InfiniteData<Page<ActivityItem>>>(actKey as any, (old) => {
                    if (!old) return old;
                    // Remove A's solo entry (already done in onMutate, but be defensive).
                    let updated = removeByMatch<ActivityItem>(old, (row: ActivityItem) => row.id === entry_a_id);
                    // Swap B's optimistic round placeholder with server shape.
                    updated = swapByMatch<ActivityItem>(
                        updated,
                        (row: ActivityItem) => row.id === `optimistic-${nonce}`,
                        () => serverRound as ActivityItem,
                    );
                    return updated ?? old;
                });
            }

            // ── 4. Narrow-invalidate restaurant page table history ────────────
            qc.invalidateQueries({
                queryKey: queryKeys.restaurants.tableHistory(restaurant_id, table_id),
                exact: false,
            });

            // ── 4b. Narrow-invalidate target Table activity ───────────────────
            // The optimistic swap above patches with the v1 server response
            // (no restaurant or participant projection). Invalidate so the
            // next refetch pulls the canonical merged-round shape from
            // fn_table_activity_page (full participants, restaurant info).
            qc.invalidateQueries({
                queryKey: queryKeys.tables.activityForTable(table_id),
                exact: false,
            });

            // ── 5. Seed the merged-round detail cache ─────────────────────────
            if (result.round_id) {
                qc.setQueryData(queryKeys.rounds.detail(result.round_id), result);
            }
        },
    });
}
