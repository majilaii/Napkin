/**
 * Hooks for post interactions (reactions + comments on table_nights and entries).
 *
 * Query key: ['postInteractions', targetType, targetId, scope]
 * Cache shape: { reactions: Reaction[], comments: Comment[], counts: Counts }
 *
 * TICKET-021: scope is REQUIRED on every read and mutation.
 * - scope='table'  → Table-scoped reactions/replies (existing behavior)
 * - scope='public' → Public restaurant-page reactions/replies (new)
 * Missing scope returns 400 from the edge function; callers must always pass it.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/providers/ToastProvider';

// ── Types ────────────────────────────────────────────────────────────────────

export type Scope = 'table' | 'public';

export interface ReactionProfile {
    display_name: string;
    avatar_url: string | null;
    username?: string | null;
}

export interface Reaction {
    id: string;
    user_id: string;
    emoji: string;
    created_at: string;
    profiles: ReactionProfile | null;
}

export interface CommentProfile {
    display_name: string;
    avatar_url: string | null;
    username?: string | null;
}

export interface Comment {
    id: string;
    user_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    profiles: CommentProfile | null;
    /** Present on optimistic rows only — removed once the server row lands */
    pending?: boolean;
    /** Set on optimistic rows whose send failed — UI shows retry/discard */
    failed?: boolean;
    /** Client-generated nonce for optimistic reconciliation */
    client_nonce?: string;
}

export interface EmojiCount {
    emoji: string;
    count: number;
    last_reacted_at: string;
}

export interface InteractionCounts {
    reactions: number;
    comments: number;
    top_emojis: EmojiCount[];
}

export interface PostInteractionsData {
    reactions: Reaction[];
    comments: Comment[];
    counts: InteractionCounts;
}

export type TargetType = 'table_night' | 'entry';

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchPostInteractions(
    targetType: TargetType,
    targetId: string,
    scope: Scope,
): Promise<PostInteractionsData> {
    const data = await callEdgeFn<PostInteractionsData | null>('post-interactions', {
        method: 'GET',
        params: { target_type: targetType, target_id: targetId, scope },
    });
    return data ?? { reactions: [], comments: [], counts: { reactions: 0, comments: 0, top_emojis: [] } };
}

// ── Query hook ───────────────────────────────────────────────────────────────

export function usePostInteractions(
    targetType: TargetType | null | undefined,
    targetId: string | null | undefined,
    scope: Scope = 'table',
) {
    return useQuery<PostInteractionsData, Error>({
        queryKey: queryKeys.postInteractions.all(targetType!, targetId!, scope),
        queryFn: () => fetchPostInteractions(targetType!, targetId!, scope),
        enabled: !!targetType && !!targetId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Mutation: toggle reaction ────────────────────────────────────────────────

interface ToggleReactionInput {
    targetType: TargetType;
    targetId: string;
    emoji: string;
    scope: Scope;
}

export function useToggleReaction() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: async ({ targetType, targetId, emoji, scope }: ToggleReactionInput) => {
            return callEdgeFn<{ added: boolean; removed: boolean; reaction: Reaction | null }>(
                'post-interactions',
                {
                    action: 'react',
                    body: { target_type: targetType, target_id: targetId, emoji, scope },
                },
            );
        },

        onMutate: async ({ targetType, targetId, emoji, scope }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId, scope);
            await queryClient.cancelQueries({ queryKey: key });

            // Only invalidate feed caches for table-scope reactions (public reactions
            // don't affect Table feed cards)
            if (scope === 'table') {
                await queryClient.cancelQueries({ queryKey: queryKeys.tables.activityAll() });
                await queryClient.cancelQueries({ queryKey: queryKeys.feed.rootAll() });
            }

            const previous = queryClient.getQueryData<PostInteractionsData>(key);
            const userId = (await supabase.auth.getUser()).data.user?.id;

            // Snapshot every feed-side cache so we can roll back on error
            const feedSnapshots: Array<{ key: readonly unknown[]; data: unknown }> = [];
            if (scope === 'table') {
                queryClient.getQueriesData<any>({ queryKey: queryKeys.tables.activityAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
                queryClient.getQueriesData<any>({ queryKey: queryKeys.feed.rootAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
            }

            if (previous && userId) {
                const alreadyReacted = previous.reactions.some(
                    (r) => r.user_id === userId && r.emoji === emoji
                );

                const nextReactions = alreadyReacted
                    ? previous.reactions.filter((r) => !(r.user_id === userId && r.emoji === emoji))
                    : [
                          ...previous.reactions,
                          {
                              id: `optimistic-${Date.now()}`,
                              user_id: userId,
                              emoji,
                              created_at: new Date().toISOString(),
                              profiles: null,
                          } satisfies Reaction,
                      ];

                queryClient.setQueryData<PostInteractionsData>(key, {
                    ...previous,
                    reactions: nextReactions,
                    counts: {
                        ...previous.counts,
                        reactions: nextReactions.length,
                    },
                });
            }

            if (scope === 'table') {
                // Flips reaction_count + my_reactions on the matching item.
                // Shared by both cache shapes since they use the same field names.
                const flipItem = (item: any) => {
                    if (item?.id !== targetId) return item;
                    const currentReactions: string[] = item.my_reactions ?? [];
                    const has = currentReactions.includes(emoji);
                    return {
                        ...item,
                        my_reactions: has
                            ? currentReactions.filter((e) => e !== emoji)
                            : [...currentReactions, emoji],
                        reaction_count: has
                            ? Math.max(0, (item.reaction_count ?? 0) - 1)
                            : (item.reaction_count ?? 0) + 1,
                    };
                };

                // tableActivity = useInfiniteQuery → { pages: ActivityItem[][] }
                queryClient.setQueriesData<{ pages: any[][]; pageParams: unknown[] }>(
                    { queryKey: queryKeys.tables.activityAll() },
                    (data) => {
                        if (!data?.pages) return data;
                        return {
                            ...data,
                            pages: data.pages.map((page) => page.map(flipItem)),
                        };
                    },
                );

                // feed = useQuery → { entries: FeedEntry[], trending, windowDays }
                queryClient.setQueriesData<{ entries: any[]; [k: string]: unknown }>(
                    { queryKey: queryKeys.feed.rootAll() },
                    (data) => {
                        if (!data?.entries) return data;
                        return { ...data, entries: data.entries.map(flipItem) };
                    },
                );
            }

            return { previous, feedSnapshots };
        },

        onError: (_err, { targetType, targetId, scope }, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    queryKeys.postInteractions.all(targetType, targetId, scope),
                    context.previous
                );
            }
            // Roll back every feed cache we optimistically touched
            if (context?.feedSnapshots) {
                for (const { key, data } of context.feedSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
            toast.show("Couldn't react. Try again.");
        },

        onSuccess: (_data, { targetType, targetId, scope }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId, scope),
            });
            if (scope === 'table') {
                // Refetch every feed-side cache so counts reconcile with server truth
                queryClient.invalidateQueries({ queryKey: queryKeys.tables.activityAll() });
                queryClient.invalidateQueries({ queryKey: queryKeys.feed.rootAll() });
            }
        },
    });
}

// ── Mutation: add comment ────────────────────────────────────────────────────

interface AddCommentInput {
    targetType: TargetType;
    targetId: string;
    body: string;
    clientNonce?: string;
    scope: Scope;
}

export function useAddComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ targetType, targetId, body, clientNonce, scope }: AddCommentInput) => {
            return callEdgeFn<Comment & { client_nonce?: string }>('post-interactions', {
                action: 'comment',
                body: {
                    target_type: targetType,
                    target_id: targetId,
                    body,
                    scope,
                    ...(clientNonce ? { client_nonce: clientNonce } : {}),
                },
            });
        },

        onMutate: async ({ targetType, targetId, body, clientNonce, scope }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId, scope);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<PostInteractionsData>(key);
            const userId = (await supabase.auth.getUser()).data.user?.id;

            // TICKET-036 P1-10 (symmetry with delete): increment feed-card
            // comment_count optimistically so the count pill reflects the new
            // comment immediately. Snapshot for rollback.
            const feedSnapshots: Array<{ key: readonly unknown[]; data: unknown }> = [];
            if (scope === 'table') {
                queryClient.getQueriesData<any>({ queryKey: queryKeys.tables.activityAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
                queryClient.getQueriesData<any>({ queryKey: queryKeys.feed.rootAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
            }

            if (previous && userId) {
                const optimisticComment: Comment = {
                    id: clientNonce ?? `optimistic-${Date.now()}`,
                    user_id: userId,
                    body,
                    created_at: new Date().toISOString(),
                    edited_at: null,
                    profiles: null,
                    pending: true,
                    client_nonce: clientNonce,
                };

                queryClient.setQueryData<PostInteractionsData>(key, {
                    ...previous,
                    comments: [...previous.comments, optimisticComment],
                    counts: {
                        ...previous.counts,
                        comments: previous.counts.comments + 1,
                    },
                });
            }

            if (scope === 'table') {
                const incrementItem = (item: any) => {
                    if (item?.id !== targetId) return item;
                    return { ...item, comment_count: (item.comment_count ?? 0) + 1 };
                };
                queryClient.setQueriesData<{ pages: any[][]; pageParams: unknown[] }>(
                    { queryKey: queryKeys.tables.activityAll() },
                    (data: { pages: any[][]; pageParams: unknown[] } | undefined) => {
                        if (!data?.pages) return data;
                        return { ...data, pages: data.pages.map((page) => page.map(incrementItem)) };
                    },
                );
                queryClient.setQueriesData<any>(
                    { queryKey: queryKeys.feed.rootAll() },
                    (data: any) => {
                        if (!data) return data;
                        if (data.pages) {
                            return { ...data, pages: data.pages.map((p: any) => ({ ...p, rows: p.rows?.map(incrementItem) ?? p.rows })) };
                        }
                        if (data.entries) return { ...data, entries: data.entries.map(incrementItem) };
                        return data;
                    },
                );
            }

            return { previous, feedSnapshots };
        },

        onError: (_err, { targetType, targetId, clientNonce, scope }, context) => {
            const key = queryKeys.postInteractions.all(targetType, targetId, scope);
            const current = queryClient.getQueryData<PostInteractionsData>(key);

            // Keep the optimistic row visible but mark it as failed so the UI
            // can render Retry / Discard. Decrement the comment count so the
            // failed row doesn't inflate the feed-card pill.
            if (current && clientNonce) {
                const next = current.comments.map((c) =>
                    c.client_nonce === clientNonce
                        ? { ...c, pending: false, failed: true }
                        : c
                );
                queryClient.setQueryData<PostInteractionsData>(key, {
                    ...current,
                    comments: next,
                    counts: {
                        ...current.counts,
                        comments: Math.max(0, current.counts.comments - 1),
                    },
                });
            } else if (context?.previous) {
                queryClient.setQueryData(key, context.previous);
            }

            // Roll back feed-card increments
            if (context?.feedSnapshots) {
                for (const { key: feedKey, data } of context.feedSnapshots) {
                    queryClient.setQueryData(feedKey, data);
                }
            }
        },

        onSuccess: (serverComment, { targetType, targetId, scope }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId, scope);
            const current = queryClient.getQueryData<PostInteractionsData>(key);

            if (current) {
                // Replace the optimistic row with the server row (matched by client_nonce or optimistic id)
                const nonce = serverComment.client_nonce;
                const nextComments = current.comments.map((c) => {
                    if (nonce && c.client_nonce === nonce) {
                        return { ...serverComment, pending: false };
                    }
                    if (!nonce && c.pending && c.id.startsWith('optimistic-')) {
                        return { ...serverComment, pending: false };
                    }
                    return c;
                });
                queryClient.setQueryData<PostInteractionsData>(key, {
                    ...current,
                    comments: nextComments,
                });
            }

            // Invalidate to get fresh server data
            queryClient.invalidateQueries({ queryKey: key });
        },
    });
}

// ── Mutation: edit comment ───────────────────────────────────────────────────

interface EditCommentInput {
    targetType: TargetType;
    targetId: string;
    commentId: string;
    body: string;
    scope: Scope;
}

export function useEditComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ commentId, body, scope }: EditCommentInput) => {
            return callEdgeFn<Comment>('post-interactions', {
                action: 'edit_comment',
                body: { comment_id: commentId, body, scope },
            });
        },

        onSuccess: (_data, { targetType, targetId, scope }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId, scope),
            });
        },
    });
}

// ── Mutation: delete comment ─────────────────────────────────────────────────

interface DeleteCommentInput {
    targetType: TargetType;
    targetId: string;
    commentId: string;
    scope: Scope;
}

export function useDeleteComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ commentId, scope }: DeleteCommentInput) => {
            return callEdgeFn<{ id: string }>('post-interactions', {
                action: 'delete_comment',
                body: { comment_id: commentId, scope },
            });
        },

        onMutate: async ({ targetType, targetId, commentId, scope }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId, scope);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<PostInteractionsData>(key);

            // TICKET-036 P1-10: snapshot feed-side caches too so we can
            // decrement comment_count on the matching card and roll back.
            const feedSnapshots: Array<{ key: readonly unknown[]; data: unknown }> = [];
            if (scope === 'table') {
                queryClient.getQueriesData<any>({ queryKey: queryKeys.tables.activityAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
                queryClient.getQueriesData<any>({ queryKey: queryKeys.feed.rootAll() })
                    .forEach(([k, data]) => {
                        if (data) feedSnapshots.push({ key: k, data });
                    });
            }

            if (previous) {
                queryClient.setQueryData<PostInteractionsData>(key, {
                    ...previous,
                    comments: previous.comments.filter((c) => c.id !== commentId),
                    counts: {
                        ...previous.counts,
                        comments: Math.max(0, previous.counts.comments - 1),
                    },
                });
            }

            // Decrement comment_count on the matching feed card so the count
            // pill updates instantly. Only meaningful for table-scope.
            if (scope === 'table') {
                const decrementItem = (item: any) => {
                    if (item?.id !== targetId) return item;
                    return { ...item, comment_count: Math.max(0, (item.comment_count ?? 0) - 1) };
                };
                queryClient.setQueriesData<{ pages: any[][]; pageParams: unknown[] }>(
                    { queryKey: queryKeys.tables.activityAll() },
                    (data: { pages: any[][]; pageParams: unknown[] } | undefined) => {
                        if (!data?.pages) return data;
                        return { ...data, pages: data.pages.map((page) => page.map(decrementItem)) };
                    },
                );
                queryClient.setQueriesData<any>(
                    { queryKey: queryKeys.feed.rootAll() },
                    (data: any) => {
                        if (!data) return data;
                        if (data.pages) {
                            return { ...data, pages: data.pages.map((p: any) => ({ ...p, rows: p.rows?.map(decrementItem) ?? p.rows })) };
                        }
                        if (data.entries) return { ...data, entries: data.entries.map(decrementItem) };
                        return data;
                    },
                );
            }

            return { previous, feedSnapshots };
        },

        onError: (_err, { targetType, targetId, scope }, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    queryKeys.postInteractions.all(targetType, targetId, scope),
                    context.previous
                );
            }
            if (context?.feedSnapshots) {
                for (const { key, data } of context.feedSnapshots) {
                    queryClient.setQueryData(key, data);
                }
            }
        },

        onSuccess: (_data, { targetType, targetId, scope }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId, scope),
            });
        },
    });
}

// ── Helper: discard a failed optimistic comment ──────────────────────────────

/** Remove a failed optimistic comment from the cache (no server call). */
export function useDiscardFailedComment() {
    const queryClient = useQueryClient();
    return ({
        targetType,
        targetId,
        clientNonce,
        scope = 'table',
    }: {
        targetType: TargetType;
        targetId: string;
        clientNonce: string;
        scope?: Scope;
    }) => {
        const key = queryKeys.postInteractions.all(targetType, targetId, scope);
        const current = queryClient.getQueryData<PostInteractionsData>(key);
        if (!current) return;
        queryClient.setQueryData<PostInteractionsData>(key, {
            ...current,
            comments: current.comments.filter((c) => c.client_nonce !== clientNonce),
        });
    };
}
