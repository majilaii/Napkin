/**
 * Hooks for post interactions (reactions + comments on table_nights and entries).
 *
 * Query key: ['postInteractions', targetType, targetId]
 * Cache shape: { reactions: Reaction[], comments: Comment[], counts: Counts }
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReactionProfile {
    display_name: string;
    avatar_url: string | null;
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
    targetId: string
): Promise<PostInteractionsData> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke(
        `post-interactions?target_type=${targetType}&target_id=${targetId}`,
        {
            method: 'GET',
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data ?? { reactions: [], comments: [], counts: { reactions: 0, comments: 0, top_emojis: [] } };
}

// ── Query hook ───────────────────────────────────────────────────────────────

export function usePostInteractions(
    targetType: TargetType | null | undefined,
    targetId: string | null | undefined
) {
    return useQuery<PostInteractionsData, Error>({
        queryKey: queryKeys.postInteractions.all(targetType!, targetId!),
        queryFn: () => fetchPostInteractions(targetType!, targetId!),
        enabled: !!targetType && !!targetId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Mutation: toggle reaction ────────────────────────────────────────────────

interface ToggleReactionInput {
    targetType: TargetType;
    targetId: string;
    emoji: string;
}

export function useToggleReaction() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ targetType, targetId, emoji }: ToggleReactionInput) => {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('post-interactions', {
                body: { action: 'react', target_type: targetType, target_id: targetId, emoji },
                headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : undefined,
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data as { added: boolean; removed: boolean; reaction: Reaction | null };
        },

        onMutate: async ({ targetType, targetId, emoji }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<PostInteractionsData>(key);
            const userId = (await supabase.auth.getUser()).data.user?.id;

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

            return { previous };
        },

        onError: (_err, { targetType, targetId }, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    queryKeys.postInteractions.all(targetType, targetId),
                    context.previous
                );
            }
        },

        onSuccess: (_data, { targetType, targetId }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId),
            });
        },
    });
}

// ── Mutation: add comment ────────────────────────────────────────────────────

interface AddCommentInput {
    targetType: TargetType;
    targetId: string;
    body: string;
    clientNonce?: string;
}

export function useAddComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ targetType, targetId, body, clientNonce }: AddCommentInput) => {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('post-interactions', {
                body: {
                    action: 'comment',
                    target_type: targetType,
                    target_id: targetId,
                    body,
                    ...(clientNonce ? { client_nonce: clientNonce } : {}),
                },
                headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : undefined,
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data as Comment & { client_nonce?: string };
        },

        onMutate: async ({ targetType, targetId, body, clientNonce }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<PostInteractionsData>(key);
            const userId = (await supabase.auth.getUser()).data.user?.id;

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

            return { previous };
        },

        onError: (_err, { targetType, targetId }, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    queryKeys.postInteractions.all(targetType, targetId),
                    context.previous
                );
            }
        },

        onSuccess: (serverComment, { targetType, targetId }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId);
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
}

export function useEditComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ commentId, body }: EditCommentInput) => {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('post-interactions', {
                body: { action: 'edit_comment', comment_id: commentId, body },
                headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : undefined,
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data as Comment;
        },

        onSuccess: (_data, { targetType, targetId }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId),
            });
        },
    });
}

// ── Mutation: delete comment ─────────────────────────────────────────────────

interface DeleteCommentInput {
    targetType: TargetType;
    targetId: string;
    commentId: string;
}

export function useDeleteComment() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ commentId }: DeleteCommentInput) => {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('post-interactions', {
                body: { action: 'delete_comment', comment_id: commentId },
                headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : undefined,
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data as { id: string };
        },

        onMutate: async ({ targetType, targetId, commentId }) => {
            const key = queryKeys.postInteractions.all(targetType, targetId);
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<PostInteractionsData>(key);

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

            return { previous };
        },

        onError: (_err, { targetType, targetId }, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    queryKeys.postInteractions.all(targetType, targetId),
                    context.previous
                );
            }
        },

        onSuccess: (_data, { targetType, targetId }) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.postInteractions.all(targetType, targetId),
            });
        },
    });
}
