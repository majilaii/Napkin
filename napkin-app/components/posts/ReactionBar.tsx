/**
 * ReactionBar — a horizontal row of 5 fixed emoji chips.
 *
 * - Tap to toggle own reaction
 * - Count shown only when > 0
 * - Active chip: primaryMuted background + primary text
 * - Inactive chip: surfaceContainerLow background + textSecondary text
 * - Long-press on chip with count ≥ 1 opens ReactorsSheet
 * - Disabled when no targetId (e.g. unrevealed round — caller controls rendering)
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    AccessibilityInfo,
} from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import type { Reaction, TargetType } from '@/hooks/posts/usePostInteractions';
import { ReactorsSheet } from './ReactorsSheet';

const EMOJI_SET = ['🔥', '😋', '❤️', '💯', '👀'] as const;

const EMOJI_NAMES: Record<string, string> = {
    '🔥': 'fire',
    '😋': 'delicious',
    '❤️': 'heart',
    '💯': 'perfect',
    '👀': 'eyes',
};

interface ReactionBarProps {
    targetType: TargetType;
    targetId: string;
    reactions: Reaction[];
}

export function ReactionBar({ targetType, targetId, reactions }: ReactionBarProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();
    const toggleReaction = useToggleReaction();
    const [sheetEmoji, setSheetEmoji] = useState<string | null>(null);

    // Build per-emoji summary
    const emojiData = EMOJI_SET.map((emoji) => {
        const reactors = reactions.filter((r) => r.emoji === emoji);
        const count = reactors.length;
        const userReacted = !!user && reactors.some((r) => r.user_id === user.id);
        return { emoji, count, userReacted, reactors };
    });

    const handleToggle = (emoji: string) => {
        toggleReaction.mutate({ targetType, targetId, emoji });
    };

    const handleLongPress = (emoji: string, count: number) => {
        if (count >= 1) setSheetEmoji(emoji);
    };

    const sheetReactors = sheetEmoji
        ? reactions
              .filter((r) => r.emoji === sheetEmoji)
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [];

    return (
        <>
            <View style={styles.row}>
                {emojiData.map(({ emoji, count, userReacted }) => {
                    const emojiName = EMOJI_NAMES[emoji] ?? emoji;
                    const label = userReacted
                        ? `You reacted with ${emojiName}${count > 1 ? `, ${count} reactions` : ''}`
                        : `React with ${emojiName}${count > 0 ? `, ${count} reactions` : ''}`;

                    return (
                        <Pressable
                            key={emoji}
                            onPress={() => handleToggle(emoji)}
                            onLongPress={() => handleLongPress(emoji, count)}
                            delayLongPress={400}
                            accessible
                            accessibilityRole="button"
                            accessibilityLabel={label}
                            style={({ pressed }) => [
                                styles.chip,
                                userReacted
                                    ? { backgroundColor: palette.primaryMuted }
                                    : { backgroundColor: palette.surfaceContainerLow },
                                pressed && styles.chipPressed,
                            ]}
                            hitSlop={4}
                        >
                            <Text
                                style={styles.chipEmoji}
                                allowFontScaling={false}
                            >
                                {emoji}
                            </Text>
                            {count > 0 && (
                                <Text
                                    style={[
                                        styles.chipCount,
                                        {
                                            color: userReacted
                                                ? palette.primary
                                                : palette.textSecondary,
                                        },
                                    ]}
                                >
                                    {count}
                                </Text>
                            )}
                        </Pressable>
                    );
                })}
            </View>

            {sheetEmoji && (
                <ReactorsSheet
                    emoji={sheetEmoji}
                    reactors={sheetReactors}
                    onClose={() => setSheetEmoji(null)}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: Spacing.xs,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: Radius.full,
        minWidth: 40,
        minHeight: 40,
        justifyContent: 'center',
    },
    chipPressed: {
        opacity: 0.7,
    },
    chipEmoji: {
        fontSize: 16,
        lineHeight: 20,
    },
    chipCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        lineHeight: 16,
    },
});
