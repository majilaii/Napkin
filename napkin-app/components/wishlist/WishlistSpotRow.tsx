/**
 * WishlistSpotRow — one saved spot in the Pinned list (Heirloom redesign).
 *
 * A numbered, name-forward ledger row (no thumbnails): italic-serif index ·
 * italic-serif name · quiet meta (cuisine · city · price · provenance), with an
 * amber rating numeral and an optional distance in the right column.
 *
 * Honest data: `rating` is Google's `google_rating` (the wishlist payload carries
 * no Napkin/Table rating for unvisited places); open-now is omitted (no persisted
 * hours client-side); distance is miles (no walk-time source).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { priceTierLabel } from '@/lib/priceLevel';
import type { PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import type { WishlistSourceHandoff } from '@/lib/types/wishlistSource';

/** Tappable origin of a save: the TikTok you saved it from (or maps/web link). */
function sourceLink(
    source: PersonalWishlistItem['source'],
): { url: string; icon: keyof typeof Ionicons.glyphMap; label: string } | null {
    if (!source) return null;
    if (source.type === 'tiktok' && source.url) {
        return { url: source.url, icon: 'logo-tiktok', label: 'open the TikTok this came from' };
    }
    if (source.type === 'web' && source.url) {
        return { url: source.url, icon: 'link-outline', label: 'open the page this came from' };
    }
    return null;
}

interface Props {
    /** 1-based ledger ordinal. */
    index: number;
    item: PersonalWishlistItem;
    /** "0.3 mi" when coordinates are available; null otherwise. */
    distanceLabel?: string | null;
    palette: typeof Colors.light;
    onPress: () => void;
}

export function WishlistSpotRow({ index, item, distanceLabel, palette, onPress }: Props) {
    const r = item.restaurant;
    if (!r) return null;

    const price = priceTierLabel(r.price_level);
    const provenance =
        item.source?.type === 'handoff'
            ? `via ${(item.source as WishlistSourceHandoff).sharer_name}'s napkin`
            : null;
    const meta = [r.cuisine, r.city, price || null, provenance].filter(Boolean).join(' · ');
    const rating = r.google_rating != null ? r.google_rating.toFixed(1) : null;
    const link = sourceLink(item.source);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityLabel={`Open ${r.name}`}
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

            {link ? (
                <Pressable
                    onPress={() => Linking.openURL(link.url).catch(() => {})}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={link.label}
                    style={({ pressed }) => [
                        styles.sourceBtn,
                        { backgroundColor: palette.surfaceJournalHi, opacity: pressed ? 0.6 : 1 },
                    ]}
                >
                    <Ionicons name={link.icon} size={15} color={palette.textSecondary} />
                </Pressable>
            ) : null}

            {rating || distanceLabel ? (
                <View style={styles.rightCol}>
                    {rating ? (
                        <Text style={[styles.rating, { color: palette.amberBright }]}>{rating}</Text>
                    ) : null}
                    {distanceLabel ? (
                        <Text style={[styles.distance, { color: palette.textMuted }]}>
                            {distanceLabel}
                        </Text>
                    ) : null}
                </View>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    num: {
        width: 20,
        textAlign: 'center',
        paddingTop: 2,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        letterSpacing: -0.3,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
    rightCol: {
        alignItems: 'flex-end',
        flexShrink: 0,
    },
    sourceBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        flexShrink: 0,
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 20,
    },
    distance: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        marginTop: 3,
    },
});
