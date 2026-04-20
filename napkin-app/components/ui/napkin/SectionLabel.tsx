/**
 * SectionLabel — uppercase editorial kicker used throughout the canvas.
 *
 * Two variants:
 *   default (label)   — 11pt / 1.5 ls / 700 (text-secondary)
 *   small             — 9pt  / 1.0 ls / 600 (text-muted)
 *
 * Optional right-label renders in terracotta (e.g. SEE ALL, 12 more).
 * Canvas reference: primitives.jsx → Label, LabelSmall + TSectionLabel.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    children: string;
    rightLabel?: string;
    onRightPress?: () => void;
    /** Use 9pt/1.0 ls muted variant instead of the 11pt/1.5 ls default */
    small?: boolean;
    /** Horizontal padding override (canvas default: 22) */
    paddingX?: number;
    /** Top padding override */
    paddingTop?: number;
    /** Bottom padding override */
    paddingBottom?: number;
}

export function SectionLabel({
    children,
    rightLabel,
    onRightPress,
    small = false,
    paddingX = 22,
    paddingTop,
    paddingBottom,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const labelStyle = small ? styles.small : styles.default;
    const color = small ? palette.textMuted : palette.textSecondary;

    return (
        <View
            style={[
                styles.row,
                {
                    paddingHorizontal: paddingX,
                    paddingTop: paddingTop ?? 14,
                    paddingBottom: paddingBottom ?? 8,
                },
            ]}
        >
            <Text style={[labelStyle, { color }]}>{children}</Text>
            {rightLabel &&
                (onRightPress ? (
                    <Pressable onPress={onRightPress} hitSlop={8}>
                        <Text style={[styles.right, { color: palette.primary }]}>
                            {rightLabel}
                        </Text>
                    </Pressable>
                ) : (
                    <Text style={[styles.right, { color: palette.primary }]}>
                        {rightLabel}
                    </Text>
                ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    default: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    small: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    right: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
    },
});

export default SectionLabel;
