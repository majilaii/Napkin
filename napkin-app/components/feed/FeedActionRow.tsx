/**
 * FeedActionRow — whisper-quiet footer.
 *
 *   ♡                              ♥ 4   2 replies
 *
 * Tap heart → like / unlike (heart-only since 2026-07-10 — no emoji picker).
 * Tap summary → detail. No word labels, no rule. The parent card is the frame.
 */
import React from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Colors, Spacing } from '@/constants/theme';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import type { TargetType } from '@/hooks/posts/usePostInteractions';

type Palette = typeof Colors.light;

interface FeedActionRowProps {
    targetType: TargetType;
    targetId: string;
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
    reactionCount,
    commentCount,
    myReactions,
    palette,
    detailPathname,
    detailParams,
    tableId,
}: FeedActionRowProps) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();

    // Display state is driven entirely by props (which come from the TanStack Query
    // cache that useToggleReaction optimistically updates). No local deltas.
    // Liked = any reaction of mine (legacy emoji rows count and unlike the same way).
    const liked = myReactions.length > 0;

    const handleTapLike = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // TICKET-043: thread tableId so multi-Table entries route to the requesting Table.
        // Cards in aggregate feeds pass undefined → server fallback finds any linked Table.
        const emoji = myReactions[0] ?? '❤️';
        toggleReaction.mutate({ targetType, targetId, emoji, scope: 'table', tableId });
    };

    const openDetail = () =>
        router.push({ pathname: detailPathname, params: detailParams });

    const hasSummary = reactionCount > 0 || commentCount > 0;

    return (
        <View style={styles.row}>
            <Pressable
                onPress={handleTapLike}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={liked ? 'Unlike' : 'Like'}
                style={({ pressed }) => [
                    styles.heartBtn,
                    pressed && { opacity: 0.55 },
                ]}
            >
                <Ionicons
                    name={liked ? 'heart' : 'heart-outline'}
                    size={16}
                    color={liked ? palette.primary : palette.textMuted}
                />
            </Pressable>

            <View style={{ flex: 1 }} />

            {hasSummary && (
                <Pressable
                    onPress={openDetail}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="See likes and replies"
                    style={({ pressed }) => [
                        styles.summary,
                        pressed && { opacity: 0.55 },
                    ]}
                >
                    {reactionCount > 0 && (
                        <View style={styles.summaryLikes}>
                            <Ionicons name="heart" size={12} color={palette.primary} />
                            <Text
                                style={[
                                    styles.summaryCount,
                                    { color: palette.textSecondary },
                                ]}
                            >
                                {reactionCount}
                            </Text>
                        </View>
                    )}
                    {commentCount > 0 && (
                        <Text
                            style={[
                                styles.replyCount,
                                {
                                    color: palette.textMuted,
                                    marginLeft: reactionCount > 0 ? 12 : 0,
                                },
                            ]}
                        >
                            {commentCount}{' '}
                            {commentCount === 1 ? 'reply' : 'replies'}
                        </Text>
                    )}
                </Pressable>
            )}
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
    summary: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    summaryLikes: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    summaryCount: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
    replyCount: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.1,
        fontVariant: ['tabular-nums'],
    },
});
