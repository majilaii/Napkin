import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { HistogramBucket } from '@/hooks/users/useUserTaste';
import {
    fillHistogram,
    HISTOGRAM_BINS,
    ratingDistributionAccessibilityLabel,
} from './tasteUtils';

const BAR_HEIGHT = 30;
const MIN_BAR_HEIGHT = 3;

type Props = {
    topCuisines: string[];
    cityCount: number;
    countryCount: number;
    histogram: HistogramBucket[] | undefined;
    averageRating: number | null | undefined;
    isSelf: boolean;
    onPress?: () => void;
};

export function TasteSignature({
    topCuisines,
    cityCount,
    countryCount,
    histogram,
    averageRating,
    isSelf,
    onPress,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const counts = useMemo(() => fillHistogram(histogram), [histogram]);
    const total = useMemo(() => counts.reduce((sum, count) => sum + count, 0), [counts]);
    const max = Math.max(...counts, 1);
    const histogramAccessibilityLabel = useMemo(
        () => ratingDistributionAccessibilityLabel(counts),
        [counts],
    );
    const cuisineLine = topCuisines.slice(0, 3).join(' · ');
    const coverageLine = [
        cityCount > 0 ? `${cityCount} ${cityCount === 1 ? 'city' : 'cities'}` : null,
        countryCount > 1 ? `${countryCount} countries` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    const accessibilitySummary = [
        'Taste at a glance',
        cuisineLine || null,
        coverageLine || null,
        total >= 3
            ? `${averageRating != null ? averageRating.toFixed(1) : 'No average'}, ${total} ratings`
            : null,
        total >= 3 ? histogramAccessibilityLabel : null,
    ].filter(Boolean).join('. ');
    const canOpenDetails = !!onPress;

    if (!cuisineLine && !coverageLine && total < 3) return null;

    const body = (
        <View style={[styles.card, { backgroundColor: palette.surfaceJournalLow }]}>
            <View style={styles.topRow}>
                <View style={styles.identity}>
                    <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>Taste at a glance</Text>
                    {cuisineLine ? (
                        <Text style={[Type.editorialBody, styles.cuisines, { color: palette.text }]}>
                            {cuisineLine}
                        </Text>
                    ) : null}
                    {coverageLine ? (
                        <Text style={[Type.metadata, { color: palette.textMuted }]}>{coverageLine}</Text>
                    ) : null}
                </View>
                <View style={styles.trailing}>
                    {total >= 3 ? (
                        <View style={styles.averageCol}>
                            <Text style={[Type.rating, { color: palette.text }]}>
                                {averageRating != null ? averageRating.toFixed(1) : '—'}
                            </Text>
                            <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                {`${total} ratings`}
                            </Text>
                        </View>
                    ) : null}
                    {canOpenDetails ? (
                        <Ionicons
                            name="chevron-forward"
                            size={17}
                            color={palette.textMuted}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                        />
                    ) : null}
                </View>
            </View>

            {total >= 3 ? (
                <View
                    style={styles.histogram}
                    accessible={!canOpenDetails}
                    accessibilityLabel={canOpenDetails ? undefined : histogramAccessibilityLabel}
                    accessibilityElementsHidden={canOpenDetails}
                    importantForAccessibility={canOpenDetails ? 'no-hide-descendants' : 'auto'}
                >
                    <View style={[styles.baseline, { backgroundColor: palette.dividerSoft }]} />
                    {HISTOGRAM_BINS.map((bin, index) => {
                        const count = counts[index];
                        const height = count > 0
                            ? Math.max(MIN_BAR_HEIGHT, (count / max) * BAR_HEIGHT)
                            : MIN_BAR_HEIGHT;
                        return (
                            <View key={bin} style={styles.barColumn}>
                                <View
                                    style={[
                                        styles.bar,
                                        {
                                            height,
                                            backgroundColor: count > 0
                                                ? palette.tertiary
                                                : palette.surfaceJournalHi,
                                        },
                                    ]}
                                />
                            </View>
                        );
                    })}
                </View>
            ) : null}
        </View>
    );

    if (canOpenDetails) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [styles.wrapper, pressed ? styles.wrapperPressed : null]}
                accessibilityRole="button"
                accessibilityLabel={accessibilitySummary}
                accessibilityHint={isSelf
                    ? 'Opens your detailed taste breakdown'
                    : 'Opens this person’s detailed taste breakdown'}
            >
                {body}
            </Pressable>
        );
    }
    return <View style={styles.wrapper}>{body}</View>;
}

const styles = StyleSheet.create({
    wrapper: { marginTop: Spacing.md },
    wrapperPressed: { transform: [{ scale: 0.96 }] },
    card: {
        marginHorizontal: Spacing.lg,
        paddingHorizontal: 18,
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },
    topRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: Spacing.md,
    },
    identity: { flex: 1, minWidth: 0 },
    cuisines: { marginTop: Spacing.xs },
    trailing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    averageCol: { alignItems: 'flex-end' },
    histogram: {
        height: BAR_HEIGHT,
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 3,
    },
    baseline: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
    },
    barColumn: { flex: 1, justifyContent: 'flex-end' },
    bar: { width: '100%', borderRadius: 2 },
});
