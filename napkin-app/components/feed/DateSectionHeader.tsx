/**
 * DateSectionHeader — sticky section header for the feed SectionList.
 * Manrope uppercase, textMuted, ghosted divider.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

interface DateSectionHeaderProps {
    title: string;
    palette: Palette;
}

export function DateSectionHeader({ title, palette }: DateSectionHeaderProps) {
    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.background },
            ]}
        >
            <Text
                style={[
                    styles.label,
                    { color: palette.textMuted },
                ]}
            >
                {title}
            </Text>
            <View
                style={[
                    styles.rule,
                    { backgroundColor: palette.divider },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 1.54,
        textTransform: 'uppercase',
        marginBottom: Spacing.xs,
    },
    rule: {
        height: 1,
    },
});
