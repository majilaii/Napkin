/**
 * TasteBand — Beli-style taste summary, Heirloom voice (TICKET-092).
 * One inset panel: top cuisines as the serif content line, coverage counts as
 * the quiet meta line. Renders nothing until there's real taste data.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

interface Props {
    topCuisines: string[];
    cityCount: number;
    countryCount: number;
    palette: typeof Colors.light;
}

export function TasteBand({ topCuisines, cityCount, countryCount, palette }: Props) {
    if (topCuisines.length === 0 && cityCount === 0) return null;

    const coverage = [
        cityCount > 0 ? `${cityCount} ${cityCount === 1 ? 'city' : 'cities'}` : null,
        countryCount > 1 ? `${countryCount} countries` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <View style={[styles.panel, { backgroundColor: palette.surfaceJournalLow }]}>
            <Text style={[styles.kicker, { color: palette.textMuted }]}>TASTE</Text>
            {topCuisines.length > 0 ? (
                <Text style={[styles.cuisines, { color: palette.text }]} numberOfLines={1}>
                    {topCuisines.join(' · ')}
                </Text>
            ) : null}
            {coverage ? (
                <Text style={[styles.coverage, { color: palette.textMuted }]}>{coverage}</Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    panel: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.md,
        borderRadius: 14,
        paddingHorizontal: Spacing.md + 2,
        paddingVertical: Spacing.md,
        gap: 3,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
    },
    cuisines: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 21,
    },
    coverage: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11.5,
    },
});
