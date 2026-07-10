/**
 * SharedSaveCard — TICKET-060.
 *
 * Table-feed card for a single shared restaurant save ("shared_save" kind).
 * Compact: author line + restaurant name (italic Newsreader) + city · cuisine,
 * optional note, reply affordance. Author gets a ⋯ menu to retract the share.
 * Text-led: NO restaurant/Google thumbnail (owner entry photos or nothing —
 * doctrine locked 2026-07-05).
 *
 * Heirloom Journal: warm paper surface, lowercase past-tense "shared",
 * middle-dot separator, no emoji in chrome, ambient shadows.
 * booking_url is deliberately NOT rendered (L3/KEEP — TICKET-061 seam).
 */
import React, { useCallback } from 'react';
import {
    Alert,
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
import { useRemoveShare } from '@/hooks/posts/useRemoveShare';

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
    myReactions?: string[];
    createdAt: string;
    /** Viewer id — enables the author-only ⋯ retract menu. */
    currentUserId?: string | null;
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
    myReactions = [],
    createdAt,
    currentUserId,
    onCorrect,
}: SharedSaveCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const removeShare = useRemoveShare();

    const isOwn = !!currentUserId && author.user_id === currentUserId;

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

    const handleRemove = useCallback(() => {
        Alert.alert('remove this spot?', 'it disappears from the table.', [
            { text: 'cancel', style: 'cancel' },
            {
                text: 'remove',
                style: 'destructive',
                onPress: () =>
                    removeShare.mutate(
                        { shareId },
                        {
                            onError: (err: any) =>
                                Alert.alert('Error', err?.message ?? 'Could not remove this share.'),
                        },
                    ),
            },
        ]);
    }, [removeShare, shareId]);

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
                <Text style={[Type.caption, styles.authorLabel, { color: palette.textMuted }]} numberOfLines={1}>
                    <Text style={{ color: palette.text }}>{author.display_name ?? 'someone'}</Text>
                    {' shared'}
                </Text>
                {isOwn ? (
                    <Pressable
                        onPress={handleRemove}
                        disabled={removeShare.isPending}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="remove this share"
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                        <Ionicons name="ellipsis-horizontal" size={16} color={palette.textMuted} />
                    </Pressable>
                ) : null}
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
                                    style={[Type.caption, { color: palette.textMuted }]}
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

            {/* Footer — likes + replies summary; taps open the thread where you
                can heart it and reply ("let's go"). */}
            <Pressable
                onPress={handleOpenThread}
                style={({ pressed }) => [styles.footer, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="open thread to like or reply"
            >
                {reactionCount > 0 ? (
                    <View style={styles.footerLikes}>
                        <Ionicons name="heart" size={13} color={palette.primary} />
                        <Text style={[Type.caption, { color: palette.textMuted }]}>{reactionCount}</Text>
                    </View>
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
        paddingHorizontal: Spacing.md,
        paddingVertical: 12,
        marginBottom: Spacing.sm,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    authorLabel: {
        flex: 1,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: Spacing.xs + 2,
    },
    restaurantRow: {
        marginBottom: 0,
    },
    restaurantText: {
        flex: 1,
    },
    restaurantName: {
        ...Type.headlineItalic,
        fontSize: 17,
        lineHeight: 22,
        marginBottom: 1,
    } as any,
    note: {
        marginTop: 6,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
        minHeight: 20,
    },
    footerLikes: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    footerReplies: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginLeft: 'auto',
    },
});
