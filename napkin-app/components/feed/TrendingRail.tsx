import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { TrendingPoster } from '@/hooks/feed';

interface Props {
    kicker: string;
    title: string;
    scope?: string;
    posters: TrendingPoster[];
}

export function TrendingRail({ kicker, title, scope, posters }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (posters.length === 0) return null;

    return (
        <View style={{ marginBottom: 24 }}>
            {/* Header */}
            <View style={{ paddingHorizontal: Spacing.lg - 2, paddingBottom: 10 }}>
                <Text
                    style={{
                        fontFamily: 'Manrope_600SemiBold',
                        fontSize: 10,
                        letterSpacing: 0.8,
                        color: palette.textMuted,
                        marginBottom: 4,
                        textTransform: 'uppercase',
                    }}
                >
                    {kicker}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 20,
                            color: palette.text,
                            lineHeight: 22,
                            flex: 1,
                        }}
                    >
                        {title}
                    </Text>
                    {scope && (
                        <Text
                            style={{
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 10,
                                color: palette.textMuted,
                                marginLeft: 8,
                            }}
                        >
                            {scope}
                        </Text>
                    )}
                </View>
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                    paddingHorizontal: Spacing.lg - 2,
                    gap: 14,
                    paddingBottom: 8,
                }}
            >
                {posters.map((p) => (
                    <Poster key={p.restaurant.id} poster={p} />
                ))}
            </ScrollView>
        </View>
    );
}

function Poster({ poster }: { poster: TrendingPoster }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const subtitle = poster.logger_count === 1
        ? '1 logged'
        : `${poster.logger_count} logged`;

    return (
        <Pressable
            onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: poster.restaurant.id } })}
            style={({ pressed }) => ({ width: 124, opacity: pressed ? 0.85 : 1 })}
        >
            <View
                style={{
                    aspectRatio: 3 / 4,
                    borderRadius: 6,
                    backgroundColor: palette.surfaceContainerLow,
                    overflow: 'hidden',
                    ...Shadow.subtle,
                }}
            >
                {poster.restaurant.photo_url && (
                    <Image
                        source={{ uri: poster.restaurant.photo_url }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        transition={200}
                    />
                )}
                {/* Rank badge */}
                <View
                    style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        width: 20,
                        height: 20,
                        borderRadius: 3,
                        backgroundColor: 'rgba(28,28,25,0.82)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 12,
                            color: palette.cream,
                            lineHeight: 14,
                        }}
                    >
                        {poster.rank}
                    </Text>
                </View>
                {/* Score badge */}
                {poster.average_rating != null && (
                    <View
                        style={{
                            position: 'absolute',
                            bottom: 5,
                            right: 5,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 3,
                            backgroundColor: 'rgba(28,28,25,0.82)',
                        }}
                    >
                        <Text
                            style={{
                                fontFamily: 'Manrope_600SemiBold',
                                fontSize: 10,
                                color: palette.cream,
                                letterSpacing: 0.3,
                            }}
                        >
                            {poster.average_rating.toFixed(1)}
                        </Text>
                    </View>
                )}
            </View>

            <Text
                numberOfLines={1}
                style={{
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 13,
                    color: palette.text,
                    marginTop: 6,
                    lineHeight: 16,
                }}
            >
                {poster.restaurant.name}
            </Text>
            <Text
                style={{
                    fontFamily: 'Manrope_400Regular',
                    fontSize: 10,
                    color: palette.textMuted,
                    marginTop: 1,
                    letterSpacing: 0.2,
                }}
            >
                {subtitle}
            </Text>
        </Pressable>
    );
}
