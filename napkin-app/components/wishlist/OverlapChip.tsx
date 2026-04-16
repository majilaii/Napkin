/**
 * OverlapChip — "N of you" label shown on Table wishlist cards.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface OverlapChipProps {
    count: number;
}

export function OverlapChip({ count }: OverlapChipProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.chip, { backgroundColor: palette.tertiaryFixed }]}>
            <Text style={[styles.label, { color: palette.tertiary }]}>
                {count} of you
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.full,
        alignSelf: 'flex-start',
    },
    label: {
        ...Type.caption,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
});
