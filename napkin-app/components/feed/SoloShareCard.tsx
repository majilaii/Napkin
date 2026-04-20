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
 *
 * TICKET-010 additions:
 *  - Card-level long-press (500ms) → ReactionPicker anchored top-right
 *  - Quote blurb: extracted highlight from item.content (em-dash prefix)
 *  - Relative time label in header row
 *  - Unseen dot (top-right of card) when item.sort_date > lastSeenAt
 */

import React, { useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
    findNodeHandle,
    UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { extractHighlight, formatRelativeTime } from '@/lib/textHighlight';
import { Avatar } from './Avatar';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface SoloShareCardProps {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

export function SoloShareCard({ item, palette, tableId, lastSeenAt }: SoloShareCardProps) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const hasHero = !!item.photo_url;
    const photoCount = item.photo_count ?? 0;

    // Unseen dot: render when lastSeenAt is null (never seen) or item is newer
    const isUnseen =
        !lastSeenAt ||
        (!!item.sort_date && item.sort_date > lastSeenAt);

    // Relative time (< 24h only; null means the DateSectionHeader labels it)
    const relativeTime = item.sort_date ? formatRelativeTime(item.sort_date) : null;

    // Quote blurb — extracted highlight from content
    const highlight = extractHighlight(item.content);

    // Card-level long-press picker anchor
    const cardRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

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

    const handleLongPress = () => {
        const handle = findNodeHandle(cardRef.current);
        if (handle == null) return;
        Haptics.selectionAsync().catch(() => undefined);
        UIManager.measureInWindow(handle, (x, y, width) => {
            // Anchor near the top-right corner of the card
            setPickerAnchor({ x: x + width - 40, y: y + 12 });
        });
    };

    const handlePickEmoji = (emoji: string) => {
        setPickerAnchor(null);
        toggleReaction.mutate(
            { targetType: 'entry', targetId: item.id, emoji },
            {
                onSuccess: () => {
                    if (tableId) {
                        queryClient.invalidateQueries({
                            queryKey: ['tableActivity', tableId],
                            exact: false,
                        });
                    }
                },
            },
        );
    };

    return (
        <Pressable
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={500}
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
                ref={cardRef}
                style={[
                    styles.textCard,
                    {
                        backgroundColor: palette.card,
                        shadowColor: palette.text,
                        borderColor: palette.outlineVariant,
                    },
                ]}
            >
                {/* Unseen dot — top-right of card, absolute */}
                {isUnseen && (
                    <View
                        style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                )}

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
                    {/* Header: "Name tried Restaurant" + rating + relative time */}
                    <View style={styles.headerRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={[Type.labelSmall, { color: palette.text }]}>
                                <Text style={{ fontFamily: 'Manrope_600SemiBold' }}>
                                    {displayName}
                                </Text>
                                {' went solo to '}
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

                        <View style={styles.headerRight}>
                            {relativeTime ? (
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    {relativeTime}
                                </Text>
                            ) : null}
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

                    {/* Quote blurb — extracted highlight with em-dash prefix */}
                    {highlight ? (
                        <Text
                            style={[styles.quoteBlurb, { color: palette.textSecondary }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                        >
                            <Text style={{ color: palette.primary }}>{'— '}</Text>
                            {highlight}
                        </Text>
                    ) : null}

                    {/* Action row — like / reply / summary */}
                    <FeedActionRow
                        targetType="entry"
                        targetId={item.id}
                        topEmojis={item.top_emojis ?? []}
                        reactionCount={item.reaction_count ?? 0}
                        commentCount={item.comment_count ?? 0}
                        myReactions={item.my_reactions ?? []}
                        palette={palette}
                        detailPathname="/entry-detail"
                        detailParams={{ entryId: item.id }}
                        tableId={tableId}
                    />
                </View>
            </View>

            {/* Card-level ReactionPicker (fires from card long-press) */}
            <ReactionPicker
                visible={!!pickerAnchor}
                anchor={pickerAnchor}
                onPick={handlePickEmoji}
                onClose={() => setPickerAnchor(null)}
            />
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
    unseenDot: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 6,
        height: 6,
        borderRadius: 3,
        zIndex: 10,
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
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        marginLeft: Spacing.sm,
        flexShrink: 0,
    },
    ratingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
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
    quoteBlurb: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
        marginTop: Spacing.xs + 2,
    },
});
