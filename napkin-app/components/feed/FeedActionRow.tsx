/**
 * FeedActionRow — inline like/reply footer for feed cards (Messenger/IG style).
 *
 * - Tap heart = toggle ❤️
 * - Long-press heart = open ReactionPicker (🔥 😋 ❤️ 💯 👀)
 * - Tap reply = navigate to the detail screen with composer focused
 * - Right side: top emoji summary + counts (tap goes to detail)
 *
 * Optimistic: local `likedEmoji` + count bumps immediately on press; the
 * backing mutation invalidates the feed query so the server numbers win after
 * a tick. Failures revert via the mutation's onError.
 */
import React, { useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    findNodeHandle,
    UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import type { TargetType, EmojiCount } from '@/hooks/posts/usePostInteractions';
import { queryKeys } from '@/lib/queryKeys';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface FeedActionRowProps {
    targetType: TargetType;
    targetId: string;
    topEmojis: EmojiCount[];
    reactionCount: number;
    commentCount: number;
    myReactions: string[]; // emojis the current user has already reacted with
    palette: Palette;
    /** Route + params to open detail view (for tap-reply & tap-summary). */
    detailPathname: '/entry-detail' | '/table-night-detail';
    detailParams: Record<string, string>;
    /** Optional — invalidated after reactions change so cards refresh. */
    tableId?: string;
}

export function FeedActionRow({
    targetType,
    targetId,
    topEmojis,
    reactionCount,
    commentCount,
    myReactions,
    palette,
    detailPathname,
    detailParams,
    tableId,
}: FeedActionRowProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const toggleReaction = useToggleReaction();

    // Local optimistic overlay on top of server-provided props.
    const [localLiked, setLocalLiked] = useState<string | null>(
        myReactions.includes('❤️') ? '❤️' : myReactions[0] ?? null
    );
    const [countDelta, setCountDelta] = useState(0);

    // Picker anchor measurement
    const anchorRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

    const effectiveCount = Math.max(0, reactionCount + countDelta);
    const liked = !!localLiked;

    const invalidateFeed = () => {
        if (tableId) {
            queryClient.invalidateQueries({
                queryKey: ['tableActivity', tableId],
                exact: false,
            });
        }
    };

    const applyToggle = (emoji: string) => {
        // If user already has this emoji set → remove it; otherwise switch/add it.
        const hadThisEmoji = localLiked === emoji;
        const wasLiked = liked;

        if (hadThisEmoji) {
            setLocalLiked(null);
            setCountDelta((d) => d - 1);
        } else {
            setLocalLiked(emoji);
            // If switching from a different emoji: net zero; if new: +1
            if (!wasLiked) setCountDelta((d) => d + 1);
        }

        // If switching emojis, we need to remove the old one AND add the new one.
        if (!hadThisEmoji && wasLiked && localLiked) {
            toggleReaction.mutate(
                { targetType, targetId, emoji: localLiked },
                { onSuccess: invalidateFeed }
            );
        }

        toggleReaction.mutate(
            { targetType, targetId, emoji },
            {
                onSuccess: invalidateFeed,
                onError: () => {
                    // Revert optimistic state
                    setLocalLiked(wasLiked ? localLiked : null);
                    setCountDelta((d) => (hadThisEmoji ? d + 1 : wasLiked ? d : d - 1));
                },
            }
        );
    };

    const handleTapLike = () => {
        // If user already has ANY reaction, tap removes it. Otherwise default to ❤️.
        applyToggle(liked ? localLiked! : '❤️');
    };

    const handleLongPress = () => {
        if (!anchorRef.current) return;
        const handle = findNodeHandle(anchorRef.current);
        if (handle == null) return;
        UIManager.measureInWindow(handle, (x, y) => {
            setPickerAnchor({ x, y });
        });
    };

    const handlePick = (emoji: string) => {
        setPickerAnchor(null);
        applyToggle(emoji);
    };

    const openDetail = () => {
        router.push({ pathname: detailPathname, params: detailParams });
    };

    const openDetailFocusReply = () => {
        router.push({
            pathname: detailPathname,
            params: { ...detailParams, focus: 'reply' },
        });
    };

    // Build summary: top-2 distinct emojis (merging user's optimistic pick).
    const summaryEmojis: string[] = [];
    for (const t of topEmojis) {
        if (!summaryEmojis.includes(t.emoji)) summaryEmojis.push(t.emoji);
        if (summaryEmojis.length >= 2) break;
    }
    if (liked && localLiked && !summaryEmojis.includes(localLiked)) {
        summaryEmojis.unshift(localLiked);
        summaryEmojis.splice(2);
    }

    const likedColor = palette.primary;

    return (
        <View style={styles.row}>
            {/* Like */}
            <Pressable
                ref={anchorRef}
                onPress={handleTapLike}
                onLongPress={handleLongPress}
                delayLongPress={220}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={liked ? 'Unlike' : 'Like (long-press to pick an emoji)'}
                style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            >
                {liked ? (
                    <Text style={styles.likedEmoji} allowFontScaling={false}>
                        {localLiked}
                    </Text>
                ) : (
                    <Ionicons name="heart-outline" size={22} color={palette.textSecondary} />
                )}
                <Text
                    style={[
                        styles.btnLabel,
                        { color: liked ? likedColor : palette.textSecondary },
                    ]}
                >
                    {liked ? 'Liked' : 'Like'}
                </Text>
            </Pressable>

            {/* Reply */}
            <Pressable
                onPress={openDetailFocusReply}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Reply"
                style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            >
                <Ionicons
                    name="chatbubble-outline"
                    size={20}
                    color={palette.textSecondary}
                />
                <Text style={[styles.btnLabel, { color: palette.textSecondary }]}>
                    Reply
                </Text>
            </Pressable>

            <View style={{ flex: 1 }} />

            {/* Summary (right-aligned, tappable → detail) */}
            {(effectiveCount > 0 || commentCount > 0) && (
                <Pressable
                    onPress={openDetail}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="See reactions and replies"
                    style={({ pressed }) => [styles.summary, pressed && { opacity: 0.6 }]}
                >
                    {summaryEmojis.length > 0 && (
                        <View style={styles.summaryEmojis}>
                            {summaryEmojis.map((e, i) => (
                                <Text
                                    key={e}
                                    style={[
                                        styles.summaryEmoji,
                                        i > 0 && { marginLeft: -6 },
                                    ]}
                                    allowFontScaling={false}
                                >
                                    {e}
                                </Text>
                            ))}
                            {effectiveCount > 0 && (
                                <Text
                                    style={[
                                        styles.summaryCount,
                                        { color: palette.textSecondary },
                                    ]}
                                >
                                    {effectiveCount}
                                </Text>
                            )}
                        </View>
                    )}
                    {commentCount > 0 && (
                        <Text
                            style={[
                                styles.summaryCount,
                                { color: palette.textSecondary, marginLeft: 10 },
                            ]}
                        >
                            {commentCount} {commentCount === 1 ? 'reply' : 'replies'}
                        </Text>
                    )}
                </Pressable>
            )}

            <ReactionPicker
                visible={!!pickerAnchor}
                anchor={pickerAnchor}
                onPick={handlePick}
                onClose={() => setPickerAnchor(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        marginTop: Spacing.sm + 2,
        paddingVertical: 2,
    },
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderRadius: Radius.sm,
    },
    btnPressed: {
        opacity: 0.55,
    },
    btnLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12.5,
        letterSpacing: 0.2,
    },
    likedEmoji: {
        fontSize: 18,
        lineHeight: 22,
    },
    summary: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    summaryEmojis: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    summaryEmoji: {
        fontSize: 14,
        lineHeight: 18,
    },
    summaryCount: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginLeft: 6,
    },
});
