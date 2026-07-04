/**
 * FriendFeedCard — TICKET-098 plain-entry card for the friends feed.
 *
 * Byline: avatar + "{name} tried {restaurant}" ("noted" when unrated),
 * restaurant in Newsreader italic (brand voice). Rating stars, optional prose,
 * optional photo grid, footer with PUBLIC-scope reactions + reply count.
 *
 * Deliberately NO Table grammar: no Table name, no Round context, no thread,
 * no "shared to" chrome — a table-shared entry renders as a plain entry
 * (TICKET-093 decision a). Engagement is the PUBLIC scope only (TICKET-085
 * scope isolation); taps route to entry-detail?viewAs=public (the restaurant-
 * page public-review precedent), or the plain owner view for own entries.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from './Avatar';
import { InlineStars } from './InlineStars';
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';

interface Props {
    row: FriendFeedRow;
}

export function FriendFeedCard({ row }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const toggleReaction = useToggleReaction();

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const rating = row.rating ?? 0;
    const hasContent = !!row.content && row.content.trim().length > 0;
    const photos = row.photos.slice(0, 3);
    const time = formatRelative(row.sort_date);

    const myReactions = row.my_reactions ?? [];
    const likedEmoji = myReactions.includes('❤️') ? '❤️' : myReactions[0] ?? null;
    const liked = !!likedEmoji;

    const isOwn = user?.id === row.user_id;
    const onPress = () =>
        router.push({
            pathname: '/entry-detail',
            params: isOwn
                ? { entryId: row.id }
                : { entryId: row.id, viewAs: 'public' },
        });

    const handleToggleLike = () => {
        toggleReaction.mutate({
            targetType: 'entry',
            targetId: row.id,
            emoji: liked ? likedEmoji! : '❤️',
            scope: 'public',
        });
    };

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
                <Avatar
                    name={row.author.display_name}
                    url={row.author.avatar_url}
                    size={28}
                    palette={palette}
                />

                <Text style={{ flex: 1, fontSize: 13, color: palette.textSecondary, fontFamily: 'Manrope_400Regular' }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', color: palette.text }}>
                        {row.author.display_name}
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

            {/* Rating row */}
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
                    {row.content}
                </Text>
            )}

            {/* Photos */}
            {photos.length > 0 && <PhotoGrid photos={photos} total={row.photos.length} />}

            {/* Footer — public-scope engagement */}
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
                <Pressable
                    onPress={handleToggleLike}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={liked ? 'Unlike' : 'React'}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        opacity: pressed ? 0.55 : 1,
                    })}
                >
                    {liked ? (
                        <Text style={{ fontSize: 13, lineHeight: 15 }} allowFontScaling={false}>
                            {likedEmoji}
                        </Text>
                    ) : (
                        <Ionicons name="heart-outline" size={13} color={palette.textMuted} />
                    )}
                    <Text style={{ fontSize: 11, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                        {row.reaction_count || 'React'}
                    </Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="chatbubble-outline" size={12} color={palette.textMuted} />
                    <Text style={{ fontSize: 11, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                        {row.comment_count || 'Reply'}
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
                                backgroundColor: palette.scrimDark,
                                borderRadius: Radius.sm + 2,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text
                                style={{
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 16,
                                    color: palette.textOnImage,
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

function formatRelative(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / (60 * 60 * 1000));
    if (h < 1) return 'now';
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
