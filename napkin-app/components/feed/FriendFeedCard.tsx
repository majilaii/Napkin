/**
 * FriendFeedCard — TICKET-103 note-card / ledger-line router for the friends feed.
 *
 * The ONE routing rule (isNoteCard): an entry with prose or photos renders as a
 * white NOTE CARD (34px avatar · one-line byline · upright restaurant with
 * a bare amber rating · italic pull-quote · photos · quiet engagement).
 * A bare rating collapses to a one-line LEDGER ROW (first name · amber numeral
 * · upright restaurant · relative time).
 * No thresholds, no engagement scoring — the author's own effort decides how loud
 * their entry is.
 *
 * Deliberately NO Table grammar (TICKET-093 decision a): a table-shared entry
 * renders as a plain entry. Engagement is the PUBLIC scope only (TICKET-085 scope
 * isolation); taps route to entry-detail?viewAs=public for others' entries, or
 * the plain owner view for own entries.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from './Avatar';
import { isNoteCard } from './feedRouting';
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { useDeleteEntry } from '@/hooks/entries/useDeleteEntry';
import { OwnerActionsSheet } from '@/components/common';

interface Props {
    row: FriendFeedRow;
    /** TICKET-111: own cards long-press → owner sheet (Delete). */
    onLongPress?: () => void;
}

/** Shared tap + reaction wiring for both grammars. */
function useRowNav(row: FriendFeedRow) {
    const router = useRouter();
    const { user } = useAuth();
    const toggleReaction = useToggleReaction();

    const rating = row.rating ?? 0;
    const isOwn = user?.id === row.user_id;

    const onPress = () =>
        router.push({
            pathname: '/entry-detail',
            params: isOwn ? { entryId: row.id } : { entryId: row.id, viewAs: 'public' },
        });

    // Liked = any reaction of mine (legacy emoji rows count and unlike the same way).
    const myReactions = row.my_reactions ?? [];
    const liked = myReactions.length > 0;
    const handleToggleLike = () =>
        toggleReaction.mutate({
            targetType: 'entry',
            targetId: row.id,
            emoji: myReactions[0] ?? '❤️',
            scope: 'public',
        });

    return { rating, onPress, liked, handleToggleLike, isOwn };
}

export function FriendFeedCard({ row }: Props) {
    const { user } = useAuth();
    const isOwn = user?.id === row.user_id;
    const deleteEntry = useDeleteEntry();
    const [sheetVisible, setSheetVisible] = useState(false);

    // Only own cards get the delete affordance. Others' cards → report/block
    // (a separate surface, TICKET-091) — never a delete on content you don't own.
    const onLongPress = isOwn ? () => setSheetVisible(true) : undefined;

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
            {isNoteCard(row) ? (
                <NoteCard row={row} onLongPress={onLongPress} />
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

// ── Note card — prose and/or photos ────────────────────────────────────────────

function NoteCard({ row, onLongPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress, liked, handleToggleLike } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const hasContent = !!row.content && row.content.trim().length > 0;
    const photos = row.photos.slice(0, 3);
    const likeLabel = row.reaction_count > 0
        ? `${row.reaction_count} ${row.reaction_count === 1 ? 'like' : 'likes'}`
        : 'like';
    const replyLabel = row.comment_count > 0
        ? `${row.comment_count} ${row.comment_count === 1 ? 'reply' : 'replies'}`
        : null;

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={({ pressed }) => [
                styles.noteCard,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.9 : 1 },
                Shadow.ambient,
            ]}
        >
            <View style={styles.byline}>
                <Avatar name={row.author.display_name} url={row.author.avatar_url} size={34} palette={palette} />
                <Text numberOfLines={1} style={[styles.bylineText, { color: palette.textMuted }]}>
                    <Text style={[styles.bylineName, { color: palette.text }]}>{row.author.display_name}</Text>
                    {' · noted'}
                </Text>
            </View>

            <View style={styles.noteHead}>
                <Text numberOfLines={1} style={[styles.restaurantName, { color: palette.text }]}>
                    {restaurantName}
                </Text>
                {rating > 0 && (
                    <Text style={[styles.noteRating, { color: palette.star }]}>{rating.toFixed(1)}</Text>
                )}
            </View>

            {hasContent && (
                <Text
                    numberOfLines={4}
                    style={[styles.quote, { color: palette.textSoft }]}
                >
                    {'— '}
                    {row.content}
                </Text>
            )}

            {/* Photos follow */}
            {photos.length > 0 && (
                <View style={[styles.photoBlock, !hasContent && styles.photoBlockWithoutQuote]}>
                    <PhotoGrid photos={photos} total={row.photos.length} />
                </View>
            )}

            <View style={[styles.noteFoot, !photos.length && styles.noteFootWithoutPhotos]}>
                <Pressable
                    onPress={handleToggleLike}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={liked ? 'Unlike' : 'Like'}
                    style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                >
                    <Text style={[styles.footText, { color: palette.textFaint }]}>{likeLabel}</Text>
                </Pressable>
                {replyLabel && (
                    <Text style={[styles.footText, { color: palette.textFaint }]}>{` · ${replyLabel}`}</Text>
                )}
            </View>
        </Pressable>
    );
}

// ── Ledger row — a bare rating, one line, no chrome ─────────────────────────────

function LedgerRow({ row, onLongPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const firstName = row.author.display_name.trim().split(/\s+/)[0] || row.author.display_name;
    const time = relativeFeedTime(row.sort_date);

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={({ pressed }) => [styles.ledgerRow, { opacity: pressed ? 0.7 : 1 }]}
        >
            <Text numberOfLines={1} style={[styles.ledgerWho, { color: palette.text }]}>{firstName}</Text>
            {rating > 0 && (
                <Text style={[styles.ledgerRating, { color: palette.star }]}>{rating.toFixed(1)}</Text>
            )}
            <Text numberOfLines={1} style={[styles.ledgerRestaurant, { color: palette.text }]}>{restaurantName}</Text>
            <Text style={[styles.ledgerTime, { color: palette.textFaint }]}>{time}</Text>
        </Pressable>
    );
}

// ── Relative ledger stamp ───────────────────────────────────────────────────────────────

function relativeFeedTime(iso: string, now: Date = new Date()): string {
    const then = new Date(iso);
    const elapsedMs = Math.max(0, now.getTime() - then.getTime());
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);

    if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)}m`;
    if (elapsedMinutes < 1_440) return `${Math.floor(elapsedMinutes / 60)}h`;
    return then.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
}

// ── Photo grid — restyled to Radius.md corners, sits after the quote block ──────

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
                    borderRadius: Radius.md,
                    backgroundColor: palette.surfaceContainerLow,
                }}
                contentFit="cover"
                transition={200}
            />
        );
    }

    if (photos.length === 2) {
        return (
            <View style={{ flexDirection: 'row', gap: 8 }}>
                {photos.map((p, i) => (
                    <Image
                        key={i}
                        source={{ uri: p }}
                        style={{ flex: 1, height: 110, borderRadius: Radius.md }}
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
                style={{ flex: 2, aspectRatio: 1, borderRadius: Radius.md }}
                contentFit="cover"
                transition={200}
            />
            <View style={{ flex: 1, gap: 6 }}>
                <Image
                    source={{ uri: photos[1] }}
                    style={{ flex: 1, borderRadius: Radius.md }}
                    contentFit="cover"
                    transition={200}
                />
                <View style={{ flex: 1, position: 'relative' }}>
                    <Image
                        source={{ uri: photos[2] }}
                        style={{ flex: 1, borderRadius: Radius.md }}
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
                                borderRadius: Radius.md,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text
                                style={{
                                    fontFamily: 'Manrope_600SemiBold',
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

const styles = StyleSheet.create({
    noteCard: {
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 13,
    },
    byline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
    },
    bylineText: {
        flex: 1,
        minWidth: 0,
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
    bylineName: {
        fontFamily: 'Manrope_700Bold',
    },
    noteHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 6,
    },
    restaurantName: {
        flex: 1,
        minWidth: 0,
        fontFamily: 'Newsreader_500Medium',
        fontSize: 19,
        lineHeight: 23,
    },
    noteRating: {
        flexShrink: 0,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 19,
        lineHeight: 23,
        fontVariant: ['tabular-nums'],
    },
    quote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 23,
        marginTop: 2,
    },
    photoBlock: {
        marginTop: 12,
        marginBottom: 11,
    },
    photoBlockWithoutQuote: {
        marginTop: 2,
    },
    noteFoot: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    noteFootWithoutPhotos: {
        marginTop: 10,
    },
    footText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
    ledgerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        paddingHorizontal: 2,
        paddingVertical: 4,
    },
    ledgerWho: {
        flexShrink: 0,
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        lineHeight: 19,
    },
    ledgerRating: {
        flexShrink: 0,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 19,
        fontVariant: ['tabular-nums'],
    },
    ledgerRestaurant: {
        flex: 1,
        minWidth: 0,
        fontFamily: 'Newsreader_400Regular',
        fontSize: 15,
        lineHeight: 19,
    },
    ledgerTime: {
        flexShrink: 0,
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
});
