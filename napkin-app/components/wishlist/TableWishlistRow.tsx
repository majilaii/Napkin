/**
 * TableWishlistRow — one restaurant in the Table wishlist, as a typographic
 * ledger row (Heirloom redesign).
 *
 * Mirrors WishlistSpotRow: italic-serif index · italic-serif name · quiet meta
 * (cuisine · city). NO photo thumbnail, NO description block — restaurants carry
 * no reliable photo/description source.
 *
 * The Table-specific signal is the *overlap count* — "N of you" — which is the
 * whole point of the Table wishlist (emergent ranking by how many members saved
 * it). It takes the right column, where the personal row puts its rating numeral,
 * because it IS the ranking signal here.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';

interface Props {
    /** 1-based ledger ordinal. */
    index: number;
    item: TableWishlistItem;
    palette: typeof Colors.light;
    onPress: () => void;
}

export function TableWishlistRow({ index, item, palette, onPress }: Props) {
    const r = item.restaurant;
    if (!r) return null;

    const meta = [r.cuisine, r.city].filter(Boolean).join(' · ');
    const count = item.count;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityLabel={`Open ${r.name} — ${count} of you saved this`}
        >
            <Text style={[styles.num, { color: palette.textMuted }]}>{index}</Text>

            <View style={styles.textBlock}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {r.name}
                </Text>
                {meta ? (
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>

            <View style={styles.rightCol}>
                <View style={[styles.overlapChip, { backgroundColor: palette.tertiaryFixed }]}>
                    <Text style={[styles.overlapCount, { color: palette.tertiary }]}>{count}</Text>
                    <Text style={[styles.overlapLabel, { color: palette.tertiary }]}>
                        {count === 1 ? 'saved' : 'of you'}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        paddingVertical: 17,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    num: {
        width: 24,
        textAlign: 'center',
        paddingTop: 2,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 19,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        letterSpacing: -0.3,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        marginTop: 4,
    },
    rightCol: {
        alignItems: 'flex-end',
        flexShrink: 0,
        paddingTop: 2,
    },
    overlapChip: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    overlapCount: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 20,
    },
    overlapLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
});
