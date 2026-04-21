import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InlineStars } from './InlineStars';
import type { FeedEntry } from '@/hooks/feed';

interface Props {
    entry: FeedEntry;
    time: string;
    sub?: string;
}

/**
 * Prose-rich chronological feed card.
 * Byline: "{name} tried {restaurant}" (or "noted" when unrated) with the restaurant in serif italic.
 * Rating + optional liked heart, right-aligned relative time.
 * Optional prose, optional photo grid (1/2/3+), reaction + reply footer.
 */
export function FriendLogCard({ entry, time, sub }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const restaurantName = entry.restaurant?.name ?? 'somewhere';
    const rating = entry.rating ?? 0;
    const hasContent = !!entry.content && entry.content.trim().length > 0;
    const photos = entry.photos.slice(0, 3);

    const onPress = () => router.push({ pathname: '/entry-detail', params: { entryId: entry.id } });

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
                paddingHorizontal: Spacing.lg - 2,
                paddingTop: 16,
                paddingBottom: 18,
                borderBottomWidth: 1,
                borderBottomColor: palette.dividerSoft,
                opacity: pressed ? 0.8 : 1,
            })}
        >
            {/* Byline */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <View
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
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
                                fontSize: 13,
                                color: palette.secondary,
                            }}
                        >
                            {entry.author.display_name.slice(0, 1)}
                        </Text>
                    )}
                </View>

                <Text style={{ flex: 1, fontSize: 13, color: palette.textSecondary, fontFamily: 'Manrope_400Regular' }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: palette.text }}>
                        {entry.author.display_name}
                    </Text>
                    <Text>{rating > 0 ? ' tried ' : ' noted '}</Text>
                    <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14, color: palette.text }}>
                        {restaurantName}
                    </Text>
                </Text>

                <Text style={{ fontSize: 11, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                    {time}
                </Text>
            </View>

            {/* Rating + sub row */}
            {rating > 0 && (
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: hasContent || photos.length > 0 ? 10 : 0,
                    }}
                >
                    <InlineStars value={rating} size={14} color={palette.star} />
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 13,
                            color: palette.textSecondary,
                        }}
                    >
                        {rating.toFixed(1)}
                    </Text>
                    <View style={{ flex: 1 }} />
                    {sub && (
                        <Text
                            style={{
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 11,
                                color: palette.textMuted,
                            }}
                        >
                            {sub}
                        </Text>
                    )}
                </View>
            )}

            {/* Prose */}
            {hasContent && (
                <Text
                    numberOfLines={4}
                    style={{
                        fontFamily: 'Newsreader_400Regular',
                        fontSize: 15,
                        lineHeight: 22,
                        color: palette.text,
                        marginBottom: photos.length > 0 ? 12 : 0,
                    }}
                >
                    {entry.content}
                </Text>
            )}

            {/* Photos */}
            {photos.length > 0 && <PhotoGrid photos={photos} total={entry.photos.length} />}

            {/* Footer */}
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="heart-outline" size={13} color={palette.textMuted} />
                    <Text style={{ fontSize: 11, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                        {entry.reaction_count || 'React'}
                    </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="chatbubble-outline" size={12} color={palette.textMuted} />
                    <Text style={{ fontSize: 11, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                        {entry.comment_count || 'Reply'}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

function PhotoGrid({ photos, total }: { photos: string[]; total: number }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (photos.length === 1) {
        return (
            <Image
                source={{ uri: photos[0] }}
                style={{
                    width: '100%',
                    aspectRatio: 3 / 2,
                    borderRadius: Radius.sm + 2,
                    backgroundColor: palette.surfaceContainerLow,
                }}
                contentFit="cover"
                transition={200}
            />
        );
    }

    if (photos.length === 2) {
        return (
            <View style={{ flexDirection: 'row', gap: 6 }}>
                {photos.map((p, i) => (
                    <Image
                        key={i}
                        source={{ uri: p }}
                        style={{ flex: 1, aspectRatio: 1, borderRadius: Radius.sm + 2 }}
                        contentFit="cover"
                        transition={200}
                    />
                ))}
            </View>
        );
    }

    // 3+ photos — 2fr | 1fr (stacked right)
    return (
        <View style={{ flexDirection: 'row', gap: 6 }}>
            <Image
                source={{ uri: photos[0] }}
                style={{ flex: 2, aspectRatio: 1, borderRadius: Radius.sm + 2 }}
                contentFit="cover"
                transition={200}
            />
            <View style={{ flex: 1, gap: 6 }}>
                <Image
                    source={{ uri: photos[1] }}
                    style={{ flex: 1, borderRadius: Radius.sm + 2 }}
                    contentFit="cover"
                    transition={200}
                />
                <View style={{ flex: 1, position: 'relative' }}>
                    <Image
                        source={{ uri: photos[2] }}
                        style={{ flex: 1, borderRadius: Radius.sm + 2 }}
                        contentFit="cover"
                        transition={200}
                    />
                    {total > 3 && (
                        <View
                            style={{
                                position: 'absolute',
                                top: 0,
                                right: 0,
                                bottom: 0,
                                left: 0,
                                backgroundColor: 'rgba(28,28,25,0.45)',
                                borderRadius: Radius.sm + 2,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text
                                style={{
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 16,
                                    color: palette.textInverse,
                                    fontWeight: '600',
                                }}
                            >
                                +{total - 3}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
}
