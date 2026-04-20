/**
 * TableRatingBlock — V1 Dossier headline fact for the Our Table tab.
 *
 * Layout:
 *   UPPERCASE subtitle    "<Table> · N have been"   (or "You · N visits")
 *   44px italic serif average   "/ 5"          [flex]        [InlineStars]
 *   5-bin distribution (5 / 4½ / 4 / 3½ / 3)   with labels below
 *
 * The block is hidden entirely when we have no rating to show (no visits).
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InlineStars } from '@/components/feed/InlineStars';
import type { RestaurantPageData } from '@/hooks/restaurants/useRestaurantPage';

type Palette = typeof Colors.light;

// Bins descending — matches canvas: 5, 4½, 4, 3½, 3
const BINS = [5, 4.5, 4, 3.5, 3] as const;
const BIN_LABELS = ['5', '4½', '4', '3½', '3'];
const BAR_MAX_HEIGHT = 28;

interface Props {
    personal: RestaurantPageData['personal'];
    tableChip: RestaurantPageData['table_chip'];
    whosBeenCount: number;
    ratings: number[];
}

export function TableRatingBlock({
    personal,
    tableChip,
    whosBeenCount,
    ratings,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const headlineAverage =
        tableChip?.average ?? personal.average ?? null;
    const subtitle = useMemo(() => {
        if (tableChip) {
            const whoCount = Math.max(whosBeenCount, 1);
            return `${tableChip.table_name} · ${whoCount} ${whoCount === 1 ? 'has' : 'have'} been`;
        }
        if (personal.visit_count > 0) {
            return `You · ${personal.visit_count === 1 ? '1 visit' : `${personal.visit_count} visits`}`;
        }
        return null;
    }, [tableChip, personal.visit_count, whosBeenCount]);

    const counts = useMemo(() => {
        const out = new Array(BINS.length).fill(0);
        for (const r of ratings) {
            const snapped = Math.round(r * 2) / 2;
            // Ratings below 3 still land in the "3" bin (lowest visible)
            const clamped = Math.max(3, Math.min(5, snapped));
            const idx = BINS.indexOf(clamped as (typeof BINS)[number]);
            if (idx !== -1) out[idx]++;
        }
        return out as number[];
    }, [ratings]);

    const maxCount = Math.max(...counts, 1);
    const hasDistribution = ratings.length >= 3;

    if (headlineAverage == null && !subtitle) return null;

    return (
        <View style={styles.container}>
            {subtitle ? (
                <Text
                    style={[
                        styles.subtitle,
                        { color: palette.textMuted },
                    ]}
                    numberOfLines={1}
                >
                    {subtitle}
                </Text>
            ) : null}

            {headlineAverage != null ? (
                <View style={styles.ratingRow}>
                    <Text
                        style={[
                            Type.ratingLarge,
                            {
                                fontSize: 44,
                                lineHeight: 44,
                                color: palette.text,
                            },
                        ]}
                    >
                        {headlineAverage.toFixed(1)}
                    </Text>
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular',
                            fontSize: 16,
                            color: palette.textMuted,
                            marginLeft: 4,
                            marginBottom: 4,
                        }}
                    >
                        / 5
                    </Text>
                    <View style={{ flex: 1 }} />
                    <View style={{ paddingBottom: 4 }}>
                        <InlineStars value={headlineAverage} size={15} color={palette.star} />
                    </View>
                </View>
            ) : null}

            {hasDistribution ? (
                <View style={{ marginTop: 10 }}>
                    <View style={styles.histogram}>
                        {BINS.map((bin, i) => {
                            const pct = counts[i] / maxCount;
                            const height = pct > 0 ? Math.max(3, BAR_MAX_HEIGHT * pct) : 3;
                            return (
                                <View key={bin} style={styles.barColumn}>
                                    <View
                                        style={{
                                            width: '100%',
                                            height,
                                            borderRadius: 2,
                                            backgroundColor:
                                                counts[i] > 0
                                                    ? palette.star
                                                    : 'rgba(28,28,25,0.08)',
                                        }}
                                    />
                                </View>
                            );
                        })}
                    </View>
                    <View style={styles.labelRow}>
                        {BIN_LABELS.map((l, i) => (
                            <Text
                                key={l + i}
                                style={{
                                    flex: 1,
                                    textAlign: 'center',
                                    fontFamily: 'Manrope_500Medium',
                                    fontSize: 9,
                                    color: palette.textMuted,
                                    letterSpacing: 0.5,
                                }}
                            >
                                {l}
                            </Text>
                        ))}
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: Spacing.lg,
    },
    subtitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    histogram: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 2,
        height: BAR_MAX_HEIGHT,
    },
    barColumn: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    labelRow: {
        flexDirection: 'row',
        marginTop: 4,
    },
});
