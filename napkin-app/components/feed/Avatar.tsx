/**
 * Avatar — initials-based circle avatar with deterministic tint.
 * Extracted from tables.tsx for reuse across feed components.
 *
 * Optional `onPress` prop: wraps the visual in a Pressable with
 * a 44x44pt minimum tap target (hitSlop). When omitted, renders as a View.
 */

import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

interface AvatarProps {
    name: string;
    url: string | null;
    size: number;
    palette: Palette;
    onPress?: () => void;
}

export function Avatar({ name, url, size, palette, onPress }: AvatarProps) {
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

    // Ensure tap target is at least 44x44pt via hitSlop
    const hitSlop = size < 44 ? Math.ceil((44 - size) / 2) : 0;

    const visual = url ? (
        <Image source={{ uri: url }} style={baseStyle} />
    ) : (
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

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                hitSlop={hitSlop}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
                {visual}
            </Pressable>
        );
    }

    return visual;
}
