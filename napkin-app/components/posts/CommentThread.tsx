/**
 * CommentThread — oldest-first reply list + paper composer.
 *
 * Replies flow as a single column with hairline dividers between rows.
 * Composer sits in a warm-cream slab with a small terracotta send pill.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
} from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useAddComment,
    useDiscardFailedComment,
} from '@/hooks/posts/usePostInteractions';
import type { Comment, TargetType, Scope } from '@/hooks/posts/usePostInteractions';
import { CommentRow } from './CommentRow';

interface CommentThreadProps {
    targetType: TargetType;
    targetId: string;
    comments: Comment[];
    scope?: Scope;
    autoFocusComposer?: boolean;
    /** When true, the composer is hidden and a muted line is shown instead. */
    repliesDisabled?: boolean;
}

const MAX_CHARS = 2000;
const COUNTER_THRESHOLD = 1900;

export function CommentThread({
    targetType,
    targetId,
    comments,
    scope = 'table',
    autoFocusComposer,
    repliesDisabled = false,
}: CommentThreadProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const addComment = useAddComment();
    const discardFailed = useDiscardFailedComment();
    const [body, setBody] = useState('');
    const inputRef = useRef<TextInput>(null);
    // TICKET-085: reply target (parentCommentId = thread root; name = person replied to).
    const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);

    // Group into one level of nesting — roots + replies-by-root (orphans → roots).
    const rootComments = comments.filter((c) => !c.parent_id);
    const rootIdSet = new Set(rootComments.map((c) => c.id));
    const repliesByRoot = new Map<string, Comment[]>();
    const orphanReplies: Comment[] = [];
    for (const c of comments) {
        if (!c.parent_id) continue;
        if (rootIdSet.has(c.parent_id)) {
            const arr = repliesByRoot.get(c.parent_id) ?? [];
            arr.push(c);
            repliesByRoot.set(c.parent_id, arr);
        } else {
            orphanReplies.push(c);
        }
    }
    const threadRoots = [...rootComments, ...orphanReplies];

    const startReply = (rootId: string, name: string) => {
        setReplyingTo({ id: rootId, name });
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleRetry = (failed: Comment) => {
        const nonce = failed.client_nonce;
        if (!nonce) return;
        discardFailed({ targetType, targetId, clientNonce: nonce, scope });
        addComment.mutate({
            targetType,
            targetId,
            body: failed.body,
            clientNonce: nonce,
            scope,
            // Preserve threading on retry — else a failed reply would re-post top-level.
            parentCommentId: failed.parent_id ?? undefined,
        });
    };

    const handleDiscard = (failed: Comment) => {
        if (!failed.client_nonce) return;
        discardFailed({
            targetType,
            targetId,
            clientNonce: failed.client_nonce,
            scope,
        });
    };

    useEffect(() => {
        if (autoFocusComposer) {
            const t = setTimeout(() => inputRef.current?.focus(), 250);
            return () => clearTimeout(t);
        }
    }, [autoFocusComposer]);

    const trimmed = body.trim();
    const canSend = trimmed.length >= 1 && !addComment.isPending;
    const showCounter = body.length >= COUNTER_THRESHOLD;

    const handleSend = () => {
        if (!canSend) return;
        const nonce = `nonce-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;
        addComment.mutate(
            { targetType, targetId, body: trimmed, clientNonce: nonce, scope, parentCommentId: replyingTo?.id },
            { onSuccess: () => setBody('') },
        );
        setBody('');
        setReplyingTo(null);
    };

    return (
        <View style={styles.container}>
            {/* No empty-state prompt — the composer carries the invite. */}
            {comments.length === 0 ? null : (
                <View>
                    {threadRoots.map((root, idx) => (
                        <View
                            key={root.id}
                            style={
                                idx > 0
                                    ? {
                                          borderTopWidth:
                                              StyleSheet.hairlineWidth,
                                          borderTopColor: palette.dividerSoft,
                                      }
                                    : undefined
                            }
                        >
                            <CommentRow
                                comment={root}
                                targetType={targetType}
                                targetId={targetId}
                                scope={scope}
                                canReply={!repliesDisabled}
                                onReply={() => startReply(root.id, root.profiles?.display_name ?? 'Someone')}
                                onRetry={root.failed ? () => handleRetry(root) : undefined}
                                onDiscard={root.failed ? () => handleDiscard(root) : undefined}
                            />
                            {(repliesByRoot.get(root.id) ?? []).map((reply) => (
                                <CommentRow
                                    key={reply.id}
                                    comment={reply}
                                    targetType={targetType}
                                    targetId={targetId}
                                    scope={scope}
                                    isReply
                                    canReply={!repliesDisabled}
                                    onReply={() => startReply(root.id, reply.profiles?.display_name ?? 'Someone')}
                                    onRetry={reply.failed ? () => handleRetry(reply) : undefined}
                                    onDiscard={reply.failed ? () => handleDiscard(reply) : undefined}
                                />
                            ))}
                        </View>
                    ))}
                </View>
            )}

            {repliesDisabled ? (
                <Text style={[styles.repliesOff, { color: palette.textMuted }]}>
                    The author has replies turned off.
                </Text>
            ) : (
                <>
                {replyingTo ? (
                    <View style={styles.replyChip}>
                        <Text style={[styles.replyChipText, { color: palette.textSecondary }]} numberOfLines={1}>
                            {'Replying to '}
                            <Text style={{ fontFamily: 'Manrope_700Bold', color: palette.text }}>{replyingTo.name}</Text>
                        </Text>
                        <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                            <Text style={{ color: palette.textMuted, fontSize: 14 }}>✕</Text>
                        </Pressable>
                    </View>
                ) : null}
                <View
                    style={[
                        styles.composer,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            borderColor: palette.outlineVariant,
                        },
                    ]}
                >
                    <TextInput
                        ref={inputRef}
                        value={body}
                        onChangeText={(t) => {
                            if (t.length <= MAX_CHARS) setBody(t);
                        }}
                        placeholder="Say something…"
                        placeholderTextColor={palette.textMuted}
                        style={[styles.input, { color: palette.text }]}
                        multiline
                        maxLength={MAX_CHARS}
                        returnKeyType="default"
                        blurOnSubmit={false}
                        accessibilityLabel="Reply composer"
                    />

                    {showCounter && (
                        <Text
                            style={[
                                styles.counter,
                                {
                                    color:
                                        body.length >= MAX_CHARS
                                            ? palette.error
                                            : palette.textMuted,
                                },
                            ]}
                        >
                            {body.length}/{MAX_CHARS}
                        </Text>
                    )}

                    <Pressable
                        onPress={handleSend}
                        disabled={!canSend}
                        accessibilityLabel="Send reply"
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.sendBtn,
                            {
                                backgroundColor: canSend
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                                opacity: pressed ? 0.8 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.sendArrow,
                                {
                                    color: canSend
                                        ? palette.background
                                        : palette.textMuted,
                                },
                            ]}
                        >
                            ↑
                        </Text>
                    </Pressable>
                </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.sm + 4,
    },
    repliesOff: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: Spacing.sm,
    },
    replyChip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
        marginTop: Spacing.xs,
    },
    replyChipText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        flex: 1,
    },
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingLeft: Spacing.md,
        paddingRight: Spacing.sm,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
        marginTop: Spacing.xs,
    },
    input: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        maxHeight: 88,
        paddingTop: 0,
        paddingBottom: 0,
    },
    counter: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
    },
    sendBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sendArrow: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 16,
        lineHeight: 18,
    },
});
