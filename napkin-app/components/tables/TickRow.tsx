/**
 * TickRow — compact timeline row for minor events in the Tables feed.
 * Canvas: TTick in tables-flows.jsx.
 *
 * Kinds: 'pin' (wishlist add), 'gather' (scheduling), 'anniversary' (table
 * milestone), 'suggestion' (algorithmic nudge). Icon colour follows kind.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;
export type TickKind = 'pin' | 'gather' | 'anniversary' | 'suggestion';

interface TickRowProps {
    kind: TickKind;
    who?: string;
    what: string;
    when?: string;
    palette: Palette;
    onPress?: () => void;
}

const ICON: Record<TickKind, keyof typeof Ionicons.glyphMap> = {
    pin: 'location-outline',
    gather: 'calendar-outline',
    anniversary: 'ribbon-outline',
    suggestion: 'sparkles-outline',
};

export function TickRow({ kind, who, what, when, palette, onPress }: TickRowProps) {
    const colorFor = (k: TickKind) => {
        switch (k) {
            case 'pin':
                return palette.secondary;
            case 'gather':
                return palette.primary;
            case 'anniversary':
                return palette.tertiary;
            case 'suggestion':
                return palette.textMuted;
        }
    };
    const color = colorFor(kind);

    const content = (
        <>
            <Ionicons name={ICON[kind]} size={14} color={color} />
            <Text style={[styles.text, { color: palette.textSecondary }]} numberOfLines={2}>
                {who ? (
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: palette.text }}>
                        {who}{' '}
                    </Text>
                ) : null}
                {what}
            </Text>
            {when ? (
                <Text style={[styles.when, { color: palette.textMuted }]}>{when}</Text>
            ) : null}
        </>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
            >
                {content}
            </Pressable>
        );
    }

    return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
    row: {
        marginHorizontal: 22,
        marginBottom: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    text: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 17,
    },
    when: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
});
