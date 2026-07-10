/**
 * ShareDigestCard — TICKET-060 R8/B3.
 *
 * "jacky dropped 5 spots" — ONE ledger card for a multi-share drop (same author,
 * 6-hour bucket). Header row (author + count + chevron toggle) with each spot as
 * a compact row inside the same surface, separated by ghosted warm rules — not a
 * stack of full cards. Row tap → restaurant page; reply chip → share thread.
 * The author gets a ⋯ menu that retracts the whole drop (batch remove_share).
 * Digest child IDs are real stable table_shares.id values (B3).
 *
 * Heirloom Journal: lowercase, italic restaurant names, no emoji in chrome.
 */
import React, { useState, useCallback } from 'react';
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
import { type SharedSaveCardProps } from './SharedSaveCard';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Child shape coming from the edge fn hydrator (camelCase — H-6 fix).
 * Matches SharedSaveCardProps exactly so we can spread directly.
 */
export type DigestChildShare = SharedSaveCardProps;

export interface ShareDigestCardProps {
    /** Representative share id (stable, from the bucket's first share) */
    id: string;
    tableId: string;
    author: {
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
    };
    shareCount: number;
    /** Real stable table_shares.id values for each child (B3) */
    childIds: string[];
    /**
     * Hydrated child shares already mapped to SharedSaveCardProps shape (camelCase).
     * [H-6 FIX] children are now pre-mapped by the edge fn hydrator, not raw snake_case.
     */
    childShares?: DigestChildShare[];
    createdAt: string;
    /** Viewer id — enables the author-only ⋯ retract menu. */
    currentUserId?: string | null;
    onExpand?: () => void;
}

type Palette = typeof Colors.light;

// ── Row ───────────────────────────────────────────────────────────────────────

function DigestSpotRow({
    child,
    tableId,
    palette,
}: {
    child: DigestChildShare;
    tableId: string;
    palette: Palette;
}) {
    const router = useRouter();
    const { restaurant, note } = child;
    const commentCount = child.commentCount ?? 0;
    const reactionCount = child.reactionCount ?? 0;

    const cityLine = [restaurant?.city, restaurant?.cuisine].filter(Boolean).join(' · ');
    const isPending = child.extractionStatus === 'pending' || !restaurant?.id;

    const openRestaurant = useCallback(() => {
        if (restaurant?.id) router.push(`/restaurant/${restaurant.id}`);
    }, [router, restaurant]);

    const openThread = useCallback(() => {
        router.push({
            pathname: '/share-detail' as any,
            params: {
                shareId: child.shareId,
                tableId,
                share: JSON.stringify({
                    author: child.author,
                    restaurant: restaurant ?? null,
                    note: note ?? null,
                }),
            },
        });
    }, [router, child.shareId, child.author, tableId, restaurant, note]);

    return (
        <View style={[styles.row, { borderTopColor: palette.dividerSoft }]}>
            <Pressable
                onPress={!isPending ? openRestaurant : undefined}
                style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}
            >
                {isPending ? (
                    <Text style={[styles.rowName, { color: palette.textMuted }]}>reading it...</Text>
                ) : (
                    <>
                        <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                            {restaurant?.name ?? 'Unknown restaurant'}
                        </Text>
                        {cityLine ? (
                            <Text style={[Type.caption, { color: palette.textMuted }]} numberOfLines={1}>
                                {cityLine}
                            </Text>
                        ) : null}
                    </>
                )}
                {note ? (
                    <Text
                        style={[Type.caption, { color: palette.textSecondary }]}
                        numberOfLines={1}
                    >
                        {'— '}{note}
                    </Text>
                ) : null}
            </Pressable>
            <Pressable
                onPress={openThread}
                hitSlop={8}
                style={({ pressed }) => [styles.rowReply, { opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="open thread to like or reply"
            >
                {reactionCount > 0 ? (
                    <>
                        <Ionicons name="heart" size={12} color={palette.primary} />
                        <Text style={[Type.caption, { color: palette.textMuted }]}>{reactionCount}</Text>
                    </>
                ) : null}
                <Ionicons name="chatbubble-outline" size={14} color={palette.textMuted} />
                {commentCount > 0 ? (
                    <Text style={[Type.caption, { color: palette.textMuted }]}>{commentCount}</Text>
                ) : null}
            </Pressable>
        </View>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareDigestCard({
    id,
    tableId,
    author,
    shareCount,
    childIds,
    childShares,
    createdAt,
    currentUserId,
    onExpand,
}: ShareDigestCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const [expanded, setExpanded] = useState(true);
    const removeShare = useRemoveShare();

    const isOwn = !!currentUserId && author.user_id === currentUserId;
    const authorName = author.display_name ?? 'someone';
    const spotsWord = shareCount === 1 ? 'spot' : 'spots';

    const handleExpand = useCallback(() => {
        setExpanded((v) => !v);
        if (!expanded && onExpand) onExpand();
    }, [expanded, onExpand]);

    const handleRemoveAll = useCallback(() => {
        if (childIds.length === 0) return;
        Alert.alert(`remove ${shareCount} ${spotsWord}?`, 'they disappear from the table.', [
            { text: 'cancel', style: 'cancel' },
            {
                text: 'remove',
                style: 'destructive',
                onPress: () =>
                    removeShare.mutate(
                        { shareIds: childIds },
                        {
                            onError: (err: any) =>
                                Alert.alert('Error', err?.message ?? 'Could not remove these shares.'),
                        },
                    ),
            },
        ]);
    }, [childIds, shareCount, spotsWord, removeShare]);

    return (
        <View style={[styles.card, { backgroundColor: palette.card }, Shadow.ambient]}>
            {/* Header — author + count; tap toggles the spot list */}
            <Pressable
                onPress={handleExpand}
                style={({ pressed }) => [styles.headerRow, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={`${authorName} dropped ${shareCount} ${spotsWord}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
            >
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
                <Text style={[Type.bodySmall, styles.headerLabel, { color: palette.textMuted }]} numberOfLines={1}>
                    <Text style={{ color: palette.text }}>{authorName}</Text>
                    {` dropped ${shareCount} ${spotsWord}`}
                </Text>
                <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={palette.textMuted}
                />
                {isOwn ? (
                    <Pressable
                        onPress={handleRemoveAll}
                        disabled={removeShare.isPending}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="remove all shared spots"
                        style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.5 : 1 }]}
                    >
                        <Ionicons name="ellipsis-horizontal" size={16} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </Pressable>

            {/* Spot rows — one per share, ghosted warm rules between */}
            {expanded && childShares && childShares.length > 0
                ? childShares.map((child) => (
                      <DigestSpotRow
                          key={child.shareId}
                          child={child}
                          tableId={tableId}
                          palette={palette}
                      />
                  ))
                : null}
            {expanded && (!childShares || childShares.length === 0) ? (
                <View style={[styles.row, { borderTopColor: palette.dividerSoft }]}>
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        loading spots...
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: 12,
    },
    headerLabel: {
        flex: 1,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: Spacing.xs + 2,
    },
    menuButton: {
        marginLeft: Spacing.sm + 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.md,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowMain: {
        flex: 1,
    },
    rowName: {
        ...Type.headlineItalic,
        fontSize: 16,
        lineHeight: 21,
    } as any,
    rowReply: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
});
