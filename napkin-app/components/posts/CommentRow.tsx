/**
 * CommentRow — a single comment in the thread.
 *
 * Shows: avatar, display name, body, relative timestamp, "· edited" marker.
 * Author sees "..." menu for edit (within 5 min) and delete.
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
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useEditComment, useDeleteComment } from '@/hooks/posts/usePostInteractions';
import type { Comment, TargetType } from '@/hooks/posts/usePostInteractions';

interface CommentRowProps {
    comment: Comment;
    targetType: TargetType;
    targetId: string;
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
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function CommentRow({ comment, targetType, targetId, onRetry, onDiscard }: CommentRowProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();
    const editComment = useEditComment();
    const deleteComment = useDeleteComment();

    const [isEditing, setIsEditing] = useState(false);
    const [editBody, setEditBody] = useState(comment.body);

    const isAuthor = !!user && comment.user_id === user.id;
    const ageMs = Date.now() - new Date(comment.created_at).getTime();
    const canEdit = isAuthor && ageMs < 5 * 60 * 1000 && !comment.pending;
    const canDelete = isAuthor && !comment.pending;

    const name = comment.profiles?.display_name ?? 'Someone';
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

    const timeLabel = comment.failed
        ? "Couldn't send"
        : comment.pending
        ? 'Sending…'
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
                }
            );
        } else {
            const alertOptions = [];
            if (canEdit) {
                alertOptions.push({ text: 'Edit', onPress: () => setIsEditing(true) });
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
        deleteComment.mutate({
            targetType,
            targetId,
            commentId: comment.id,
        });
    };

    const handleSaveEdit = () => {
        const trimmed = editBody.trim();
        if (!trimmed) return;
        editComment.mutate(
            { targetType, targetId, commentId: comment.id, body: trimmed },
            {
                onSuccess: () => setIsEditing(false),
                onError: () => setIsEditing(false),
            }
        );
    };

    return (
        <View style={styles.row}>
            {/* Avatar */}
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

            {/* Content */}
            <View style={styles.content}>
                <View style={styles.nameRow}>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>{name}</Text>
                    <Text
                        style={[
                            Type.caption,
                            {
                                color: comment.pending ? palette.textMuted : palette.textMuted,
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
                            <Text style={[Type.caption, { color: palette.textMuted }]}>
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
                                <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                                    Cancel
                                </Text>
                            </Pressable>
                            <Pressable onPress={handleSaveEdit} hitSlop={8}>
                                <Text
                                    style={[
                                        Type.bodySmall,
                                        { color: palette.primary, fontFamily: 'Manrope_700Bold' },
                                    ]}
                                >
                                    Save
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                ) : (
                    <>
                        <Text
                            style={[
                                Type.body,
                                {
                                    color:
                                        comment.pending || comment.failed
                                            ? palette.textMuted
                                            : palette.text,
                                    marginTop: 2,
                                    lineHeight: 20,
                                },
                            ]}
                        >
                            {comment.body}
                        </Text>
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
                                                Type.bodySmall,
                                                {
                                                    color: palette.primary,
                                                    fontFamily: 'Manrope_700Bold',
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
                                                Type.bodySmall,
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
        gap: Spacing.sm,
        alignItems: 'flex-start',
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatarInitials: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
    content: {
        flex: 1,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        flexWrap: 'wrap',
    },
    menuBtn: {
        marginLeft: 'auto',
        paddingHorizontal: 4,
    },
    editContainer: {
        marginTop: Spacing.xs,
        gap: Spacing.xs,
    },
    editInput: {
        borderWidth: 1,
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
    failedActions: {
        flexDirection: 'row',
        gap: Spacing.md,
        marginTop: Spacing.xs,
    },
});
