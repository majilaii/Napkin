/**
 * TasteBand — Beli-style taste summary, Heirloom voice (TICKET-092).
 * One clearly titled section: upright editorial summary in an inset panel,
 * followed by readable coverage metadata.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { SectionHeader } from './SectionHeader';

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
    const summary = epithet || topCuisines.join(' · ');

    const body = (
        <>
            <View style={styles.summaryRow}>
                {summary ? (
                    <Text style={[styles.cuisines, { color: palette.text }]}>
                        {summary}
                    </Text>
                ) : null}
                {onPress ? (
                    <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                ) : null}
            </View>
            {coverage ? (
                <Text style={[styles.coverage, { color: palette.textMuted }]}>{coverage}</Text>
            ) : null}
        </>
    );

    if (onPress) {
        return (
            <View>
                <SectionHeader title="Taste" />
                <Pressable
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel="View your taste breakdown"
                    style={({ pressed }) => [
                        styles.panel,
                        { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.85 : 1 },
                    ]}
                >
                    {body}
                </Pressable>
            </View>
        );
    }

    return (
        <View>
            <SectionHeader title="Taste" />
            <View style={[styles.panel, { backgroundColor: palette.surfaceJournalLow }]}>
                {body}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    panel: {
        marginHorizontal: Spacing.lg,
        borderRadius: 14,
        paddingHorizontal: Spacing.md + 2,
        paddingVertical: Spacing.md,
        gap: 6,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    cuisines: {
        ...Type.editorialBody,
        flex: 1,
    },
    coverage: {
        ...Type.metadata,
    },
});
