/**
 * DateSectionHeader — sticky section header for the feed SectionList.
 * Newsreader italic, textMuted, 1px divider bottom border.
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
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    label: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 18,
        marginBottom: Spacing.xs,
    },
    rule: {
        height: 1,
    },
});
