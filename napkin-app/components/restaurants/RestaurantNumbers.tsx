/**
 * RestaurantNumbers — tiered numbers band for the restaurant page.
 *
 * Layout:
 *   Big personal row:  "You · 4.5 · 8 visits"
 *   Small chips row:   [Table chip]  [Google chip]
 *
 * Each element is hidden per the acceptance rules:
 *   - Personal: hidden when visit_count === 0
 *   - Table chip: hidden when table_chip is null
 *   - Google chip: hidden when google_rating is null
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type {
    RestaurantPageData,
    RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';

type Palette = typeof Colors.light;

interface Props {
    personal: RestaurantPageData['personal'];
    tableChip: RestaurantPageData['table_chip'];
    googleRating: RestaurantPageRestaurant['google_rating'];
    googleRatingCount: RestaurantPageRestaurant['google_rating_count'];
}

export function RestaurantNumbers({
    personal,
    tableChip,
    googleRating,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const showPersonal = personal.visit_count > 0 && personal.average != null;
    const showChipRow = tableChip != null || googleRating != null;

    if (!showPersonal && !showChipRow) return null;

    return (
        <View style={styles.container}>
            {/* Primary personal row */}
            {showPersonal && (
                <View style={styles.personalRow}>
                    <Text
                        style={[
                            Type.ratingLarge,
                            { color: palette.tertiary, fontSize: 40, lineHeight: 46 },
                        ]}
                    >
                        {personal.average!.toFixed(1)}
                    </Text>
                    <View style={styles.personalMeta}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            You
                        </Text>
                        <Text
                            style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}
                        >
                            {personal.visit_count === 1
                                ? '1 visit'
                                : `${personal.visit_count} visits`}
                        </Text>
                    </View>
                </View>
            )}

            {/* Secondary chips row */}
            {showChipRow && (
                <View style={styles.chipsRow}>
                    {tableChip != null && (
                        <View
                            style={[
                                styles.chip,
                                { backgroundColor: palette.surfaceContainerHigh },
                            ]}
                        >
                            <Text
                                style={[Type.titleSmall, { color: palette.text }]}
                                numberOfLines={1}
                            >
                                {tableChip.average.toFixed(1)}
                            </Text>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, marginTop: 1 },
                                ]}
                                numberOfLines={1}
                            >
                                {tableChip.table_name} ·{' '}
                                {tableChip.visit_count === 1
                                    ? '1 visit'
                                    : `${tableChip.visit_count} visits`}
                            </Text>
                        </View>
                    )}
                    {googleRating != null && (
                        <View
                            style={[
                                styles.chip,
                                { backgroundColor: palette.surfaceContainerHigh },
                            ]}
                        >
                            <Text style={[Type.titleSmall, { color: palette.text }]}>
                                {googleRating.toFixed(1)}
                            </Text>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, marginTop: 1 },
                                ]}
                            >
                                Google
                            </Text>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        gap: Spacing.md,
    },
    personalRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.sm,
    },
    personalMeta: {
        paddingBottom: 6,
    },
    chipsRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        flexWrap: 'wrap',
    },
    chip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.lg,
        minWidth: 90,
    },
});
