/**
 * InitialsAvatar — small round avatar with initials fallback (TICKET-082).
 *
 * Mirrors the local InitialsAvatar in app/entry-detail.tsx (which isn't exported)
 * and the avatar treatment in restaurant/[id].tsx:863-909. Renders the photo when
 * present, else warm-tinted initials. Heirloom: amber-cream / olive-container /
 * terracotta-muted tints, ink text, never pure black.
 */
import React from 'react';
import { View, Text, Image } from 'react-native';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

interface InitialsAvatarProps {
    name: string | null | undefined;
    avatarUrl?: string | null;
    size: number;
    palette: Palette;
}

export function InitialsAvatar({ name, avatarUrl, size, palette }: InitialsAvatarProps) {
    if (avatarUrl) {
        return (
            <Image
                source={{ uri: avatarUrl }}
                style={{ width: size, height: size, borderRadius: size / 2 }}
            />
        );
    }

    const safeName = name ?? 'User';
    const initials = safeName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [palette.tertiaryFixed, palette.secondaryContainer, palette.primaryMuted];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
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
