import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InlineStars } from './InlineStars';
import type { FeedEntry } from '@/hooks/feed';

interface Props {
    entry: FeedEntry;
    sub?: string;
}

/** One-liner row for rating-only / note-less logs. */
export function FastLogRow({ entry, sub }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const rating = entry.rating ?? 0;

    return (
        <Pressable
            onPress={() => router.push({ pathname: '/entry-detail', params: { entryId: entry.id } })}
            style={({ pressed }) => ({
                paddingHorizontal: Spacing.lg - 2,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: palette.dividerSoft,
                opacity: pressed ? 0.8 : 1,
            })}
        >
            <View
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: palette.secondaryContainer,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                }}
            >
                {entry.author.avatar_url ? (
                    <Image
                        source={{ uri: entry.author.avatar_url }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                    />
                ) : (
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 10,
                            color: palette.secondary,
                        }}
                    >
                        {entry.author.display_name.slice(0, 1)}
                    </Text>
                )}
            </View>

            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: palette.textSecondary, fontFamily: 'Manrope_400Regular' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: palette.text }}>
                    {entry.author.display_name}
                </Text>
                <Text> · </Text>
                <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', color: palette.text }}>
                    {entry.restaurant?.name ?? 'somewhere'}
                </Text>
                {sub && <Text style={{ color: palette.textMuted }}> · {sub}</Text>}
            </Text>

            {rating > 0 && (
                <>
                    <InlineStars value={rating} size={11} color={palette.star} />
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 12,
                            color: palette.textSecondary,
                            marginLeft: 4,
                        }}
                    >
                        {rating.toFixed(1)}
                    </Text>
                </>
            )}
        </Pressable>
    );
}
