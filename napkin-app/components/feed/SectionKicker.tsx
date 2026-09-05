/** Shared, quickly scannable heading for For You sections. */
import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function SectionKicker({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Text
            style={[styles.kicker, { color: palette.primary, marginTop: first ? 14 : 26 }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.8}
        >
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    kicker: {
        ...Type.sectionKicker,
        paddingHorizontal: Spacing.lg,
        marginTop: 26,
        marginBottom: 12,
    },
});
