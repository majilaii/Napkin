/**
 * WishlistListCardFull — a list as a full-width card in the Wishlist › Lists tab.
 *
 * Heirloom card (warm-white note, ambient shadow): italic-serif title + a
 * terracotta "{n} spots" eyebrow, an optional description line, and a quiet
 * "Updated {ago}" footer. Consumes MyList directly (buildListsSectionRows drops
 * description/updated_at).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius, Shadow } from '@/constants/theme';
import type { MyList } from '@/hooks/lists/useMyLists';

interface Props {
    list: MyList;
    palette: typeof Colors.light;
    onPress: () => void;
}

/** "today" | "yesterday" | "Nd ago" | "Nw ago" | "Mon YYYY" (mirrors ListCard). */
function formatUpdated(iso: string): string {
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function WishlistListCardFull({ list, palette, onPress }: Props) {
    const count = list.entry_count;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                Shadow.note,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityLabel={`Open list ${list.title}`}
        >
            <View style={styles.titleRow}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    {list.emoji ? `${list.emoji} ` : ''}{list.title}
                </Text>
                <Text style={[styles.count, { color: palette.primary }]}>
                    {`${count} ${count === 1 ? 'spot' : 'spots'}`}
                </Text>
            </View>

            {list.description ? (
                <Text style={[styles.note, { color: palette.textSecondary }]} numberOfLines={2}>
                    {list.description}
                </Text>
            ) : null}

            <Text style={[styles.updated, { color: palette.textMuted }]}>
                {`Updated ${formatUpdated(list.updated_at)}`}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.lg + 2,
        paddingTop: 18,
        paddingHorizontal: 18,
        paddingBottom: 16,
        marginBottom: 14,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
    },
    title: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        letterSpacing: -0.3,
    },
    count: {
        flexShrink: 0,
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    note: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13.5,
        lineHeight: 19,
        marginTop: 7,
    },
    updated: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        marginTop: 12,
    },
});
