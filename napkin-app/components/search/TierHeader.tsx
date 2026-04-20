import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface TierHeaderProps {
    label: string;
}

export function TierHeader({ label }: TierHeaderProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.container}>
            <Text style={[Type.labelSmall, { color: palette.textMuted }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
});
