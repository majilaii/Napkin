/**
 * FoundedHero — "Founded today" centered block for brand-new named tables.
 *
 * Shown when activeTable is non-personal and items.length === 0.
 * Canvas: WF3 "Founded, just you" — centered date + invitation text.
 * Purely presentational.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';

type Palette = typeof Colors.light;

interface FoundedHeroProps {
    tableName: string;
    foundedAt: string;
    palette: Palette;
}

function formatFoundedDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

export function FoundedHero({ tableName, foundedAt, palette }: FoundedHeroProps) {
    const dateLabel = formatFoundedDate(foundedAt);

    return (
        <View style={styles.container}>
            {/* Rule */}
            <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />

            {/* Date kicker — terracotta (ceremonial) */}
            <Text style={[styles.kicker, { color: palette.primary }]}>
                {`Founded ${dateLabel} \u00B7 by you`}
            </Text>

            {/* Table name */}
            <Text style={[styles.tableName, { color: palette.text }]} numberOfLines={2}>
                {tableName}
            </Text>

            {/* Invitation copy */}
            <Text style={[Type.bodySmall, styles.body, { color: palette.textSecondary }]}>
                The table is set. Log a meal or start a Round to begin your shared history.
            </Text>

            {/* Rule */}
            <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.xxl,
        gap: Spacing.sm,
    },
    rule: {
        width: 40,
        height: 1,
        marginBottom: Spacing.sm,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 34,
        textAlign: 'center',
        marginTop: Spacing.xs,
    },
    body: {
        textAlign: 'center',
        marginTop: Spacing.sm,
        fontStyle: 'italic',
        lineHeight: 20,
    },
});
