import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    total: number | null;
    onPress: () => void;
}

export function AllReviewsFolio({ total, onPress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const label = total != null && total > 0
        ? `all ${total} review${total === 1 ? '' : 's'}`
        : 'all reviews';

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel="all reviews"
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.card },
                Shadow.ambient,
                pressed && styles.pressed,
            ]}
        >
            <Text style={[styles.text, { color: palette.text }]}>{label}</Text>
            <Text style={[styles.arrow, { color: palette.primary }]}>→</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 60,
        borderRadius: Radius.md,
        paddingLeft: Spacing.md + 2,
        paddingRight: Spacing.md,
        paddingVertical: Spacing.sm,
        marginTop: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    text: {
        ...Type.headlineMedium,
        flex: 1,
    },
    arrow: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 20,
        lineHeight: 24,
        marginLeft: Spacing.md,
    },
    pressed: {
        opacity: 0.7,
    },
});
