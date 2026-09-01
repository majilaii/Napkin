/**
 * FriendFeedCard — TICKET-226 three-weight router for the Friends feed.
 *
 * Bare ratings stay ledger rows. Prose and single-photo entries sit directly on
 * the paper as compact note rows. Two or more photos earn a compressed note
 * card. Every weight keeps the same entry-detail tap and owner long-press paths.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from './Avatar';
import { feedWeight } from './feedRouting';
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import { useDeleteEntry } from '@/hooks/entries/useDeleteEntry';
import { OwnerActionsSheet } from '@/components/common';
import { tintFor } from '@/lib/engraving';

interface Props {
    row: FriendFeedRow;
    /** TICKET-111: own cards long-press → owner sheet (Delete). */
    onLongPress?: () => void;
}

/** Shared entry-detail navigation for all three weights. */
function useRowNav(row: FriendFeedRow) {
    const router = useRouter();
    const { user } = useAuth();

    const rating = row.rating ?? 0;
    const isOwn = user?.id === row.user_id;
    const onPress = () =>
        router.push({
            pathname: '/entry-detail',
            params: isOwn ? { entryId: row.id } : { entryId: row.id, viewAs: 'public' },
        });

    return { rating, onPress };
}

export function FriendFeedCard({ row }: Props) {
    const { user } = useAuth();
    const isOwn = user?.id === row.user_id;
    const deleteEntry = useDeleteEntry();
    const [sheetVisible, setSheetVisible] = useState(false);

    // Only own rows get the delete affordance. Others' rows → report/block
    // (a separate surface, TICKET-091) — never delete content you do not own.
    const onLongPress = isOwn ? () => setSheetVisible(true) : undefined;
    const weight = feedWeight(row);

    const handleDelete = () => {
        setSheetVisible(false);
        if (!user?.id) return;
        deleteEntry.mutate({
            entryId: row.id,
            userId: user.id,
            restaurantId: row.restaurant?.id ?? null,
        });
    };

    return (
        <>
            {weight === 'card' ? (
                <CompressedCard row={row} onLongPress={onLongPress} />
            ) : weight === 'note' ? (
                <FeedNoteRow row={row} onLongPress={onLongPress} />
            ) : (
                <LedgerRow row={row} onLongPress={onLongPress} />
            )}
            <OwnerActionsSheet
                visible={sheetVisible}
                title={row.restaurant?.name ?? 'this entry'}
                subtitle="Delete this from your journal?"
                actions={[{ label: 'Delete entry', kind: 'destructive', onPress: handleDelete }]}
                onCancel={() => setSheetVisible(false)}
            />
        </>
    );
}

// ── Note row — prose or one photo, directly on the feed paper ───────────────

function FeedNoteRow({ row, onLongPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const content = row.content?.trim();
    const photo = row.photos[0];
    const time = relativeFeedTime(row.sort_date);
    const tintSeed = row.restaurant?.id ?? row.restaurant_id ?? row.id;

    return (
        <>
            <Pressable
                testID="feed-note-row"
                accessibilityRole="button"
                accessibilityLabel={`Open ${restaurantName}`}
                onPress={onPress}
                onLongPress={onLongPress}
                delayLongPress={350}
                style={({ pressed }) => [styles.noteRow, { opacity: pressed ? 0.7 : 1 }]}
            >
                <View style={styles.noteAvatar}>
                    <Avatar
                        name={row.author.display_name}
                        url={row.author.avatar_url}
                        size={28}
                        palette={palette}
                    />
                </View>
                <View style={styles.noteBody}>
                    <View style={styles.noteMetaLine}>
                        <Text
                            numberOfLines={1}
                            style={[Type.feedMetaStrong, styles.noteAuthor, { color: palette.text }]}
                        >
                            {row.author.display_name}
                        </Text>
                        <Text style={[Type.feedMeta, { color: palette.textMuted }]}>· noted</Text>
                        <View style={styles.metaSpacer} />
                        <Text style={[Type.feedMeta, { color: palette.textFaint }]}>{time}</Text>
                    </View>
                    <View style={styles.noteRestaurantLine}>
                        <Text
                            numberOfLines={1}
                            style={[Type.feedNoteRestaurant, styles.restaurantFlex, { color: palette.text }]}
                        >
                            {restaurantName}
                        </Text>
                        {rating > 0 && (
                            <Text style={[Type.feedNoteRating, { color: palette.amberBright }]}>
                                {rating.toFixed(1)}
                            </Text>
                        )}
                    </View>
                    {(content || photo) && (
                        <View style={styles.noteContentLine}>
                            {content ? (
                                <Text
                                    numberOfLines={photo ? 2 : 1}
                                    ellipsizeMode="tail"
                                    style={[Type.feedQuote, styles.noteQuote, { color: palette.textSoft }]}
                                >
                                    {'— '}
                                    {content}
                                </Text>
                            ) : (
                                <View style={styles.metaSpacer} />
                            )}
                            {photo && (
                                <Image
                                    testID="feed-note-thumbnail"
                                    source={{ uri: photo }}
                                    style={[
                                        styles.noteThumb,
                                        {
                                            backgroundColor: tintFor(tintSeed, palette),
                                            borderColor: palette.imageOutline,
                                        },
                                    ]}
                                    contentFit="cover"
                                    transition={200}
                                />
                            )}
                        </View>
                    )}
                </View>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
        </>
    );
}

// ── Card — two or more photos, compressed to the approved strip anatomy ─────

function CompressedCard({ row, onLongPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const content = row.content?.trim();
    const photos = row.photos.slice(0, 3);
    const time = relativeFeedTime(row.sort_date);
    const likeLabel = row.reaction_count > 0
        ? `${row.reaction_count} ${row.reaction_count === 1 ? 'like' : 'likes'}`
        : null;
    const replyLabel = row.comment_count > 0
        ? `${row.comment_count} ${row.comment_count === 1 ? 'reply' : 'replies'}`
        : null;
    const engagementLabel = [likeLabel, replyLabel].filter(Boolean).join(' · ');

    return (
        <Pressable
            testID="feed-photo-card"
            accessibilityRole="button"
            accessibilityLabel={`Open ${restaurantName}`}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.9 : 1 },
                Shadow.ambient,
            ]}
        >
            <View style={styles.cardByline}>
                <Avatar
                    name={row.author.display_name}
                    url={row.author.avatar_url}
                    size={28}
                    palette={palette}
                />
                <Text
                    numberOfLines={1}
                    style={[Type.feedMeta, styles.cardBylineText, { color: palette.textMuted }]}
                >
                    <Text style={[Type.feedMetaStrong, { color: palette.text }]}>
                        {row.author.display_name}
                    </Text>
                    {' · noted'}
                </Text>
                <Text style={[Type.feedMeta, { color: palette.textFaint }]}>{time}</Text>
            </View>

            <View style={styles.cardRestaurantLine}>
                <Text
                    numberOfLines={1}
                    style={[Type.feedCardRestaurant, styles.restaurantFlex, { color: palette.text }]}
                >
                    {restaurantName}
                </Text>
                {rating > 0 && (
                    <Text style={[Type.feedCardRating, { color: palette.amberBright }]}>
                        {rating.toFixed(1)}
                    </Text>
                )}
            </View>

            {content && (
                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[Type.feedQuote, styles.cardQuote, { color: palette.textSoft }]}
                >
                    {'— '}
                    {content}
                </Text>
            )}

            <PhotoStrip photos={photos} total={row.photos.length} palette={palette} />

            {engagementLabel && (
                <View style={styles.cardFoot}>
                    {likeLabel && (
                        <Ionicons name="heart-outline" size={15} color={palette.textMuted} />
                    )}
                    <Text style={[Type.feedMeta, { color: palette.textMuted }]}>
                        {engagementLabel}
                    </Text>
                </View>
            )}
        </Pressable>
    );
}

// ── Ledger row — bare rating, unchanged one-line grammar ────────────────────

function LedgerRow({ row, onLongPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const firstName = row.author.display_name.trim().split(/\s+/)[0] || row.author.display_name;
    const time = relativeFeedTime(row.sort_date);

    return (
        <>
            <Pressable
                testID="feed-ledger-row"
                accessibilityRole="button"
                accessibilityLabel={`Open ${restaurantName}`}
                onPress={onPress}
                onLongPress={onLongPress}
                delayLongPress={350}
                style={({ pressed }) => [styles.ledgerRow, { opacity: pressed ? 0.7 : 1 }]}
            >
                <Text numberOfLines={1} style={[Type.feedMetaStrong, { color: palette.text }]}>
                    {firstName}
                </Text>
                {rating > 0 && (
                    <Text style={[Type.feedLedgerRating, { color: palette.star }]}>
                        {rating.toFixed(1)}
                    </Text>
                )}
                <Text
                    numberOfLines={1}
                    style={[Type.feedLedger, styles.restaurantFlex, { color: palette.text }]}
                >
                    {restaurantName}
                </Text>
                <Text style={[Type.feedMeta, { color: palette.textFaint }]}>{time}</Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
        </>
    );
}

// ── Relative feed stamp ─────────────────────────────────────────────────────

function relativeFeedTime(iso: string, now: Date = new Date()): string {
    const then = new Date(iso);
    const elapsedMs = Math.max(0, now.getTime() - then.getTime());
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);

    if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)}m`;
    if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)}h`;

    const elapsedDays = Math.floor(elapsedMinutes / 1_440);
    if (elapsedDays < 7) return `${elapsedDays}d`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

// ── Compressed three-up photo strip ─────────────────────────────────────────

type Palette = typeof Colors.light;

function PhotoStrip({ photos, total, palette }: { photos: string[]; total: number; palette: Palette }) {
    const placeholderTints = [palette.plateAmber, palette.plateOlive, palette.plateGrey];

    return (
        <View style={styles.photoStrip}>
            {photos.map((photo, index) => (
                <View
                    key={`${photo}-${index}`}
                    testID="feed-card-photo-tile"
                    style={[
                        styles.photoTile,
                        {
                            backgroundColor: placeholderTints[index],
                            borderColor: palette.imageOutline,
                        },
                    ]}
                >
                    <Image
                        testID={`feed-card-photo-${index}`}
                        source={{ uri: photo }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={200}
                    />
                    {index === 2 && total > 3 && (
                        <View
                            style={[
                                StyleSheet.absoluteFillObject,
                                styles.photoScrim,
                                { backgroundColor: palette.scrimDark },
                            ]}
                        >
                            <Text style={[Type.feedPhotoCount, { color: palette.textOnImage }]}>
                                {`+${total - 3}`}
                            </Text>
                        </View>
                    )}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    noteRow: {
        flexDirection: 'row',
        gap: Spacing.feed.contentGap,
        paddingTop: Spacing.feed.rowTop,
        paddingBottom: Spacing.feed.rowBottom,
    },
    noteAvatar: {
        flexShrink: 0,
        marginTop: Spacing.feed.avatarOffset,
    },
    noteBody: {
        flex: 1,
        minWidth: 0,
        gap: Spacing.feed.stackGap,
    },
    noteMetaLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.feed.metaGap,
    },
    noteAuthor: {
        flexShrink: 1,
    },
    metaSpacer: {
        flex: 1,
    },
    noteRestaurantLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.feed.contentGap,
    },
    restaurantFlex: {
        flex: 1,
        minWidth: 0,
    },
    noteContentLine: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.feed.contentGap,
    },
    noteQuote: {
        flex: 1,
        minWidth: 0,
    },
    noteThumb: {
        width: 42,
        height: 42,
        flexShrink: 0,
        borderRadius: Radius.compact,
        borderWidth: StyleSheet.hairlineWidth,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
    },
    card: {
        marginVertical: Spacing.feed.cardMargin,
        borderRadius: Radius.lg,
        paddingTop: Spacing.feed.cardTop,
        paddingHorizontal: Spacing.feed.cardHorizontal,
        paddingBottom: Spacing.feed.rowBottom,
    },
    cardByline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.feed.cardHeaderGap,
    },
    cardBylineText: {
        flex: 1,
        minWidth: 0,
    },
    cardRestaurantLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.feed.contentGap,
        marginTop: Spacing.feed.metaGap,
    },
    cardQuote: {
        marginTop: Spacing.feed.avatarOffset,
    },
    photoStrip: {
        flexDirection: 'row',
        gap: Spacing.feed.metaGap,
        marginTop: Spacing.feed.mediaTop,
    },
    photoTile: {
        flex: 1,
        height: 68,
        borderRadius: Radius.compact,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    photoScrim: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardFoot: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.feed.footerIconGap,
        marginTop: Spacing.feed.mediaTop,
    },
    ledgerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.sm,
        paddingVertical: Spacing.feed.mediaTop,
    },
});
