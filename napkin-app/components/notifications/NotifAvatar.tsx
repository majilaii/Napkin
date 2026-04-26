/**
 * NotifAvatar — leading circular avatar for notification rows.
 * Falls back to italic-serif initials in a warm cream circle.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    src?: string | null;
    name?: string;
    size?: number;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 1).toUpperCase();
}

export function NotifAvatar({ src, name = '?', size = 32 }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[
                styles.wrap,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: palette.primaryContainer,
                },
            ]}
        >
            {src ? (
                <Image
                    source={{ uri: src }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                />
            ) : (
                <Text style={[styles.initials, { fontSize: Math.round(size * 0.4) }]}>
                    {initials(name)}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    initials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        color: 'rgba(255,255,255,0.92)',
    },
});
