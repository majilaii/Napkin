/**
 * CommentThread — oldest-first flat comment list + inline composer.
 *
 * - Empty state: muted italic "No replies yet — be the first."
 * - Composer: single-line input growing up to 4 lines, "Say something…" placeholder
 * - Send button activates when body.length ≥ 1 (after trim)
 * - 2000 char limit; counter shows once user passes 1900
 * - Optimistic send via useAddComment
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAddComment, useDiscardFailedComment } from '@/hooks/posts/usePostInteractions';
import type { Comment, TargetType } from '@/hooks/posts/usePostInteractions';
import { CommentRow } from './CommentRow';

interface CommentThreadProps {
    targetType: TargetType;
    targetId: string;
    comments: Comment[];
    /** When true, focus the composer on mount (used when opened via "Reply" tap). */
    autoFocusComposer?: boolean;
}

const MAX_CHARS = 2000;
const COUNTER_THRESHOLD = 1900;

export function CommentThread({ targetType, targetId, comments, autoFocusComposer }: CommentThreadProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const addComment = useAddComment();
    const discardFailed = useDiscardFailedComment();
    const [body, setBody] = useState('');
    const inputRef = useRef<TextInput>(null);

    const handleRetry = (failed: Comment) => {
        const nonce = failed.client_nonce;
        if (!nonce) return;
        // Drop the failed row, then re-send with the same nonce so any
        // late-arriving server response still reconciles correctly.
        discardFailed({ targetType, targetId, clientNonce: nonce });
        addComment.mutate({ targetType, targetId, body: failed.body, clientNonce: nonce });
    };

    const handleDiscard = (failed: Comment) => {
        if (!failed.client_nonce) return;
        discardFailed({ targetType, targetId, clientNonce: failed.client_nonce });
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
        const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        addComment.mutate(
            { targetType, targetId, body: trimmed, clientNonce: nonce },
            { onSuccess: () => setBody('') }
        );
        setBody('');
    };

    return (
        <View style={styles.container}>
            {/* Comment list */}
            {comments.length === 0 ? (
                <Text
                    style={[
                        Type.body,
                        {
                            color: palette.textMuted,
                            fontStyle: 'italic',
                            textAlign: 'center',
                            paddingVertical: Spacing.md,
                        },
                    ]}
                >
                    No replies yet — be the first.
                </Text>
            ) : (
                <View style={styles.list}>
                    {comments.map((comment) => (
                        <CommentRow
                            key={comment.id}
                            comment={comment}
                            targetType={targetType}
                            targetId={targetId}
                            onRetry={
                                comment.failed ? () => handleRetry(comment) : undefined
                            }
                            onDiscard={
                                comment.failed ? () => handleDiscard(comment) : undefined
                            }
                        />
                    ))}
                </View>
            )}

            {/* Composer */}
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
                    style={[
                        styles.input,
                        { color: palette.text },
                    ]}
                    multiline
                    maxLength={MAX_CHARS}
                    returnKeyType="default"
                    blurOnSubmit={false}
                    accessibilityLabel="Reply composer"
                />

                {showCounter && (
                    <Text
                        style={[
                            Type.caption,
                            { color: body.length >= MAX_CHARS ? palette.error : palette.textMuted },
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
                            backgroundColor: canSend ? palette.primary : palette.surfaceContainerHigh,
                            opacity: pressed ? 0.8 : 1,
                        },
                    ]}
                >
                    <Text
                        style={[
                            styles.sendArrow,
                            { color: canSend ? '#fff' : palette.textMuted },
                        ]}
                    >
                        ↑
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.md,
    },
    list: {
        gap: Spacing.md,
    },
    composer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.lg,
        paddingLeft: Spacing.md,
        paddingRight: Spacing.sm,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
    },
    input: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        maxHeight: 88, // ~4 lines at 22px line height
        paddingTop: 0,
        paddingBottom: 0,
    },
    sendBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sendArrow: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 16,
        lineHeight: 20,
    },
});
