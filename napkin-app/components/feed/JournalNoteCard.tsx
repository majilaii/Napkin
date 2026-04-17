/**
 * JournalNoteCard — "Journal Note" card matching the wireframe.
 *
 * Layout: timeline dot + left border, "X noted", restaurant name in
 * Newsreader secondary, dish/tag chips.
 *
 * Used for solo_share items that have NO rating (the "noted" verb).
 *
 * TICKET-010 additions:
 *  - Replace local timeAgo() with shared formatRelativeTime() (null for ≥ 24h)
 *  - Replace item.content tag-chip with em-dash pull-quote via extractHighlight()
 *  - Card-level long-press (500ms) → ReactionPicker anchored top-right of .card
 *  - Unseen dot (top-right inside the .card body)
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

import { Colors, Spacing, Radius } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { extractHighlight, formatRelativeTime } from '@/lib/textHighlight';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface JournalNoteCardProps {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

export function JournalNoteCard({ item, palette, tableId, lastSeenAt }: JournalNoteCardProps) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';

    // Relative time — null for ≥ 24h; DateSectionHeader labels those buckets.
    const relativeTime = item.sort_date
        ? formatRelativeTime(item.sort_date)
        : item.created_at
        ? formatRelativeTime(item.created_at)
        : null;

    // Quote blurb — extracted highlight; replaces old tag-chip for content
    const highlight = extractHighlight(item.content);

    // Unseen dot: render when lastSeenAt is null (never seen) or item is newer
    const sortDate = item.sort_date ?? item.created_at;
    const isUnseen = !lastSeenAt || (!!sortDate && sortDate > lastSeenAt);

    // Card-level long-press picker anchor (anchored to .card view, not outer Pressable)
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
            // Anchor near top-right of the card body
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
                router.push({
                    pathname: '/entry-detail',
                    params: { entryId: item.id },
                })
            }
            onLongPress={handleLongPress}
            delayLongPress={500}
            style={({ pressed }) => ({
                opacity: pressed ? 0.8 : 1,
            })}
        >
            <View
                style={[
                    styles.container,
                    { borderLeftColor: palette.outlineVariant },
                ]}
            >
                {/* Timeline dot */}
                <View
                    style={[
                        styles.dot,
                        { backgroundColor: palette.secondary },
                    ]}
                />

                {/* Header: "Julian noted  ·  2h ago" (null time = hidden) */}
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={tableId ? handleAuthorPress : undefined}
                        hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
                    >
                        <Text style={[styles.headerName, { color: palette.text }]}>
                            {displayName}{' '}
                            <Text style={{ fontFamily: 'Manrope_400Regular' }}>
                                noted
                            </Text>
                        </Text>
                    </Pressable>
                    {relativeTime ? (
                        <Text style={[styles.timeAgo, { color: palette.textMuted }]}>
                            {relativeTime}
                        </Text>
                    ) : null}
                </View>

                {/* Card body */}
                <View
                    ref={cardRef}
                    style={[
                        styles.card,
                        { backgroundColor: palette.surfaceContainerLow },
                    ]}
                >
                    {/* Unseen dot — inside .card so it sits within the rounded body */}
                    {isUnseen && (
                        <View
                            style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                        />
                    )}

                    <Text
                        style={[
                            styles.restaurantName,
                            { color: palette.secondary },
                        ]}
                        numberOfLines={1}
                    >
                        {restaurantName}
                    </Text>

                    {/* Tags row: dish_description chip + em-dash quote for content */}
                    {(item.dish_description || highlight) && (
                        <View style={styles.tagsRow}>
                            {item.dish_description ? (
                                <Text
                                    style={[
                                        styles.tag,
                                        {
                                            backgroundColor: palette.tertiaryFixed,
                                            color: palette.tertiary,
                                        },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.dish_description}
                                </Text>
                            ) : null}
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
                        </View>
                    )}

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

            {/* Card-level ReactionPicker */}
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
    container: {
        paddingLeft: Spacing.lg,
        borderLeftWidth: 2,
        paddingVertical: Spacing.xs,
    },
    dot: {
        position: 'absolute',
        left: -5,
        top: Spacing.md,
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    headerName: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    timeAgo: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
    },
    card: {
        borderRadius: Radius.xl,
        padding: Spacing.md,
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
    restaurantName: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 20,
        lineHeight: 26,
    },
    tagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
        marginTop: Spacing.sm,
    },
    tag: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        overflow: 'hidden',
    },
    quoteBlurb: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
        flex: 1,
    },
});
