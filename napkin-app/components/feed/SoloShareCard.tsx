/**
 * SoloShareCard — canvas-faithful TNoteCard shape (rated variant).
 * Reference: tables-screens.jsx → TNoteCard.
 *
 * Layout:
 *   [warm-white card, radius 10, shadow note, 1px rule-warm border]
 *   Header row: 24px circular avatar + "X went solo to {Restaurant}" + time right
 *   Optional sub: uppercase 10pt muted (dish)
 *   Rating row: inline Rating (italic 12pt amber + /5) + optional "On our list"
 *   Italic prose quote (Newsreader italic 13pt, max 3 lines)
 *
 * Preserved functional bits: unseen dot, FeedActionRow below (heart = like/unlike).
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Shadow } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { extractHighlight, formatRelativeTime } from '@/lib/textHighlight';
import { formatCompanions } from '@/lib/companions';
import { Avatar } from './Avatar';
import { Rating } from '@/components/ui/napkin/Rating';
import { FeedActionRow } from './FeedActionRow';

type Palette = typeof Colors.light;

interface Props {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

export function SoloShareCard({ item, palette, tableId, lastSeenAt }: Props) {
    const router = useRouter();

    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const companionLine = formatCompanions(item.companions);

    const isUnseen =
        !lastSeenAt || (!!item.sort_date && item.sort_date > lastSeenAt);

    const relativeTime = item.sort_date ? formatRelativeTime(item.sort_date) : null;
    const highlight = extractHighlight(item.content);

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
            onPress={() =>
                router.push({ pathname: '/entry-detail', params: { entryId: item.id } })
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.95 : 1 })}
        >
            <View
                style={[styles.card, { backgroundColor: palette.surfaceNote, borderColor: 'rgba(221,192,186,0.08)' }]}
            >
                {isUnseen && (
                    <View
                        style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                )}

                {/* Header row */}
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={tableId ? handleAuthorPress : undefined}
                        hitSlop={6}
                    >
                        <Avatar
                            name={displayName}
                            url={null}
                            size={24}
                            palette={palette}
                        />
                    </Pressable>
                    <Text
                        style={[styles.attribution, { color: palette.textSecondary }]}
                        numberOfLines={1}
                    >
                        <Text style={[styles.who, { color: palette.text }]}>
                            {displayName}
                        </Text>
                        {' went solo to '}
                        <Text style={[styles.place, { color: palette.primary }]}>
                            {restaurantName}
                        </Text>
                    </Text>
                    {relativeTime ? (
                        <Text style={[styles.time, { color: palette.textMuted }]}>
                            {relativeTime}
                        </Text>
                    ) : null}
                </View>

                {/* Companion line — "with Clara · Thomas" */}
                {companionLine ? (
                    <Text style={[styles.companions, { color: palette.textMuted }]} numberOfLines={1}>
                        {companionLine}
                    </Text>
                ) : null}

                {/* Optional sub (dish) */}
                {item.dish_description ? (
                    <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
                        {item.dish_description}
                    </Text>
                ) : null}

                {/* Rating row */}
                {item.rating != null && (
                    <View style={styles.ratingRow}>
                        <Rating value={item.rating} size="inline" />
                    </View>
                )}

                {/* Prose quote */}
                {highlight ? (
                    <Text
                        style={[styles.prose, { color: palette.text }]}
                        numberOfLines={3}
                    >
                        &ldquo;{highlight}&rdquo;
                    </Text>
                ) : null}

                <View style={styles.actionRow}>
                    <FeedActionRow
                        targetType="entry"
                        targetId={item.id}
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
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        padding: 16,
        paddingVertical: 14,
        borderRadius: 18,
        borderWidth: 1,
        ...Shadow.note,
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
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
    },
    attribution: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        flex: 1,
        minWidth: 0,
    },
    who: {
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
    },
    place: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        fontWeight: '500',
    },
    time: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        flexShrink: 0,
    },
    companions: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginBottom: 4,
    },
    sub: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    prose: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 20,
    },
    actionRow: {
        marginTop: 10,
    },
});
