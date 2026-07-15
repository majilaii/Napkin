/**
 * RailSubLabel — the small inline label above a rail INSIDE a section
 * (TICKET-191). Deliberately subordinate to SectionHeader: kicker-weight
 * uppercase Manrope in muted ink, so Collections keeps exactly ONE real
 * section header while its two rails (Lists, Imports) stay individually
 * labeled. The optional right action keeps a 44pt hit target.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    title: string;
    rightLabel?: string;
    onRightLabelPress?: () => void;
}

export function RailSubLabel({ title, rightLabel, onRightLabelPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.row}>
            <Text
                style={[Type.sectionKicker, { color: palette.textMuted }]}
                maxFontSizeMultiplier={1.8}
            >
                {title}
            </Text>
            {rightLabel && onRightLabelPress ? (
                <Pressable
                    onPress={onRightLabelPress}
                    style={styles.action}
                    accessibilityRole="button"
                    accessibilityLabel={rightLabel}
                >
                    <Text
                        style={[Type.labelSmall, { color: palette.primary }]}
                        maxFontSizeMultiplier={1.6}
                    >
                        {rightLabel}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        // Aligns with the 22pt rail padding (ListsShelf / ImportsStrip cards).
        paddingHorizontal: 22,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    action: {
        minWidth: 44,
        minHeight: 44,
        marginVertical: -12,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
});
