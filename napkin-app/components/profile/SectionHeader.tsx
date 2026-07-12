/**
 * SectionHeader — the single structural heading used across Profile.
 * TICKET-025
 *
 * Upright Manrope makes module boundaries obvious at a glance. The optional
 * action uses the same functional voice and keeps a 40pt hit target.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    title: string;
    rightLabel?: string;
    onRightLabelPress?: () => void;
    small?: boolean;
}

export function SectionHeader({ title, rightLabel, onRightLabelPress, small = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.container, small ? styles.small : styles.normal]}>
            <Text
                style={[
                    small ? Type.titleMedium : Type.sectionTitle,
                    {
                        color: palette.text,
                    },
                ]}
                accessibilityRole="header"
                maxFontSizeMultiplier={1.8}
            >
                {title}
            </Text>
            {rightLabel && (
                onRightLabelPress ? (
                    <Pressable
                        onPress={onRightLabelPress}
                        style={styles.action}
                        accessibilityRole="button"
                        accessibilityLabel={rightLabel}
                    >
                        <Text
                            style={[Type.label, { color: palette.primary }]}
                            maxFontSizeMultiplier={1.6}
                        >
                            {rightLabel}
                        </Text>
                    </Pressable>
                ) : (
                    <Text
                        style={[Type.label, { color: palette.primary }]}
                        maxFontSizeMultiplier={1.6}
                    >
                        {rightLabel}
                    </Text>
                )
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
    },
    normal: {
        paddingTop: Spacing.xl,
        paddingBottom: 12,
    },
    small: {
        paddingTop: Spacing.lg,
        paddingBottom: 12,
    },
    action: {
        minWidth: 40,
        minHeight: 40,
        marginVertical: -8,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
});
