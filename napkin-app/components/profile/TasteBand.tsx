/**
 * TasteBand — Beli-style taste summary, Heirloom voice (TICKET-092).
 * One inset panel: top cuisines as the serif content line, coverage counts as
 * the quiet meta line. Renders nothing until there's real taste data.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';

interface Props {
    topCuisines: string[];
    cityCount: number;
    countryCount: number;
    palette: typeof Colors.light;
    /**
     * TICKET-145: the Taste Relic epithet. When present (≥10 meals), it becomes
     * the serif content line IN PLACE OF the top-cuisines list; the coverage meta
     * line is unchanged. Null/absent (below floor, or a cold public cache) →
     * renders exactly as before.
     */
    epithet?: string | null;
    /**
     * TICKET-112: when provided (own profile, non-empty), the band becomes
     * pressable → the taste drill-in. Absent → a plain, non-interactive panel.
     */
    onPress?: () => void;
}

export function TasteBand({ topCuisines, cityCount, countryCount, palette, epithet, onPress }: Props) {
    if (topCuisines.length === 0 && cityCount === 0 && !epithet) return null;

    const coverage = [
        cityCount > 0 ? `${cityCount} ${cityCount === 1 ? 'city' : 'cities'}` : null,
        countryCount > 1 ? `${countryCount} countries` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    const body = (
        <>
            <View style={styles.headerRow}>
                <Text style={[styles.kicker, { color: palette.textMuted }]}>TASTE</Text>
                {onPress ? (
                    <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
                ) : null}
            </View>
            {epithet ? (
                // The relic — an engraved title, not a data readout.
                <Text style={[styles.cuisines, { color: palette.text }]} numberOfLines={2}>
                    {epithet}
                </Text>
            ) : topCuisines.length > 0 ? (
                <Text style={[styles.cuisines, { color: palette.text }]} numberOfLines={1}>
                    {topCuisines.join(' · ')}
                </Text>
            ) : null}
            {coverage ? (
                <Text style={[styles.coverage, { color: palette.textMuted }]}>{coverage}</Text>
            ) : null}
        </>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel="view your taste breakdown"
                style={({ pressed }) => [
                    styles.panel,
                    { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.85 : 1 },
                ]}
            >
                {body}
            </Pressable>
        );
    }

    return (
        <View style={[styles.panel, { backgroundColor: palette.surfaceJournalLow }]}>
            {body}
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
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
