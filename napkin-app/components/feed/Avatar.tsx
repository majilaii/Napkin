/**
 * Avatar — initials-based circle avatar with deterministic tint.
 * Extracted from tables.tsx for reuse across feed components.
 *
 * Optional `onPress` prop: wraps the visual in a Pressable with
 * a 44x44pt minimum tap target (hitSlop). When omitted, renders as a View.
 */

import React from 'react';
import { View, Text, Image } from 'react-native';
import { Colors } from '@/constants/theme';
import { PressableScale } from '@/components/ui/napkin/PressableScale';

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

    // Subtle hairline outline so images read as consistent depth against warm paper.
    const outlineStyle = {
        ...baseStyle,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.08)',
    };

    // Ensure tap target is at least 44x44pt via hitSlop
    const hitSlop = size < 44 ? Math.ceil((44 - size) / 2) : 0;

    const visual = url ? (
        <Image source={{ uri: url }} style={outlineStyle} />
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
            <PressableScale
                onPress={onPress}
                hitSlop={hitSlop}
                haptic="selection"
                scaleTo={0.94}
            >
                {visual}
            </PressableScale>
        );
    }

    return visual;
}
