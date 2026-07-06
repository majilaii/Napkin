/**
 * SharedSaveCard — TICKET-060.
 *
 * Table-feed card for a single shared restaurant save ("shared_save" kind).
 * Shows: author avatar + name + "shared" verb, restaurant name (italic Newsreader),
 * city · cuisine, optional note, and I'm-in reaction control.
 * Text-led: NO restaurant/Google thumbnail (owner entry photos or nothing —
 * doctrine locked 2026-07-05).
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
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SharedSaveCardRestaurant {
    id: string | null;
    name: string | null;
    city: string | null;
    cuisine: string | null;
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
    commentCount?: number;
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
    commentCount = 0,
    topEmojis,
    myReactions = [],
    createdAt,
    onCorrect,
}: SharedSaveCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    // Open the share thread — react with any emoji + reply ("let's go"). Replaces
    // the old single-👀 "I'm in" toggle with a real post.
    const handleOpenThread = useCallback(() => {
        router.push({
            // New route — expo-router typegen registers it at build time.
            pathname: '/share-detail' as any,
            params: {
                shareId,
                tableId,
                share: JSON.stringify({ author, restaurant, note: note ?? null }),
            },
        });
    }, [router, shareId, tableId, author, restaurant, note]);

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

            {/* Restaurant — text-led, no thumbnail (no restaurant/Google photos).
                Owner entry photos or nothing (doctrine locked 2026-07-05). */}
            <Pressable
                onPress={!isPending ? handleRestaurantTap : undefined}
                style={styles.restaurantRow}
            >
                <View style={styles.restaurantText}>
                    {isPending ? (
                        <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 17 }]}>
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

            {/* Footer — reactions + replies summary; taps open the thread where you
                can react with any emoji and reply ("let's go"). */}
            <Pressable
                onPress={handleOpenThread}
                style={({ pressed }) => [styles.footer, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="open thread to react or reply"
            >
                {topEmojis.length > 0 ? (
                    <Text style={styles.footerEmojis}>{topEmojis.slice(0, 3).join(' ')}</Text>
                ) : null}
                {reactionCount > 0 ? (
                    <Text style={[Type.caption, { color: palette.textMuted }]}>{reactionCount}</Text>
                ) : null}
                <View style={styles.footerReplies}>
                    <Ionicons name="chatbubble-outline" size={14} color={palette.textMuted} />
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        {commentCount > 0 ? `${commentCount}` : 'reply'}
                    </Text>
                </View>
            </Pressable>
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
        marginBottom: Spacing.xs,
    },
    restaurantText: {
        flex: 1,
    },
    restaurantName: {
        ...Type.headlineItalic,
        fontSize: 17,
        marginBottom: 2,
    } as any,
    note: {
        marginBottom: Spacing.sm,
        marginTop: Spacing.xs,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: Spacing.xs,
        minHeight: 28,
    },
    footerEmojis: {
        fontSize: 14,
    },
    footerReplies: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginLeft: 'auto',
    },
});

