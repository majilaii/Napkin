/**
 * SharedSaveCard — TICKET-060.
 *
 * Table-feed card for a single shared restaurant save ("shared_save" kind).
 * Shows: author avatar + name + "shared" verb, restaurant name (italic Newsreader),
 * city · cuisine, source thumbnail, optional note, and I'm-in reaction control.
 *
 * Heirloom Journal: warm paper surface, lowercase past-tense "shared",
 * middle-dot separator, no emoji in chrome, ambient shadows.
 * booking_url is deliberately NOT rendered (L3/KEEP — TICKET-061 seam).
 */
import React, { useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToggleReaction } from '@/hooks/posts/usePostInteractions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SharedSaveCardRestaurant {
    id: string | null;
    name: string | null;
    city: string | null;
    cuisine: string | null;
    photo_url: string | null;
    verification?: string;
}

export interface SharedSaveCardProps {
    shareId: string;
    tableId: string;
    author: {
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
    };
    restaurant: SharedSaveCardRestaurant | null;
    note?: string | null;
    extractionStatus?: string | null;
    reactionCount: number;
    topEmojis: string[];
    myReactions?: string[];
    createdAt: string;
    onCorrect?: () => void;
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function SharedSaveCard({
    shareId,
    tableId,
    author,
    restaurant,
    note,
    extractionStatus,
    reactionCount,
    topEmojis,
    myReactions = [],
    createdAt,
    onCorrect,
}: SharedSaveCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const toggleReaction = useToggleReaction();

    const imInEmoji = '👀';
    const imInActive = myReactions.includes(imInEmoji);

    const handleImIn = useCallback(() => {
        toggleReaction.mutate({
            targetType: 'table_share',
            targetId: shareId,
            emoji: imInEmoji,
            tableId,
            scope: 'table',
        });
    }, [toggleReaction, shareId, imInEmoji, tableId]);

    const handleRestaurantTap = useCallback(() => {
        if (restaurant?.id) {
            router.push(`/restaurant/${restaurant.id}`);
        }
    }, [router, restaurant]);

    const cityLine = [restaurant?.city, restaurant?.cuisine].filter(Boolean).join(' · ');
    const isPending = extractionStatus === 'pending' || !restaurant?.id;
    const needsConfirm = extractionStatus === 'needs_confirm';

    return (
        <View
            style={[
                styles.card,
                { backgroundColor: palette.card },
                Shadow.ambient,
            ]}
        >
            {/* Author row */}
            <View style={styles.authorRow}>
                {author.avatar_url ? (
                    <Image
                        source={{ uri: author.avatar_url }}
                        style={styles.avatar}
                        accessibilityIgnoresInvertColors
                    />
                ) : (
                    <View
                        style={[
                            styles.avatar,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    />
                )}
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                    <Text style={{ color: palette.text }}>{author.display_name ?? 'someone'}</Text>
                    {' shared'}
                </Text>
            </View>

            {/* Restaurant */}
            <Pressable
                onPress={!isPending ? handleRestaurantTap : undefined}
                style={styles.restaurantRow}
            >
                {/* Thumbnail */}
                {restaurant?.photo_url ? (
                    <Image
                        source={{ uri: restaurant.photo_url }}
                        style={[styles.thumb, { borderRadius: Radius.sm }]}
                        accessibilityIgnoresInvertColors
                    />
                ) : (
                    <View
                        style={[
                            styles.thumb,
                            { backgroundColor: palette.surfaceContainerHigh, borderRadius: Radius.sm },
                        ]}
                    />
                )}
                <View style={styles.restaurantText}>
                    {isPending ? (
                        <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 15 }]}>
                            reading it...
                        </Text>
                    ) : (
                        <>
                            <Text
                                style={[styles.restaurantName, { color: palette.text }]}
                                numberOfLines={1}
                            >
                                {restaurant?.name ?? 'Unknown restaurant'}
                            </Text>
                            {cityLine ? (
                                <Text
                                    style={[Type.bodySmall, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    {cityLine}
                                </Text>
                            ) : null}
                            {needsConfirm && onCorrect ? (
                                <Pressable onPress={onCorrect} hitSlop={8}>
                                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]}>
                                        tap to confirm
                                    </Text>
                                </Pressable>
                            ) : null}
                        </>
                    )}
                </View>
            </Pressable>

            {/* Note */}
            {note ? (
                <Text
                    style={[Type.bodySmall, styles.note, { color: palette.textSecondary }]}
                    numberOfLines={3}
                >
                    {'— '}{note}
                </Text>
            ) : null}

            {/* I'm in reaction */}
            <View style={styles.reactionRow}>
                <Pressable
                    onPress={handleImIn}
                    style={({ pressed }) => [
                        styles.imInButton,
                        {
                            backgroundColor: imInActive ? palette.primaryMuted : palette.surfaceJournalLow,
                            opacity: pressed ? 0.8 : 1,
                        },
                    ]}
                    accessibilityLabel="I'm in"
                >
                    <Text style={[Type.caption, { color: imInActive ? palette.primary : palette.textMuted }]}>
                        {reactionCount > 0
                            ? `${reactionCount} in`
                            : "i'm in"}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.md,
        padding: Spacing.md,
        marginBottom: Spacing.sm,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        marginRight: Spacing.xs,
    },
    restaurantRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: Spacing.xs,
    },
    thumb: {
        width: 52,
        height: 52,
        marginRight: Spacing.md,
        flexShrink: 0,
    },
    restaurantText: {
        flex: 1,
    },
    restaurantName: {
        ...Type.headlineItalic,
        fontSize: 15,
        marginBottom: 2,
    } as any,
    note: {
        marginBottom: Spacing.sm,
        marginTop: Spacing.xs,
    },
    reactionRow: {
        flexDirection: 'row',
        marginTop: Spacing.xs,
    },
    imInButton: {
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.sm,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
