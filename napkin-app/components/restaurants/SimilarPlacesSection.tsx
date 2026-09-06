/**
 * SimilarPlacesSection — horizontal carousel of same-city neighbours, and the
 * last section on the restaurant page. Each card is a photo thumbnail over the
 * restaurant's plate tint, its name, and `cuisine · distance`.
 *
 * Photos pass through `resolveSourcedPhoto`, so a Places image whose stored
 * attribution will not parse fails closed to the tint plate instead of
 * rendering uncredited; the surviving authors are named once under the strip
 * rather than on every card. Renders nothing when there is nothing to show.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import type { SimilarRestaurant } from '@/hooks/restaurants/useSimilarRestaurants';
import { dedupePlacesCredits, resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { tintIndex6 } from '@/lib/engraving';
import { SectionHeading } from './RestaurantPageV3';

type Palette = typeof Colors.light;

/** `0.3 km` under 10 km (floored at 0.1 so a next-door row never reads 0.0), `12 km` beyond. */
export function formatDistance(distanceM: number): string {
    const km = Math.max(0, distanceM) / 1000;
    return km < 10 ? `${Math.max(0.1, km).toFixed(1)} km` : `${Math.round(km)} km`;
}

/** `NEARBY` when nothing matched on cuisine or type, else `SIMILAR PLACES`. */
export function similarKicker(rows: readonly SimilarRestaurant[]): string {
    return rows.length > 0 && rows.every((row) => row.match === 'nearby')
        ? 'NEARBY'
        : 'SIMILAR PLACES';
}

function rowMeta(row: SimilarRestaurant): string {
    const distance = formatDistance(row.distance_m);
    const cuisine = row.cuisine?.trim().toLowerCase();
    return cuisine ? `${cuisine} · ${distance}` : distance;
}

export function SimilarPlacesSection({
    rows,
    onPress,
    palette,
}: {
    rows: readonly SimilarRestaurant[];
    onPress: (restaurantId: string) => void;
    palette: Palette;
}) {
    const photos = useMemo(
        () => rows.map((row) => resolveSourcedPhoto({
            url: row.photo_url,
            photoSource: row.photo_source,
            attributionHtml: row.places_photo_attribution_html,
            restaurantName: row.name,
        })),
        [rows],
    );
    // A credit that only repeats the restaurant's own name says nothing.
    const credits = useMemo(
        () => dedupePlacesCredits(photos.map((photo) => photo.credit))
            .filter((credit) => !credit.redundant),
        [photos],
    );

    if (rows.length === 0) return null;

    const plateTints = [
        palette.plateAmber,
        palette.plateOlive,
        palette.plateRose,
        palette.plateGrey,
        palette.plateSlate,
        palette.plateSand,
    ];

    return (
        <View style={styles.section}>
            <View style={styles.heading}>
                <SectionHeading label={similarKicker(rows)} palette={palette} />
            </View>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.track}
                testID="similar-places-carousel"
            >
                {rows.map((row, index) => {
                    const photo = photos[index];
                    return (
                        <Pressable
                            key={row.id}
                            onPress={() => onPress(row.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.name}, ${rowMeta(row)}`}
                            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                        >
                            <View
                                style={[
                                    styles.thumb,
                                    {
                                        backgroundColor: plateTints[tintIndex6(row.id)],
                                        borderColor: palette.imageOutline,
                                    },
                                ]}
                            >
                                {photo.url ? (
                                    <Image
                                        testID={`similar-photo-${index}`}
                                        source={{ uri: photo.url }}
                                        style={StyleSheet.absoluteFillObject}
                                        contentFit="cover"
                                        transition={200}
                                        accessible={false}
                                    />
                                ) : (
                                    <Ionicons
                                        name="restaurant-outline"
                                        size={IconSize.lg}
                                        color={palette.primary}
                                    />
                                )}
                            </View>
                            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                {row.name}
                            </Text>
                            <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                                {rowMeta(row)}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            {credits.length > 0 ? (
                <Text
                    style={[Type.metadata, styles.credit, { color: palette.textFaint }]}
                    numberOfLines={2}
                >
                    {`photos via ${credits.map((credit) => credit.label).join(' · ')}`}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    section: { marginTop: Spacing.restaurant.sectionGap },
    heading: { paddingHorizontal: Spacing.restaurant.pageGutter },
    track: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        gap: Spacing.sm,
    },
    card: {
        width: Spacing.restaurant.similarCardWidth,
        gap: Spacing.restaurant.compactGap,
    },
    thumb: {
        height: Spacing.restaurant.similarPhotoHeight,
        borderRadius: Radius.memory,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    name: Type.restaurantListTitle,
    credit: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.sm,
    },
    pressed: { opacity: 0.8 },
});
