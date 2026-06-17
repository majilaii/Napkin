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
 * `restaurants.name`. Reactions strip uses reaction_count + top_emojis.
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
    onPress,
}: TableEntryCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

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

            {/* Photo */}
            {photoUrl ? (
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
