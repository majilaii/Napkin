/**
 * JournalNoteCard — canvas-faithful TNoteCard shape (no-rating variant).
 * Reference: tables-screens.jsx → TNoteCard.
 *
 * Same visual shape as SoloShareCard, but the verb flips to "noted" and
 * the rating row is suppressed. Used for solo_share items with no rating.
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

import { Colors } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { extractHighlight, formatRelativeTime } from '@/lib/textHighlight';
import { formatCompanions } from '@/lib/companions';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

interface Props {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

export function JournalNoteCard({ item, palette, tableId, lastSeenAt }: Props) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const companionLine = formatCompanions(item.companions);

    const sortDate = item.sort_date ?? item.created_at;
    const isUnseen = !lastSeenAt || (!!sortDate && sortDate > lastSeenAt);
    const relativeTime = sortDate ? formatRelativeTime(sortDate) : null;

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
                style={[styles.timeline, { borderLeftColor: palette.ruleWarmNib }]}
            >
                <View style={[styles.timelineDot, { backgroundColor: palette.secondary }]} />
                {isUnseen && (
                    <View
                        style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                )}

                <View style={styles.headerRow}>
                    <Text
                        style={[styles.attribution, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        <Text style={styles.who}>{displayName}</Text>
                        <Text style={{ color: palette.textSecondary }}>{' noted'}</Text>
                    </Text>
                    {relativeTime ? (
                        <Text style={[styles.time, { color: palette.textMuted }]}>
                            {relativeTime}
                        </Text>
                    ) : null}
                </View>

                <Pressable
                    onPress={tableId ? handleAuthorPress : undefined}
                    style={[styles.panel, { backgroundColor: palette.surfaceJournalLow }]}
                >
                    <Text
                        style={[styles.place, { color: palette.secondary }]}
                        numberOfLines={2}
                    >
                        {restaurantName}
                    </Text>
                    {item.dish_description ? (
                        <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
                            {item.dish_description}
                        </Text>
                    ) : null}
                    {companionLine ? (
                        <Text style={[styles.companions, { color: palette.textMuted }]} numberOfLines={1}>
                            {companionLine}
                        </Text>
                    ) : null}
                </Pressable>

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
    timeline: {
        paddingLeft: 22,
        borderLeftWidth: 2,
        position: 'relative',
    },
    timelineDot: {
        position: 'absolute',
        left: -5,
        top: 10,
        width: 8,
        height: 8,
        borderRadius: 4,
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
        gap: 8,
        marginBottom: 10,
    },
    attribution: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        flex: 1,
        minWidth: 0,
    },
    who: {
        fontFamily: 'Manrope_700Bold',
        fontWeight: '700',
    },
    time: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        flexShrink: 0,
    },
    panel: {
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    place: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 20,
        lineHeight: 26,
    },
    sub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        marginTop: 6,
    },
    companions: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 6,
    },
    prose: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 20,
        marginTop: 10,
    },
    actionRow: {
        marginTop: 12,
    },
});
