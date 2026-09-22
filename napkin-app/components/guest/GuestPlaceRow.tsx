/**
 * GuestPlaceRow: one catalogue row on the guest Places screen (TICKET-247).
 * Credited Places thumbnail when there is one, otherwise a typographic plate.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import type { GuestRestaurantRow } from '@/hooks/guest/usePublicBrowse';

type Palette = typeof Colors.light;

export function GuestPlaceRow({
    row,
    onPress,
    palette,
}: {
    row: GuestRestaurantRow;
    onPress: () => void;
    palette: Palette;
}) {
    const photo = resolveSourcedPhoto({
        url: row.photo_url,
        photoSource: row.photo_source,
        attributionHtml: row.places_photo_attribution_html,
        restaurantName: row.name,
    });
    const showPhoto = !!photo.url && photo.isPlaces && !!photo.credit;
    const meta = [row.cuisine, row.city].filter(Boolean).join(' · ');
    const reviews = row.review_count > 0
        ? `${row.review_count} ${row.review_count === 1 ? 'review' : 'reviews'}`
        : null;
    const label = [row.name, meta, reviews].filter(Boolean).join(', ');

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            {showPhoto ? (
                <Image
                    source={{ uri: photo.url! }}
                    style={styles.thumb}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                />
            ) : (
                <View style={[styles.thumb, styles.plate, { backgroundColor: palette.plateSand }]}>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                        {row.name.trim().charAt(0).toUpperCase()}
                    </Text>
                </View>
            )}
            <View style={styles.copy}>
                <Text numberOfLines={1} style={[Type.titleSmall, { color: palette.text }]}>
                    {row.name}
                </Text>
                {meta ? (
                    <Text numberOfLines={1} style={[Type.metadata, { color: palette.textMuted }]}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            <View style={styles.right}>
                {row.google_rating != null ? (
                    <View style={styles.ratingLine}>
                        <Text style={[Type.feedLedgerRating, { color: palette.tertiary }]}>
                            {row.google_rating.toFixed(1)}
                        </Text>
                        <Text style={[Type.metadata, { color: palette.textMuted }]}> · google</Text>
                    </View>
                ) : null}
                {reviews ? (
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>{reviews}</Text>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingVertical: Spacing.xs,
    },
    pressed: { opacity: 0.8 },
    thumb: {
        width: 44,
        height: 44,
        borderRadius: Radius.md,
    },
    plate: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    copy: { flex: 1, gap: 2 },
    right: { alignItems: 'flex-end', gap: 2 },
    ratingLine: { flexDirection: 'row', alignItems: 'baseline' },
});
