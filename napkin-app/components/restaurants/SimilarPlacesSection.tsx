/**
 * SimilarPlacesSection — quiet ledger of same-city neighbours on the
 * restaurant page. Kicker + 44–48pt rows on soft hairlines; no cards, no
 * photos. Renders nothing when there is nothing to show.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import type { SimilarRestaurant } from '@/hooks/restaurants/useSimilarRestaurants';
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
    if (rows.length === 0) return null;
    return (
        <View style={styles.section}>
            <SectionHeading label={similarKicker(rows)} palette={palette} />
            {rows.map((row, index) => {
                const meta = rowMeta(row);
                return (
                    <React.Fragment key={row.id}>
                        <Pressable
                            onPress={() => onPress(row.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.name}, ${meta}`}
                            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                        >
                            <View style={styles.rowText}>
                                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                    {row.name}
                                </Text>
                                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                                    {meta}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={IconSize.sm} color={palette.textFaint} />
                        </Pressable>
                        {index < rows.length - 1 ? (
                            <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                        ) : null}
                    </React.Fragment>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.sectionGap,
    },
    row: {
        minHeight: Spacing.restaurant.quietActionHeight,
        paddingVertical: Spacing.xs,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    rowText: { flex: 1, gap: Spacing.restaurant.compactGap },
    name: Type.restaurantListTitle,
    divider: { height: StyleSheet.hairlineWidth },
    pressed: { opacity: 0.8 },
});
