/**
 * AvatarStack — up to 3 stacked avatar circles + "+N" overflow bubble.
 * Used in the Table wishlist to show which members saved a restaurant.
 * Tap-to-expand is deferred to v2; this is informational only.
 */
import React from 'react';
import { View, Text, Image } from 'react-native';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const AVATAR_SIZE = 20;
const OVERLAP = 6;
const MAX_SHOWN = 3;

interface AvatarStackMember {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

interface AvatarStackProps {
    members: AvatarStackMember[];
}

export function AvatarStack({ members }: AvatarStackProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const shown = members.slice(0, MAX_SHOWN);
    const overflow = members.length - shown.length;

    const tints = [palette.tertiaryFixed, palette.secondaryContainer, palette.primaryMuted];

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {shown.map((m, i) => {
                const initials = (m.display_name ?? 'U')
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];
                return (
                    <View
                        key={m.user_id}
                        style={{
                            width: AVATAR_SIZE,
                            height: AVATAR_SIZE,
                            borderRadius: AVATAR_SIZE / 2,
                            backgroundColor: tint,
                            marginLeft: i === 0 ? 0 : -OVERLAP,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 1.5,
                            borderColor: palette.background,
                            overflow: 'hidden',
                        }}
                    >
                        {m.avatar_url ? (
                            <Image
                                source={{ uri: m.avatar_url }}
                                style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                            />
                        ) : (
                            <Text
                                style={{
                                    fontFamily: 'Manrope_600SemiBold',
                                    fontSize: 7,
                                    color: palette.text,
                                }}
                            >
                                {initials}
                            </Text>
                        )}
                    </View>
                );
            })}
            {overflow > 0 && (
                <View
                    style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        borderRadius: AVATAR_SIZE / 2,
                        backgroundColor: palette.surfaceContainerHigh,
                        marginLeft: -OVERLAP,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1.5,
                        borderColor: palette.background,
                    }}
                >
                    <Text
                        style={{
                            ...Type.caption,
                            fontSize: 7,
                            color: palette.textSecondary,
                        }}
                    >
                        +{overflow}
                    </Text>
                </View>
            )}
        </View>
    );
}
