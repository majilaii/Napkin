/**
 * NotifThumb — small Polaroid-style thumbnail for notification rows.
 * Tall (3:4) by default; pass tall={false} for a square trailing chip.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { Colors, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    src?: string | null;
    size?: number;
    tall?: boolean;
}

export function NotifThumb({ src, size = 38, tall = true }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const height = tall ? Math.round(size * 1.22) : size;

    return (
        <View
            style={[
                styles.wrap,
                {
                    width: size,
                    height,
                    backgroundColor: palette.surfaceJournalLow,
                    ...Shadow.clip,
                },
            ]}
        >
            {src ? (
                <Image
                    source={{ uri: src }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        borderRadius: 4,
        overflow: 'hidden',
    },
});
