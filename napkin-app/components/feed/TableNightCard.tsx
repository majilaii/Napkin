/**
 * TableNightCard — "Group Entry" card matching the wireframe.
 *
 * Layout (top → bottom):
 *  1. Label: "Group Entry • 14 Dec" (uppercase, secondary)
 *  2. Full-bleed hero image (or colour-initial fallback), rounded-[2rem]
 *  3. Large italic Newsreader restaurant name
 *  4. Row: overlapping stacked avatars  |  amber rating chip
 *  5. Quote block (first participant note) with decorative quote marks
 *
 * TICKET-010 additions:
 *  - Card-level long-press (500ms) → ReactionPicker; disabled when status === 'rating'
 *  - Unseen dot (top-right of card); hidden when status === 'rating'
 *  - Relative time appended to label when < 24h (e.g. "GROUP ENTRY · 14 DEC · 2H AGO")
 *  NOTE: Quote extraction does NOT run on TableNightCard (Rounds have multiple authors).
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
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { type TableNightActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { formatRelativeTime } from '@/lib/textHighlight';
import { Avatar } from './Avatar';
import { PulseDot } from './PulseDot';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface TableNightCardProps {
    item: TableNightActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

const MAX_VISIBLE_AVATARS = 3;

export function TableNightCard({ item, palette, tableId, lastSeenAt }: TableNightCardProps) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const isActive = item.status === 'rating';
    const photoUrl = item.restaurants?.photo_url ?? null;
    const restaurantName = item.restaurants?.name ?? 'Unknown';
    const restaurantInitial = restaurantName[0].toUpperCase();

    const sortDate = item.revealed_at ?? item.created_at;
    const dateLabel = formatShortDate(sortDate);

    // Relative time — null for ≥ 24h. Only appended when non-null (< 24h).
    const relativeTime = sortDate ? formatRelativeTime(sortDate) : null;

    // Label: "LIVE ROUND" | "GROUP ENTRY · 14 DEC" | "GROUP ENTRY · 14 DEC · 2H AGO"
    const labelText = isActive
        ? 'LIVE ROUND'
        : relativeTime
        ? `GROUP ENTRY \u00B7 ${dateLabel.toUpperCase()} \u00B7 ${relativeTime.toUpperCase()}`
        : `GROUP ENTRY \u00B7 ${dateLabel.toUpperCase()}`;

    // Unseen dot: hidden on live rounds (already have PulseDot + LIVE ROUND label)
    const isUnseen =
        !isActive &&
        (!lastSeenAt || (!!sortDate && sortDate > lastSeenAt));

    // First participant note for the quote block (unchanged — no extraction on rounds)
    const firstNote = item.participants?.find((p) => p.notes)?.notes ?? null;

    const visibleParticipants = item.participants?.slice(0, MAX_VISIBLE_AVATARS) ?? [];
    const overflowCount = Math.max(0, (item.participants?.length ?? 0) - MAX_VISIBLE_AVATARS);

    // Card-level long-press picker anchor
    const cardRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

    const handleLongPress = () => {
        if (isActive) return; // Reactions locked during live round
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
            { targetType: 'table_night', targetId: item.id, emoji },
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
                    pathname: isActive ? '/table-night' : '/table-night-detail',
                    params: { nightId: item.id },
                })
            }
            onLongPress={handleLongPress}
            delayLongPress={500}
            style={({ pressed }) => ({
                opacity: pressed ? 0.95 : 1,
            })}
        >
            {/* Label */}
            <View style={styles.labelRow}>
                {isActive && <PulseDot size={7} color={palette.primary} />}
                <Text
                    style={[
                        styles.labelText,
                        { color: isActive ? palette.primary : palette.textSecondary },
                    ]}
                >
                    {labelText}
                </Text>
            </View>

            {/* Card container */}
            <View
                ref={cardRef}
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        shadowColor: palette.text,
                    },
                ]}
            >
                {/* Unseen dot — top-right of card (hidden during live rounds) */}
                {isUnseen && (
                    <View
                        style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                )}

                {/* Hero image or fallback */}
                {photoUrl ? (
                    <Image
                        source={{ uri: photoUrl }}
                        style={styles.heroImage}
                        resizeMode="cover"
                    />
                ) : (
                    <View
                        style={[
                            styles.heroFallback,
                            { backgroundColor: palette.primaryMuted },
                        ]}
                    >
                        <Text
                            style={[
                                styles.heroInitial,
                                { color: palette.primary },
                            ]}
                        >
                            {restaurantInitial}
                        </Text>
                    </View>
                )}

                {/* Content below image */}
                <View style={styles.content}>
                    {/* Restaurant name + Rating row */}
                    <View style={styles.nameRow}>
                        <Text
                            style={[
                                styles.restaurantName,
                                { color: palette.text },
                            ]}
                            numberOfLines={2}
                        >
                            {restaurantName}
                        </Text>

                        {item.average_rating != null && (
                            <View
                                style={[
                                    styles.ratingChip,
                                    { backgroundColor: palette.tertiaryFixed },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.ratingValue,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    {item.average_rating.toFixed(1)}
                                </Text>
                                <Text
                                    style={[
                                        styles.ratingLabel,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    AVG
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Stacked avatars */}
                    {visibleParticipants.length > 0 && (
                        <View style={styles.avatarRow}>
                            {visibleParticipants.map((p, i) => (
                                <Pressable
                                    key={p.user_id}
                                    onPress={
                                        tableId
                                            ? () =>
                                                  router.push({
                                                      pathname: '/member/[userId]',
                                                      params: { userId: p.user_id, tableId },
                                                  })
                                            : undefined
                                    }
                                    hitSlop={6}
                                    style={[
                                        styles.avatarWrapper,
                                        {
                                            marginLeft: i === 0 ? 0 : -10,
                                            zIndex: MAX_VISIBLE_AVATARS - i,
                                            borderColor: palette.surfaceContainerLow,
                                        },
                                    ]}
                                >
                                    <Avatar
                                        name={p.profiles?.display_name ?? '?'}
                                        url={null}
                                        size={32}
                                        palette={palette}
                                    />
                                </Pressable>
                            ))}
                            {overflowCount > 0 && (
                                <View
                                    style={[
                                        styles.avatarWrapper,
                                        styles.overflowBubble,
                                        {
                                            marginLeft: -10,
                                            backgroundColor: palette.surfaceContainerHigh,
                                            borderColor: palette.surfaceContainerLow,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.overflowText,
                                            { color: palette.textSecondary },
                                        ]}
                                    >
                                        +{overflowCount}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Quote block — first participant note, no extraction (multiple authors) */}
                    {firstNote && (
                        <View style={styles.quoteBlock}>
                            <Text
                                style={[
                                    styles.quoteMark,
                                    { color: palette.primary },
                                ]}
                            >
                                {'\u201C'}
                            </Text>
                            <Text
                                style={[
                                    styles.quoteText,
                                    { color: palette.textSecondary },
                                ]}
                                numberOfLines={3}
                            >
                                {firstNote}
                            </Text>
                            <Text
                                style={[
                                    styles.quoteMark,
                                    styles.quoteMarkClose,
                                    { color: palette.primary },
                                ]}
                            >
                                {'\u201D'}
                            </Text>
                        </View>
                    )}

                    {/* Action row — only after reveal (reactions locked during live round) */}
                    {!isActive && (
                        <FeedActionRow
                            targetType="table_night"
                            targetId={item.id}
                            topEmojis={item.top_emojis ?? []}
                            reactionCount={item.reaction_count ?? 0}
                            commentCount={item.comment_count ?? 0}
                            myReactions={item.my_reactions ?? []}
                            palette={palette}
                            detailPathname="/table-night-detail"
                            detailParams={{ nightId: item.id }}
                            tableId={tableId}
                        />
                    )}
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
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: Spacing.sm,
    },
    labelText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.5,
    },
    card: {
        borderRadius: 28,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 30,
        elevation: 3,
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
        height: 220,
    },
    heroFallback: {
        width: '100%',
        height: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroInitial: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 42,
        opacity: 0.3,
    },
    content: {
        padding: Spacing.lg,
        paddingTop: Spacing.lg + 4,
        paddingBottom: Spacing.lg + 4,
    },
    nameRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 32,
        lineHeight: 38,
        flex: 1,
        marginRight: Spacing.md,
    },
    ratingChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: Radius.lg,
        alignItems: 'center',
    },
    ratingValue: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 22,
        lineHeight: 26,
    },
    ratingLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.8,
        opacity: 0.7,
        marginTop: -2,
    },
    avatarRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.md + 4,
    },
    avatarWrapper: {
        borderWidth: 2,
        borderRadius: 18,
    },
    overflowBubble: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overflowText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
    },
    quoteBlock: {
        marginTop: Spacing.md + 4,
    },
    quoteMark: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 32,
        lineHeight: 28,
    },
    quoteMarkClose: {
        textAlign: 'right',
        marginTop: -8,
    },
    quoteText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 22,
    },
});
