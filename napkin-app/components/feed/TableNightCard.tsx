/**
 * TableNightCard — canvas-faithful TRoundCard shape.
 * Reference: tables-screens.jsx → TRoundCard (newer wireframe bundle).
 *
 * Layout:
 *   [Photo 140px with dark "Round · {date}" pill top-left + unseen dot top-right]
 *   [Content 14/16:
 *     Row: Name (italic serif 22pt) + sub (11pt muted)   Rating (24pt amber italic) + "N / N VOICES"
 *     FeedActionRow (after reveal)
 *   ]
 *
 * Active live-round variant: terracotta pill w/ pulse dot, reactions disabled.
 *
 * The wireframes drop the avatar stack from the card body — the voices
 * label carries that weight. Member identity lives on the card detail view.
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

import { Colors, Spacing } from '@/constants/theme';
import { queryKeys } from '@/lib/queryKeys';
import { type TableNightActivity } from '@/hooks/tables/useTableActivity';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';
import { PulseDot } from '@/components/ui/napkin/PulseDot';
import { FeedActionRow } from './FeedActionRow';
import { ReactionPicker } from './ReactionPicker';

type Palette = typeof Colors.light;

function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface Props {
    item: TableNightActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
    chips?: string[];
}

export function TableNightCard({ item, palette, tableId, lastSeenAt, chips = [] }: Props) {
    const router = useRouter();
    const toggleReaction = useToggleReaction();
    const queryClient = useQueryClient();

    const isActive = item.status === 'rating';
    const photoUrl = item.restaurants?.photo_url ?? null;
    const restaurantName = item.restaurants?.name ?? 'Unknown';
    const sub = [item.restaurants?.city].filter(Boolean).join(' \u00B7 ');

    const sortDate = item.revealed_at ?? item.created_at;
    const dateLabel = formatShortDate(sortDate);

    const isUnseen =
        !isActive && (!lastSeenAt || (!!sortDate && sortDate > lastSeenAt));

    const voiceTotal = item.participants?.length ?? 0;
    const voiceVoted =
        item.participants?.filter((p) => p.rating != null).length ?? voiceTotal;

    const cardRef = useRef<View>(null);
    const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

    const handleLongPress = () => {
        if (isActive) return;
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
            { targetType: 'table_night', targetId: item.id, emoji, scope: 'table' },
            {
                onSuccess: () => {
                    if (tableId) {
                        queryClient.invalidateQueries({
                            queryKey: queryKeys.tables.activityForTable(tableId),
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
            style={({ pressed }) => ({ opacity: pressed ? 0.95 : 1 })}
        >
            <View
                ref={cardRef}
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.surfaceJournalLow,

                    },
                ]}
            >
                {/* Hero photo */}
                <View style={[styles.hero, { backgroundColor: palette.surfaceContainerHigh }]}>
                    {photoUrl ? (
                        <Image
                            source={{ uri: photoUrl }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                        />
                    ) : null}

                    {/* Pill top-left — dark caption, cream text */}
                    <View
                        style={[
                            styles.heroPill,
                            isActive
                                ? { backgroundColor: palette.primary }
                                : { backgroundColor: 'rgba(252,249,244,0.88)' },
                        ]}
                    >
                        {isActive && <PulseDot size={6} color="#f6ecd9" />}
                        <Text style={styles.heroPillText}>
                            {isActive
                                ? 'LIVE ROUND'
                                : `Round \u00B7 ${dateLabel}`}
                        </Text>
                    </View>

                    {/* Unseen dot top-right */}
                    {isUnseen && (
                        <View
                            style={[
                                styles.unseenDot,
                                { backgroundColor: palette.primary },
                            ]}
                        />
                    )}
                </View>

                {/* Content */}
                <View style={styles.content}>
                    <View style={styles.titleRow}>
                        <View style={styles.titleLeft}>
                            <Text
                                style={[styles.name, { color: palette.text }]}
                                numberOfLines={2}
                            >
                                {restaurantName}
                            </Text>
                            {sub ? (
                                <Text
                                    style={[styles.sub, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    {sub}
                                </Text>
                            ) : null}
                        </View>

                        {item.average_rating != null && (
                            <View style={styles.ratingCol}>
                                <Text style={[styles.ratingValue, { color: palette.tertiary }]}>
                                    {item.average_rating.toFixed(1)}
                                </Text>
                                <Text style={[styles.voicesLabel, { color: palette.textMuted }]}>
                                    {voiceTotal > 0
                                        ? `${voiceVoted} / ${voiceTotal} VOICES`
                                        : 'VOICES'}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Amber chips */}
                    {chips.length > 0 && (
                        <View style={styles.chipsRow}>
                            {chips.map((c, i) => (
                                <View key={i} style={[styles.chip, { backgroundColor: palette.tertiaryFixed }]}>
                                    <Text style={[styles.chipText, { color: palette.amberInk }]}>{c}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Action row — only after reveal */}
                    {!isActive && (
                        <View style={styles.actionRow}>
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
                        </View>
                    )}
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
        borderRadius: 24,
        overflow: 'hidden',
    },
    hero: {
        height: 200,
        position: 'relative',
    },
    heroPill: {
        position: 'absolute',
        top: 14,
        left: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 9999,
    },
    heroPillText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        color: Colors.light.text,
        textTransform: 'uppercase',
    },
    unseenDot: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 20,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: Spacing.md,
    },
    titleLeft: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        fontWeight: '500',
        lineHeight: 32,
        letterSpacing: -0.4,
    },
    sub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 3,
    },
    ratingCol: {
        alignItems: 'flex-end',
        flexShrink: 0,
    },
    ratingValue: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 26,
        letterSpacing: -0.3,
    },
    voicesLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8,
        letterSpacing: 0.8,
        marginTop: 2,
        textTransform: 'uppercase',
    },
    actionRow: {
        marginTop: 10,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 10,
    },
    chip: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 3,
    },
    chipText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
});
