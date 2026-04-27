/**
 * HomeChip — amber HOME designation chip.
 * Appears on the claimed city block when is_home = true.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function HomeChip() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[
                styles.chip,
                {
                    backgroundColor: palette.tertiaryFixed,
                    borderRadius: Radius.sm,
                },
            ]}
        >
            <Text style={[Type.labelSmall, { color: palette.amberInk }]}>HOME</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignSelf: 'flex-start',
    },
});
