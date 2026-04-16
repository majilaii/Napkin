/**
 * InteractionPill — compact preview of reactions and comments on a feed card.
 *
 * Shows top 2 emoji by count (with count), then a separator dot, then
 * "N reply" or "N replies". Either segment is omitted if 0.
 * Only renders when reaction_count ≥ 1 OR comment_count ≥ 1.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { EmojiCount } from '@/hooks/posts/usePostInteractions';

interface InteractionPillProps {
    topEmojis: EmojiCount[];
    commentCount: number;
    reactionCount: number;
    textColor: string;
    backgroundColor?: string;
}

export function InteractionPill({
    topEmojis,
    commentCount,
    reactionCount,
    textColor,
    backgroundColor,
}: InteractionPillProps) {
    if (reactionCount < 1 && commentCount < 1) return null;

    const top2 = topEmojis.slice(0, 2);

    const emojiSegment = top2.length > 0
        ? top2.map(({ emoji, count }) => `${emoji} ${count}`).join('  ')
        : null;

    const replySegment = commentCount > 0
        ? `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}`
        : null;

    const parts: string[] = [];
    if (emojiSegment) parts.push(emojiSegment);
    if (replySegment) parts.push(replySegment);

    const pillText = parts.join('  ·  ');

    return (
        <View
            style={[
                styles.pill,
                backgroundColor ? { backgroundColor } : undefined,
            ]}
        >
            <Text
                style={[styles.text, { color: textColor }]}
                numberOfLines={1}
            >
                {pillText}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    text: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 16,
    },
});
