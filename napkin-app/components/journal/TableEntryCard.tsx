/**
 * TableEntryCard — EntryCard in table context.
 *
 * Canvas spec (Kit 06, table variant + P·TABLE):
 *   [24px avatar] Name tried/pinned RestaurantName · timestamp
 *   ── tick row: rating · neighborhood · weekday ──
 *   [optional photo 130px, r12]
 *   — em-dash italic pull-quote 16/24
 *   dish · with companions  (sans 12 muted)
 *   [heart N]  [chat N reply]  (reactions strip)
 *
 * Receives a SoloShareActivity-shaped object. The author attribution
 * header uses `profiles.display_name` + verb ("tried" / "pinned") +
 * `restaurants.name`. Likes strip uses reaction_count (heart-only).
 */
import React from 'react';
import {
    View,
    Text,
    Image,
    StyleSheet,
    Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SupperSummary } from '@/hooks/tables/useTableActivity';

interface TableEntryCardProps {
    authorName: string | null;
    /** "tried" | "pinned" — canvas verb set */
    verb: 'tried' | 'pinned';
    restaurantName: string;
    /** Relative time string — "2h", "1d" */
    relativeTime?: string;
    rating?: number | null;
    /** TICKET-075: small filled terracotta heart by the rating when true (read-only). */
    liked?: boolean;
    /** City + weekday meta — "Lincoln Center · fri" */
    metaLine?: string;
    photoUrl?: string | null;
    note?: string | null;
    dishMeta?: string | null;
    reactionCount?: number;
    commentCount?: number;
    /** Supper gathering — when present, the card shows pooled photos from every take
     *  + a "{N} at the table · avg" line, so you see the night without tapping in. */
    supper?: SupperSummary | null;
    onPress?: () => void;
}

function buildInitials(name: string | null): string {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
}

export function TableEntryCard({
    authorName,
    verb,
    restaurantName,
    relativeTime,
    rating,
    liked,
    metaLine,
    photoUrl,
    note,
    dishMeta,
    reactionCount,
    commentCount,
    supper,
    onPress,
}: TableEntryCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const supperPhotos = supper?.photos ?? [];
    const showSupperPhotos = !!supper && supperPhotos.length > 0;
    const supperAvatars = (supper?.takers ?? []).slice(0, 4);

    const inner = (
        <View
            style={[
                styles.card,
                { backgroundColor: palette.surfaceNote },
                Shadow.note,
            ]}
        >
            {/* Author attribution row */}
            <View style={styles.authorRow}>
                <View style={[styles.avatarCircle, { backgroundColor: palette.surfaceJournalHi }]}>
                    <Text style={[styles.avatarInitial, { color: palette.textMuted }]}>
                        {buildInitials(authorName)}
                    </Text>
                </View>
                <Text style={[styles.attribution, { color: palette.textSecondary }]} numberOfLines={1}>
                    <Text style={[styles.authorBold, { color: palette.text }]}>{authorName ?? 'Someone'}</Text>
                    {` ${verb} `}
                    <Text style={[styles.restaurantItalic, { color: palette.text }]}>{restaurantName}</Text>
                </Text>
                <View style={{ flex: 1 }} />
                {relativeTime ? (
                    <Text style={[styles.relTime, { color: palette.textMuted }]}>{relativeTime}</Text>
                ) : null}
            </View>

            {/* Tick meta row */}
            {(rating != null || metaLine || liked) && (
                <View style={styles.tickRow}>
                    {rating != null && (
                        <>
                            <Text style={[styles.tickRating, { color: palette.amberBright }]}>
                                {rating % 1 === 0 ? `${rating}.0` : `${rating}`}
                            </Text>
                            <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                        </>
                    )}
                    {liked ? (
                        <Ionicons
                            name="heart"
                            size={13}
                            color={palette.primary}
                            style={styles.likedHeart}
                            accessibilityLabel="liked"
                        />
                    ) : null}
                    {metaLine ? (
                        <Text style={[styles.tickMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {metaLine}
                        </Text>
                    ) : null}
                </View>
            )}

            {/* Photo — pooled supper photos (the whole night) when gathered, else the
                single hero. Pooled set already includes the host's own photo. */}
            {showSupperPhotos ? (
                <View style={styles.supperPhotoRow}>
                    {supperPhotos.slice(0, 3).map((uri, i) => (
                        <Image
                            key={`${uri}-${i}`}
                            source={{ uri }}
                            style={styles.supperPhoto}
                            resizeMode="cover"
                        />
                    ))}
                </View>
            ) : photoUrl ? (
                <Image
                    source={{ uri: photoUrl }}
                    style={styles.photo}
                    resizeMode="cover"
                />
            ) : null}

            {/* Note */}
            {note ? (
                <Text style={[styles.note, { color: palette.text }]}>
                    {`— ${note}`}
                </Text>
            ) : null}

            {/* Supper gathering line — avatars + "{N} at the table · avg" */}
            {supper && supper.head_count > 0 ? (
                <View style={styles.gatheringRow}>
                    <View style={styles.gatheringAvatars}>
                        {supperAvatars.map((t, i) => (
                            <View
                                key={t.user_id}
                                style={[
                                    styles.gatheringAvatar,
                                    {
                                        backgroundColor: palette.surfaceJournalHi,
                                        marginLeft: i === 0 ? 0 : -7,
                                        borderColor: palette.surfaceNote,
                                    },
                                ]}
                            >
                                <Text style={[styles.gatheringAvatarInitial, { color: palette.textMuted }]}>
                                    {buildInitials(t.display_name)}
                                </Text>
                            </View>
                        ))}
                    </View>
                    <Text style={[styles.gatheringText, { color: palette.textMuted }]} numberOfLines={1}>
                        {supper.head_count === 1
                            ? '1 at the table'
                            : `${supper.head_count} at the table`}
                    </Text>
                    {supper.group_avg != null ? (
                        <View style={[styles.avgChip, { backgroundColor: palette.tertiaryFixed }]}>
                            <Text style={[styles.avgLabel, { color: palette.tertiary }]}>avg</Text>
                            <Text style={[styles.avgNum, { color: palette.tertiary }]}>
                                {supper.group_avg.toFixed(1)}
                            </Text>
                        </View>
                    ) : null}
                </View>
            ) : null}

            {/* Dish meta */}
            {dishMeta ? (
                <Text
                    style={[styles.meta, { color: palette.textMuted }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {dishMeta}
                </Text>
            ) : null}

            {/* Reactions strip */}
            {((reactionCount ?? 0) > 0 || (commentCount ?? 0) > 0) ? (
                <View style={styles.reactionsRow}>
                    {(reactionCount ?? 0) > 0 && (
                        <View style={styles.reactionPill}>
                            <Ionicons name="heart-outline" size={15} color={palette.textMuted} />
                            <Text style={[styles.reactionCount, { color: palette.textMuted }]}>
                                {reactionCount}
                            </Text>
                        </View>
                    )}
                    {(commentCount ?? 0) > 0 && (
                        <View style={styles.reactionPill}>
                            <Ionicons name="chatbubble-outline" size={15} color={palette.textMuted} />
                            <Text style={[styles.reactionCount, { color: palette.textMuted }]}>
                                {commentCount === 1 ? '1 reply' : `${commentCount} replies`}
                            </Text>
                        </View>
                    )}
                </View>
            ) : null}
        </View>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [
                    styles.pressable,
                    pressed ? { opacity: 0.85 } : undefined,
                ]}
                accessibilityRole="button"
            >
                {inner}
            </Pressable>
        );
    }
    return <View style={styles.pressable}>{inner}</View>;
}

const styles = StyleSheet.create({
    pressable: {
        // No self horizontal padding — the feed list already provides the 20px
        // gutter (tables.tsx feedList). The earlier +24 here made review cards
        // 44px/side vs 20px for every sibling card, so they read as squished and
        // not reaching the edge.
        marginBottom: Spacing.sm,
    },
    card: {
        borderRadius: 16,
        // No 1px sectioning border (Heirloom rule) — separation comes from the
        // surfaceNote background shift + ambient Shadow.note below.
        borderWidth: 0,
        padding: Spacing.md,
        gap: 10,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    avatarCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatarInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    attribution: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        flexShrink: 1,
    },
    authorBold: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    restaurantItalic: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    relTime: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        flexShrink: 0,
    },
    tickRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    tickRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
    },
    dot: {
        fontSize: 12,
        lineHeight: 18,
    },
    likedHeart: {
        alignSelf: 'center',
        marginRight: 6,
    },
    tickMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        flexShrink: 1,
    },
    photo: {
        width: '100%',
        height: 130,
        borderRadius: 12,
    },
    supperPhotoRow: {
        flexDirection: 'row',
        gap: 4,
    },
    supperPhoto: {
        flex: 1,
        height: 110,
        borderRadius: 10,
    },
    gatheringRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    gatheringAvatars: {
        flexDirection: 'row',
    },
    gatheringAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
    },
    gatheringAvatarInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
    },
    gatheringText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
        flex: 1,
    },
    avgChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
    },
    avgLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    avgNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    note: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    reactionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingTop: 2,
    },
    reactionPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    reactionCount: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
