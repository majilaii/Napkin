/**
 * FeedActionRow — whisper-quiet footer.
 *
 *   ♡                              😋🔥 · 4   2 replies
 *
 * Tap heart → ❤️. Long-press heart → ReactionPicker. Tap summary → detail.
 * No word labels, no rule. The parent card is the frame.
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

import { Colors, Spacing } from '@/constants/theme';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import type { TargetType, EmojiCount } from '@/hooks/posts/usePostInteractions';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface FeedActionRowProps {
    targetType: TargetType;
    targetId: string;
    topEmojis: EmojiCount[];
    reactionCount: number;
    commentCount: number;
    myReactions: string[];
    palette: Palette;
    detailPathname: '/entry-detail' | '/table-night-detail';
    detailParams: Record<string, string>;
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

    const [localLiked, setLocalLiked] = useState<string | null>(
        myReactions.includes('❤️') ? '❤️' : myReactions[0] ?? null,
    );
    const [countDelta, setCountDelta] = useState(0);

    const anchorRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{
        x: number;
        y: number;
    } | null>(null);

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
        const hadThisEmoji = localLiked === emoji;
        const wasLiked = liked;

        if (hadThisEmoji) {
            setLocalLiked(null);
            setCountDelta((d) => d - 1);
        } else {
            setLocalLiked(emoji);
            if (!wasLiked) setCountDelta((d) => d + 1);
        }

        if (!hadThisEmoji && wasLiked && localLiked) {
            toggleReaction.mutate(
                { targetType, targetId, emoji: localLiked },
                { onSuccess: invalidateFeed },
            );
        }

        toggleReaction.mutate(
            { targetType, targetId, emoji },
            {
                onSuccess: invalidateFeed,
                onError: () => {
                    setLocalLiked(wasLiked ? localLiked : null);
                    setCountDelta((d) =>
                        hadThisEmoji ? d + 1 : wasLiked ? d : d - 1,
                    );
                },
            },
        );
    };

    const handleTapLike = () => {
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

    const openDetail = () =>
        router.push({ pathname: detailPathname, params: detailParams });

    const summaryEmojis: string[] = [];
    for (const t of topEmojis) {
        if (!summaryEmojis.includes(t.emoji)) summaryEmojis.push(t.emoji);
        if (summaryEmojis.length >= 2) break;
    }
    if (liked && localLiked && !summaryEmojis.includes(localLiked)) {
        summaryEmojis.unshift(localLiked);
        summaryEmojis.splice(2);
    }

    const hasSummary = effectiveCount > 0 || commentCount > 0;

    return (
        <View style={styles.row}>
            <Pressable
                ref={anchorRef}
                onPress={handleTapLike}
                onLongPress={handleLongPress}
                delayLongPress={220}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={
                    liked ? 'Unlike' : 'Like (long-press to pick an emoji)'
                }
                style={({ pressed }) => [
                    styles.heartBtn,
                    pressed && { opacity: 0.55 },
                ]}
            >
                {liked ? (
                    <Text style={styles.likedEmoji} allowFontScaling={false}>
                        {localLiked}
                    </Text>
                ) : (
                    <Ionicons
                        name="heart-outline"
                        size={16}
                        color={palette.textMuted}
                    />
                )}
            </Pressable>

            <View style={{ flex: 1 }} />

            {hasSummary && (
                <Pressable
                    onPress={openDetail}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="See reactions and replies"
                    style={({ pressed }) => [
                        styles.summary,
                        pressed && { opacity: 0.55 },
                    ]}
                >
                    {summaryEmojis.length > 0 && (
                        <View style={styles.summaryEmojis}>
                            {summaryEmojis.map((e, i) => (
                                <Text
                                    key={e}
                                    style={[
                                        styles.summaryEmoji,
                                        i > 0 && { marginLeft: -5 },
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
                                styles.replyCount,
                                {
                                    color: palette.textMuted,
                                    marginLeft: summaryEmojis.length > 0 ? 12 : 0,
                                },
                            ]}
                        >
                            {commentCount}{' '}
                            {commentCount === 1 ? 'reply' : 'replies'}
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
        marginTop: Spacing.sm,
        minHeight: 18,
    },
    heartBtn: {
        paddingVertical: 2,
        paddingRight: 4,
    },
    likedEmoji: {
        fontSize: 14,
        lineHeight: 16,
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
        fontSize: 13,
        lineHeight: 16,
    },
    summaryCount: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        marginLeft: 6,
    },
    replyCount: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.1,
    },
});
