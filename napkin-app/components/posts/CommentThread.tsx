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
            { targetType, targetId, body: trimmed, clientNonce: nonce, scope },
            { onSuccess: () => setBody('') },
        );
        setBody('');
    };

    return (
        <View style={styles.container}>
            {comments.length === 0 ? (
                <Text style={[styles.empty, { color: palette.textMuted }]}>
                    The table is quiet — say something.
                </Text>
            ) : (
                <View>
                    {comments.map((comment, idx) => (
                        <View
                            key={comment.id}
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
                                comment={comment}
                                targetType={targetType}
                                targetId={targetId}
                                scope={scope}
                                onRetry={
                                    comment.failed
                                        ? () => handleRetry(comment)
                                        : undefined
                                }
                                onDiscard={
                                    comment.failed
                                        ? () => handleDiscard(comment)
                                        : undefined
                                }
                            />
                        </View>
                    ))}
                </View>
            )}

            {repliesDisabled ? (
                <Text style={[styles.repliesOff, { color: palette.textMuted }]}>
                    The author has replies turned off.
                </Text>
            ) : (
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
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.sm + 4,
    },
    empty: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: Spacing.md,
    },
    repliesOff: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: Spacing.sm,
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
