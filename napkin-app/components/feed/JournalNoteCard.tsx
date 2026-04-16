/**
 * JournalNoteCard — "Journal Note" card matching the wireframe.
 *
 * Layout: timeline dot + left border, "X noted", restaurant name in
 * Newsreader secondary, dish/tag chips.
 *
 * Used for solo_share items that have NO rating (the "noted" verb).
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { InteractionPill } from './InteractionPill';

type Palette = typeof Colors.light;

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
    });
}

interface JournalNoteCardProps {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
}

export function JournalNoteCard({ item, palette, tableId }: JournalNoteCardProps) {
    const router = useRouter();
    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const ago = timeAgo(item.created_at);

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
                router.push({
                    pathname: '/entry-detail',
                    params: { entryId: item.id },
                })
            }
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

                {/* Header: "Julian noted  ·  2 hours ago" */}
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
                    <Text style={[styles.timeAgo, { color: palette.textMuted }]}>
                        {ago}
                    </Text>
                </View>

                {/* Card body */}
                <View
                    style={[
                        styles.card,
                        { backgroundColor: palette.surfaceContainerLow },
                    ]}
                >
                    <Text
                        style={[
                            styles.restaurantName,
                            { color: palette.secondary },
                        ]}
                        numberOfLines={1}
                    >
                        {restaurantName}
                    </Text>

                    {/* Tags row */}
                    {(item.dish_description || item.content) && (
                        <View style={styles.tagsRow}>
                            {item.dish_description ? (
                                <Text
                                    style={[
                                        styles.tag,
                                        {
                                            backgroundColor:
                                                palette.tertiaryFixed,
                                            color: palette.tertiary,
                                        },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.dish_description}
                                </Text>
                            ) : null}
                            {item.content ? (
                                <Text
                                    style={[
                                        styles.tag,
                                        {
                                            backgroundColor:
                                                palette.secondaryContainer,
                                            color: palette.textSecondary,
                                        },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.content}
                                </Text>
                            ) : null}
                        </View>
                    )}

                    {/* Interaction pill */}
                    {((item.reaction_count ?? 0) >= 1 || (item.comment_count ?? 0) >= 1) && (
                        <InteractionPill
                            topEmojis={item.top_emojis ?? []}
                            commentCount={item.comment_count ?? 0}
                            reactionCount={item.reaction_count ?? 0}
                            textColor={palette.textMuted}
                        />
                    )}
                </View>
            </View>
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
});
