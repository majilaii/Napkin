/** Shared, quickly scannable heading for For You sections. */
import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function SectionKicker({ children }: { children: React.ReactNode }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Text
            style={[styles.kicker, { color: palette.text }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.8}
        >
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    kicker: {
        ...Type.sectionTitle,
        paddingHorizontal: Spacing.lg,
        marginTop: 22,
        marginBottom: 10,
    },
});
