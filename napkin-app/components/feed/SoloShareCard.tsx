/**
 * SoloShareCard — "Solo Share" card matching the wireframe.
 *
 * Layout: two-column asymmetric grid.
 *  Left (~25%): tilted avatar with rounded corners + slight rotation
 *  Right (~75%): card with "{Name} tried {Restaurant}" + rating + quote
 *
 * When entry.photo_url is present, a full-bleed hero image sits at the top
 * of the card (matching TableNightCard's hero pattern) before the text content.
 *
 * Used for solo_share items that HAVE a rating.
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from './Avatar';
import { InteractionPill } from './InteractionPill';

type Palette = typeof Colors.light;

interface SoloShareCardProps {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
}

export function SoloShareCard({ item, palette, tableId }: SoloShareCardProps) {
    const router = useRouter();
    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const hasHero = !!item.photo_url;
    const photoCount = item.photo_count ?? 0;

    const handlePress = () =>
        router.push({ pathname: '/entry-detail', params: { entryId: item.id } });

    const handleAuthorPress = () => {
        if (item.user_id && tableId) {
            router.push({
                pathname: '/member/[userId]',
                params: { userId: item.user_id, tableId },
            });
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => ({
                flexDirection: 'row',
                gap: Spacing.md,
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
            })}
        >
            {/* Left: Tilted avatar — tappable to member profile */}
            <Pressable
                onPress={tableId ? handleAuthorPress : undefined}
                style={({ pressed }) => [
                    styles.avatarFrame,
                    {
                        backgroundColor: palette.secondaryContainer,
                        transform: [{ rotate: '-3deg' }],
                        shadowColor: palette.text,
                        opacity: pressed && tableId ? 0.75 : 1,
                    },
                ]}
            >
                <Avatar
                    name={displayName}
                    url={null}
                    size={56}
                    palette={palette}
                />
            </Pressable>

            {/* Right: Text card */}
            <View
                style={[
                    styles.textCard,
                    {
                        backgroundColor: palette.card,
                        shadowColor: palette.text,
                        borderColor: palette.outlineVariant,
                    },
                ]}
            >
                {/* Hero image (user-uploaded photo, if present) */}
                {hasHero ? (
                    <View style={{ position: 'relative' }}>
                        <Image
                            source={{ uri: item.photo_url! }}
                            style={styles.heroImage}
                            resizeMode="cover"
                        />
                        {photoCount >= 2 && (
                            <View style={[styles.photoCountBadge, { backgroundColor: 'rgba(255,255,255,0.82)' }]}>
                                <Ionicons name="copy-outline" size={10} color="#1c1c19" />
                                <Text style={styles.photoCountText}>{photoCount}</Text>
                            </View>
                        )}
                    </View>
                ) : null}

                {/* Text content — padded separately so hero bleeds to edges */}
                <View style={[styles.cardContent, hasHero && styles.cardContentWithHero]}>
                    {/* Header: "Name tried Restaurant" + rating */}
                    <View style={styles.headerRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={[Type.labelSmall, { color: palette.text }]}>
                                <Text style={{ fontFamily: 'Manrope_600SemiBold' }}>
                                    {displayName}
                                </Text>
                                {' tried '}
                                <Text
                                    style={{
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 15,
                                        color: palette.primary,
                                    }}
                                >
                                    {restaurantName}
                                </Text>
                            </Text>
                        </View>
                        {item.rating != null && (
                            <View style={styles.ratingBadge}>
                                <Text
                                    style={[
                                        styles.ratingText,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    {item.rating.toFixed(1)}
                                </Text>
                                <Text
                                    style={[
                                        styles.starIcon,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    ★
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Dish tag */}
                    {item.dish_description ? (
                        <Text
                            style={[
                                styles.dishTag,
                                {
                                    color: palette.tertiary,
                                    backgroundColor: palette.tertiaryFixed,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {item.dish_description}
                        </Text>
                    ) : null}

                    {/* Quote */}
                    {item.content ? (
                        <Text
                            style={[
                                styles.quoteText,
                                { color: palette.textSecondary },
                            ]}
                            numberOfLines={2}
                        >
                            {'\u201C'}{item.content}{'\u201D'}
                        </Text>
                    ) : null}

                    {/* Interaction pill */}
                    {((item.reaction_count ?? 0) >= 1 || (item.comment_count ?? 0) >= 1) && (
                        <InteractionPill
                            topEmojis={item.top_emojis ?? []}
                            commentCount={item.comment_count ?? 0}
                            reactionCount={item.reaction_count ?? 0}
                            textColor={palette.textMuted}
                        />
                    )}
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    avatarFrame: {
        width: 64,
        height: 64,
        borderRadius: 20,
        padding: 4,
        alignItems: 'center',
        justifyContent: 'center',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04,
        shadowRadius: 12,
        elevation: 2,
    },
    textCard: {
        flex: 1,
        borderRadius: Radius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.03,
        shadowRadius: 30,
        elevation: 1,
        overflow: 'hidden',
    },
    heroImage: {
        width: '100%',
        aspectRatio: 16 / 9,
    },
    photoCountBadge: {
        position: 'absolute',
        bottom: 6,
        right: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 4,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    photoCountText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        color: '#1c1c19',
    },
    cardContent: {
        padding: Spacing.md + 4,
    },
    cardContentWithHero: {
        paddingTop: Spacing.sm,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    ratingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginLeft: Spacing.sm,
    },
    ratingText: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 18,
        lineHeight: 22,
    },
    starIcon: {
        fontSize: 13,
        marginTop: 1,
    },
    dishTag: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        alignSelf: 'flex-start',
        marginTop: Spacing.xs,
        overflow: 'hidden',
    },
    quoteText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 18,
        fontStyle: 'italic',
        marginTop: Spacing.xs + 2,
    },
});
