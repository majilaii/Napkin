/**
 * FriendFeedCard — TICKET-103 note-card / ledger-line router for the friends feed.
 *
 * The ONE routing rule (isNoteCard): an entry with prose or photos renders as a
 * white NOTE CARD (byline whispers · amber-cream rating chip · 21px italic
 * restaurant display line · em-dash pull-quote leads · photos below · engagement
 * as muted metadata). A bare rating collapses to a one-line LEDGER ROW (22px
 * avatar · name + lowercase verb + italic restaurant · amber numeral + ★ right).
 * No thresholds, no engagement scoring — the author's own effort decides how loud
 * their entry is.
 *
 * Deliberately NO Table grammar (TICKET-093 decision a): a table-shared entry
 * renders as a plain entry. Engagement is the PUBLIC scope only (TICKET-085 scope
 * isolation); taps route to entry-detail?viewAs=public for others' entries, or
 * the plain owner view for own entries.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from './Avatar';
import { isNoteCard } from './feedRouting';
import { feedByline } from './feedDates';
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';

interface Props {
    row: FriendFeedRow;
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

    const myReactions = row.my_reactions ?? [];
    const likedEmoji = myReactions.includes('❤️') ? '❤️' : myReactions[0] ?? null;
    const liked = !!likedEmoji;
    const handleToggleLike = () =>
        toggleReaction.mutate({
            targetType: 'entry',
            targetId: row.id,
            emoji: liked ? likedEmoji! : '❤️',
            scope: 'public',
        });

    return { rating, onPress, liked, likedEmoji, handleToggleLike };
}

export function FriendFeedCard({ row }: Props) {
    return isNoteCard(row) ? <NoteCard row={row} /> : <LedgerRow row={row} />;
}

// ── Note card — prose and/or photos ────────────────────────────────────────────

function NoteCard({ row }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress, liked, likedEmoji, handleToggleLike } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';
    const hasContent = !!row.content && row.content.trim().length > 0;
    const photos = row.photos.slice(0, 3);
    const time = feedByline(row.sort_date);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                {
                    backgroundColor: palette.surfaceNote,
                    borderRadius: Radius.xl,
                    borderWidth: 1,
                    borderColor: palette.dividerSoft,
                    paddingHorizontal: 18,
                    paddingTop: 18,
                    paddingBottom: 16,
                    opacity: pressed ? 0.9 : 1,
                },
                Shadow.note,
            ]}
        >
            {/* Byline: avatar · name + verb·time · rating chip */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar name={row.author.display_name} url={row.author.avatar_url} size={32} palette={palette} />
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13.5, color: palette.text }}>
                        {row.author.display_name}
                    </Text>
                    <Text style={{ fontFamily: 'Manrope_400Regular', fontSize: 10.5, color: palette.textMuted, marginTop: 1 }}>
                        {rating > 0 ? 'tried' : 'noted'} · {time}
                    </Text>
                </View>
                {rating > 0 && <RatingChip rating={rating} palette={palette} />}
            </View>

            {/* Restaurant display line — the star of the card finally gets billing */}
            <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 21, lineHeight: 24, color: palette.text, marginTop: 12 }}>
                {restaurantName}
                {/* neighborhood trails when a value exists — none in the feed payload today */}
            </Text>

            {/* Words lead — em-dash pull-quote above the photos (Poster doctrine) */}
            {hasContent && (
                <Text
                    numberOfLines={4}
                    style={{ fontFamily: 'Newsreader_400Regular', fontSize: 15.5, lineHeight: 23, color: palette.text, marginTop: 8 }}
                >
                    {'— '}
                    {row.content}
                </Text>
            )}

            {/* Photos follow */}
            {photos.length > 0 && (
                <View style={{ marginTop: 12 }}>
                    <PhotoGrid photos={photos} total={row.photos.length} />
                </View>
            )}

            {/* Engagement is metadata, not buttons — the whole card is the tap target */}
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 13, alignItems: 'center' }}>
                <Pressable
                    onPress={handleToggleLike}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={liked ? 'Unlike' : 'React'}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.55 : 1 })}
                >
                    {liked ? (
                        <Text style={{ fontSize: 12, lineHeight: 14 }} allowFontScaling={false}>
                            {likedEmoji}
                        </Text>
                    ) : (
                        <Ionicons name="heart-outline" size={13} color={palette.textMuted} />
                    )}
                    {row.reaction_count > 0 && (
                        <Text style={{ fontSize: 10.5, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                            {row.reaction_count}
                        </Text>
                    )}
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="chatbubble-outline" size={12} color={palette.textMuted} />
                    <Text style={{ fontSize: 10.5, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                        {row.comment_count > 0
                            ? `${row.comment_count} ${row.comment_count === 1 ? 'reply' : 'replies'}`
                            : 'reply'}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

// ── Ledger row — a bare rating, one line, no chrome ─────────────────────────────

function LedgerRow({ row }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { rating, onPress } = useRowNav(row);

    const restaurantName = row.restaurant?.name ?? 'somewhere';

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                paddingHorizontal: 4,
                opacity: pressed ? 0.7 : 1,
            })}
        >
            <Avatar name={row.author.display_name} url={row.author.avatar_url} size={22} palette={palette} />
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: palette.textMuted, fontFamily: 'Manrope_400Regular' }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: palette.text }}>{row.author.display_name}</Text>
                {rating > 0 ? ' tried ' : ' noted '}
                <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14, color: palette.text }}>
                    {restaurantName}
                </Text>
            </Text>
            {rating > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14, color: palette.tertiary }}>
                        {rating.toFixed(1)}
                    </Text>
                    <Text style={{ fontSize: 10, color: palette.star }}>★</Text>
                </View>
            )}
        </Pressable>
    );
}

// ── Rating chip — amber-cream fill, brand numeral (never grey stars) ────────────

function RatingChip({ rating, palette }: { rating: number; palette: typeof Colors.light }) {
    return (
        <View
            style={{
                marginLeft: 'auto',
                backgroundColor: palette.tertiaryFixed,
                borderRadius: Radius.full,
                paddingHorizontal: 12,
                paddingTop: 4,
                paddingBottom: 5,
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: 3,
                flexShrink: 0,
            }}
        >
            <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15, color: palette.tertiary }}>
                {rating.toFixed(1)}
            </Text>
            <Text style={{ fontSize: 9, color: palette.tertiary }}>★</Text>
        </View>
    );
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
            <View style={{ flexDirection: 'row', gap: 6 }}>
                {photos.map((p, i) => (
                    <Image
                        key={i}
                        source={{ uri: p }}
                        style={{ flex: 1, aspectRatio: 1, borderRadius: Radius.md }}
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
