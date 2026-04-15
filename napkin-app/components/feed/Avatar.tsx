/**
 * Avatar — initials-based circle avatar with deterministic tint.
 * Extracted from tables.tsx for reuse across feed components.
 */

import React from 'react';
import { View, Text, Image } from 'react-native';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

interface AvatarProps {
    name: string;
    url: string | null;
    size: number;
    palette: Palette;
}

export function Avatar({ name, url, size, palette }: AvatarProps) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [
        palette.tertiaryFixed,
        palette.secondaryContainer,
        palette.primaryMuted,
    ];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    const baseStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    };

    if (url) return <Image source={{ uri: url }} style={baseStyle} />;

    return (
        <View style={baseStyle}>
            <Text
                style={{
                    fontFamily: 'Manrope_600SemiBold',
                    fontSize: size * 0.36,
                    color: palette.text,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}
