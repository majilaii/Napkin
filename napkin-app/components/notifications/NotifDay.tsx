/**
 * NotifDay — uppercase tracked day section header (Today / Yesterday / This week / Earlier).
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
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
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        paddingHorizontal: 22,
        paddingTop: 18,
        paddingBottom: 8,
    },
});
