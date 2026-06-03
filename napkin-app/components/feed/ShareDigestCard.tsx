/**
 * ShareDigestCard — TICKET-060 R8/B3.
 *
 * "Jacky dropped 4 spots" — expandable digest of multiple shares from one author
 * in a 6-hour bucket. Expandable to reveal individual restaurants, each with
 * its own I'm-in reaction. Digest child IDs are real stable table_shares.id values (B3).
 *
 * Heirloom Journal: lowercase, italic restaurant names, no emoji in chrome.
 */
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Image,
} from 'react-native';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SharedSaveCard, type SharedSaveCardProps } from './SharedSaveCard';

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
    onExpand?: () => void;
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareDigestCard({
    id,
    tableId,
    author,
    shareCount,
    childIds,
    childShares,
    createdAt,
    onExpand,
}: ShareDigestCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const [expanded, setExpanded] = useState(false);

    const handleExpand = useCallback(() => {
        setExpanded((v) => !v);
        if (!expanded && onExpand) onExpand();
    }, [expanded, onExpand]);

    const authorName = author.display_name ?? 'someone';
    const spotsWord = shareCount === 1 ? 'spot' : 'spots';

    return (
        <View>
            {/* Collapsed summary row */}
            <Pressable
                onPress={handleExpand}
                style={({ pressed }) => [
                    styles.digestRow,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        opacity: pressed ? 0.85 : 1,
                    },
                    Shadow.clip,
                ]}
                accessibilityLabel={`${authorName} dropped ${shareCount} ${spotsWord}. Tap to expand.`}
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
                <Text style={[Type.body, { color: palette.text, flex: 1 }]}>
                    <Text style={{ color: palette.text }}>{authorName}</Text>
                    {` dropped ${shareCount} ${spotsWord}`}
                </Text>
                <Text style={[Type.caption, { color: palette.textMuted }]}>
                    {expanded ? 'collapse' : 'expand'}
                </Text>
            </Pressable>

            {/* Expanded children */}
            {expanded && childShares && childShares.length > 0 && (
                <View style={styles.childrenList}>
                    {childShares.map((child) => (
                        <SharedSaveCard key={child.shareId} {...child} />
                    ))}
                </View>
            )}
            {expanded && (!childShares || childShares.length === 0) && (
                <View style={[styles.loadingRow, { backgroundColor: palette.surfaceJournalLow }]}>
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        loading spots...
                    </Text>
                </View>
            )}
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    digestRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        minHeight: 52,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        marginRight: Spacing.sm,
    },
    childrenList: {
        marginLeft: Spacing.lg,
        marginBottom: Spacing.sm,
    },
    loadingRow: {
        padding: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        marginLeft: Spacing.lg,
        alignItems: 'center',
    },
});
