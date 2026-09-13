/**
 * NotifDay — uppercase tracked day section header (Today / Yesterday / This week / Earlier).
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    children: string;
}

export function NotifDay({ children }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Text style={[styles.label, { color: palette.textMuted }]}>
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    label: {
        ...Type.sectionKicker,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
});
