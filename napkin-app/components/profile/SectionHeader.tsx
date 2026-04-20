/**
 * SectionHeader — editorial italic serif section header.
 * TICKET-025
 *
 * Matches the canvas: Newsreader italic at 17pt, with optional
 * uppercase right-label in terracotta (e.g. "SEE ALL", "EDIT").
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
                    Type.headlineItalic,
                    {
                        fontSize: small ? 15 : 17,
                        color: palette.text,
                        fontFamily: 'Newsreader_400Regular_Italic',
                    },
                ]}
            >
                {title}
            </Text>
            {rightLabel && (
                onRightLabelPress ? (
                    <Pressable onPress={onRightLabelPress} hitSlop={8}>
                        <Text style={[Type.labelSmall, { color: palette.primary }]}>
                            {rightLabel}
                        </Text>
                    </Pressable>
                ) : (
                    <Text style={[Type.labelSmall, { color: palette.primary }]}>
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
        paddingHorizontal: Spacing.lg,
    },
    normal: {
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    small: {
        paddingTop: Spacing.md,
        paddingBottom: Spacing.sm,
    },
});
