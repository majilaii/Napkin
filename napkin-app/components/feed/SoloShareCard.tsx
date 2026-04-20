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
 * Preserved functional bits: long-press reactions, unseen dot, FeedActionRow below.
 */
import React, { useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    findNodeHandle,
    UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { extractHighlight, formatRelativeTime } from '@/lib/textHighlight';
import { Avatar } from './Avatar';
import { Rating } from '@/components/ui/napkin/Rating';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface Props {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

export function SoloShareCard({ item, palette, tableId, lastSeenAt }: Props) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';

    const isUnseen =
        !lastSeenAt || (!!item.sort_date && item.sort_date > lastSeenAt);

    const relativeTime = item.sort_date ? formatRelativeTime(item.sort_date) : null;
    const highlight = extractHighlight(item.content);

    const cardRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

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
            onPress={() =>
                router.push({ pathname: '/entry-detail', params: { entryId: item.id } })
            }
            onLongPress={handleLongPress}
            delayLongPress={500}
            style={({ pressed }) => ({ opacity: pressed ? 0.95 : 1 })}
        >
            <View
                ref={cardRef}
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.surfaceNote,
                        borderColor: palette.dividerSoft,
                    },
                ]}
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
                        <Text style={[styles.place, { color: palette.text }]}>
                            {restaurantName}
                        </Text>
                    </Text>
                    {relativeTime ? (
                        <Text style={[styles.time, { color: palette.textMuted }]}>
                            {relativeTime}
                        </Text>
                    ) : null}
                </View>

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
    card: {
        padding: 16,
        paddingVertical: 14,
        borderRadius: Radius.md - 2,
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
        fontSize: 13,
    },
    time: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        flexShrink: 0,
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
