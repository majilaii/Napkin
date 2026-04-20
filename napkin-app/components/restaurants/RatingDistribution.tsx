/**
 * RatingDistribution — small Letterboxd-style histogram of rating buckets.
 *
 * Buckets the ratings client-side into 10 half-star bins (0.5 → 5.0).
 * Non-interactive in v1.
 * Caller renders this only when ratings.length >= 3.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

const BINS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
const BAR_MAX_HEIGHT = 36;

interface Props {
    ratings: number[];
}

export function RatingDistribution({ ratings }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const counts = useMemo(() => {
        const buckets = new Array(BINS.length).fill(0);
        for (const r of ratings) {
            // Round to nearest 0.5 and clamp
            const snapped = Math.round(r * 2) / 2;
            const idx = BINS.indexOf(snapped);
            if (idx !== -1) buckets[idx]++;
        }
        return buckets as number[];
    }, [ratings]);

    const maxCount = Math.max(...counts, 1);

    return (
        <View style={styles.container}>
            <Text
                style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}
            >
                Rating distribution
            </Text>
            <View style={styles.histogram}>
                {BINS.map((bin, i) => {
                    const barHeight = Math.max(3, (counts[i] / maxCount) * BAR_MAX_HEIGHT);
                    return (
                        <View key={bin} style={styles.barColumn}>
                            <View style={[styles.barWrapper, { height: BAR_MAX_HEIGHT }]}>
                                <View
                                    style={[
                                        styles.bar,
                                        {
                                            height: barHeight,
                                            backgroundColor:
                                                counts[i] > 0
                                                    ? palette.tertiary
                                                    : palette.surfaceContainerHigh,
                                        },
                                    ]}
                                />
                            </View>
                            {/* Label every other bin to avoid crowding */}
                            {i % 2 === 1 ? (
                                <Text
                                    style={[
                                        Type.labelSmall,
                                        {
                                            color: palette.textMuted,
                                            marginTop: 2,
                                            fontSize: 8,
                                        },
                                    ]}
                                >
                                    {bin.toFixed(0)}
                                </Text>
                            ) : (
                                <View style={{ height: 12 }} />
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    histogram: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 3,
    },
    barColumn: {
        flex: 1,
        alignItems: 'center',
    },
    barWrapper: {
        justifyContent: 'flex-end',
        width: '100%',
    },
    bar: {
        width: '100%',
        borderRadius: Radius.sm,
    },
});
