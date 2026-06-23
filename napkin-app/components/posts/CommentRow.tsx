/**
 * CommentRow — a single reply rendered as a margin note.
 * Avatar 24px + content: name · time, Manrope body.
 * Parent renders hairline dividers between rows.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Alert,
    ActionSheetIOS,
    Platform,
    TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useEditComment, useDeleteComment, useToggleCommentLike } from '@/hooks/posts/usePostInteractions';
import type { Comment, TargetType, Scope } from '@/hooks/posts/usePostInteractions';

interface CommentRowProps {
    comment: Comment;
    targetType: TargetType;
    targetId: string;
    scope?: Scope;
    /** TICKET-085: one level of nesting + per-comment ❤️/Reply affordances. */
    isReply?: boolean;
    canReply?: boolean;
    onReply?: () => void;
    onRetry?: () => void;
    onDiscard?: () => void;
}

function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
    });
}

export function CommentRow({
    comment,
    targetType,
    targetId,
    scope = 'table',
    isReply = false,
    canReply = true,
    onReply,
    onRetry,
    onDiscard,
}: CommentRowProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();
    const editComment = useEditComment();
    const deleteComment = useDeleteComment();
    const toggleLike = useToggleCommentLike();

    const [isEditing, setIsEditing] = useState(false);
    const [editBody, setEditBody] = useState(comment.body);

    const isAuthor = !!user && comment.user_id === user.id;
    const ageMs = Date.now() - new Date(comment.created_at).getTime();
    const canEdit = isAuthor && ageMs < 5 * 60 * 1000 && !comment.pending;
    const canDelete = isAuthor && !comment.pending;
    const interactive = !comment.pending && !comment.failed;
    const liked = !!comment.viewer_liked;
    const likeCount = comment.like_count ?? 0;

    const handleToggleLike = () => {
        if (!interactive) return;
        toggleLike.mutate({ targetType, targetId, commentId: comment.id, scope });
    };

    const name = comment.profiles?.display_name ?? 'Someone';
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const timeLabel = comment.failed
        ? "couldn't send"
        : comment.pending
        ? 'sending…'
        : formatRelativeTime(comment.created_at);

    const handleMenu = () => {
        const options = canEdit
            ? ['Cancel', 'Edit', 'Delete']
            : ['Cancel', 'Delete'];
        const cancelIndex = 0;
        const deleteIndex = options.length - 1;
        const editIndex = canEdit ? 1 : -1;

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options,
                    cancelButtonIndex: cancelIndex,
                    destructiveButtonIndex: deleteIndex,
                },
                (idx) => {
                    if (canEdit && idx === editIndex) setIsEditing(true);
                    if (idx === deleteIndex) handleDelete();
                },
            );
        } else {
            const alertOptions = [];
            if (canEdit) {
                alertOptions.push({
                    text: 'Edit',
                    onPress: () => setIsEditing(true),
                });
            }
            alertOptions.push({
                text: 'Delete',
                style: 'destructive' as const,
                onPress: handleDelete,
            });
            alertOptions.push({ text: 'Cancel', style: 'cancel' as const });
            Alert.alert('Comment', undefined, alertOptions);
        }
    };

    const handleDelete = () => {
        deleteComment.mutate({ targetType, targetId, commentId: comment.id, scope });
    };

    const handleSaveEdit = () => {
        const trimmed = editBody.trim();
        if (!trimmed) return;
        editComment.mutate(
            { targetType, targetId, commentId: comment.id, body: trimmed, scope },
            {
                onSuccess: () => setIsEditing(false),
                onError: () => setIsEditing(false),
            },
        );
    };

    const muted = comment.pending || comment.failed;

    return (
        <View style={[styles.row, isReply && styles.replyRow, { opacity: muted ? 0.7 : 1 }]}>
            <View
                style={[
                    styles.avatar,
                    { backgroundColor: palette.secondaryContainer },
                ]}
            >
                <Text style={[styles.avatarInitials, { color: palette.text }]}>
                    {initials}
                </Text>
            </View>

            <View style={styles.content}>
                <View style={styles.nameRow}>
                    <Text style={[styles.name, { color: palette.text }]}>
                        {name}
                    </Text>
                    <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                    <Text
                        style={[
                            styles.time,
                            {
                                color: palette.textMuted,
                                fontStyle: comment.pending ? 'italic' : 'normal',
                            },
                        ]}
                    >
                        {timeLabel}
                        {comment.edited_at && !comment.pending ? ' · edited' : ''}
                    </Text>
                    {isAuthor && canDelete && !isEditing && (
                        <Pressable
                            onPress={handleMenu}
                            hitSlop={8}
                            style={styles.menuBtn}
                            accessibilityLabel="Comment options"
                        >
                            <Text
                                style={[styles.menuDots, { color: palette.textMuted }]}
                            >
                                •••
                            </Text>
                        </Pressable>
                    )}
                </View>

                {isEditing ? (
                    <View style={styles.editContainer}>
                        <TextInput
                            value={editBody}
                            onChangeText={setEditBody}
                            style={[
                                styles.editInput,
                                {
                                    color: palette.text,
                                    borderColor: palette.outlineVariant,
                                    backgroundColor: palette.surfaceContainerLow,
                                },
                            ]}
                            multiline
                            maxLength={2000}
                            autoFocus
                            placeholderTextColor={palette.textMuted}
                        />
                        <View style={styles.editActions}>
                            <Pressable
                                onPress={() => {
                                    setIsEditing(false);
                                    setEditBody(comment.body);
                                }}
                                hitSlop={8}
                            >
                                <Text
                                    style={[
                                        styles.actionLabel,
                                        { color: palette.textSecondary },
                                    ]}
                                >
                                    Cancel
                                </Text>
                            </Pressable>
                            <Pressable onPress={handleSaveEdit} hitSlop={8}>
                                <Text
                                    style={[
                                        styles.actionLabel,
                                        {
                                            color: palette.primary,
                                            fontFamily: 'Manrope_700Bold',
                                        },
                                    ]}
                                >
                                    Save
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                ) : (
                    <>
                        <Text style={[styles.body, { color: palette.text }]}>
                            {comment.body}
                        </Text>
                        {interactive && (
                            <View style={styles.actions}>
                                <Pressable onPress={handleToggleLike} disabled={toggleLike.isPending} hitSlop={6} accessibilityLabel={liked ? 'Unlike' : 'Love'}>
                                    <Text style={[styles.actionBtn, { color: liked ? palette.primary : palette.textMuted }]}>
                                        {liked ? 'Loved' : 'Love'}
                                    </Text>
                                </Pressable>
                                {canReply && onReply && (
                                    <Pressable onPress={onReply} hitSlop={6} accessibilityLabel="Reply">
                                        <Text style={[styles.actionBtn, { color: palette.textMuted }]}>Reply</Text>
                                    </Pressable>
                                )}
                                {likeCount > 0 && (
                                    <View style={styles.likeCount}>
                                        <Ionicons name="heart" size={11} color={palette.primary} />
                                        <Text style={[styles.actionBtn, { color: palette.textMuted }]}>{likeCount}</Text>
                                    </View>
                                )}
                            </View>
                        )}
                        {comment.failed && (
                            <View style={styles.failedActions}>
                                {onRetry && (
                                    <Pressable
                                        onPress={onRetry}
                                        hitSlop={8}
                                        accessibilityLabel="Retry sending reply"
                                    >
                                        <Text
                                            style={[
                                                styles.actionLabel,
                                                {
                                                    color: palette.primary,
                                                    fontFamily:
                                                        'Manrope_700Bold',
                                                },
                                            ]}
                                        >
                                            Retry
                                        </Text>
                                    </Pressable>
                                )}
                                {onDiscard && (
                                    <Pressable
                                        onPress={onDiscard}
                                        hitSlop={8}
                                        accessibilityLabel="Discard failed reply"
                                    >
                                        <Text
                                            style={[
                                                styles.actionLabel,
                                                { color: palette.textSecondary },
                                            ]}
                                        >
                                            Discard
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        )}
                    </>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: Spacing.sm + 2,
        alignItems: 'flex-start',
        paddingVertical: Spacing.sm + 2,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatarInitials: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9.5,
    },
    content: {
        flex: 1,
        paddingTop: 1,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    dot: {
        fontSize: 11,
    },
    time: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        letterSpacing: 0.1,
    },
    menuBtn: {
        marginLeft: 'auto',
        paddingHorizontal: 4,
    },
    menuDots: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 12,
    },
    body: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 3,
    },
    editContainer: {
        marginTop: Spacing.xs + 2,
        gap: Spacing.xs,
    },
    editInput: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.sm,
        padding: Spacing.sm,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        minHeight: 48,
    },
    editActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: Spacing.md,
    },
    actionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    failedActions: {
        flexDirection: 'row',
        gap: Spacing.md,
        marginTop: Spacing.xs + 2,
    },
    replyRow: { marginLeft: 28 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
    actionBtn: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
    likeCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
