/**
 * PalateStatsStrip — three stat tiles: total logs, total restaurants, avg rating.
 * Mirrors MemberStatsStrip but uses cross-table palate stats (no Rounds tile).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { UserStats } from '@/hooks/users/useUserProfile';

interface Props {
    stats: UserStats;
}

export function PalateStatsStrip({ stats }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const avgDisplay =
        stats.average_rating != null ? stats.average_rating.toFixed(1) : '—';

    const tiles = [
        { value: String(stats.total_logs), label: stats.total_logs === 1 ? 'Log' : 'Logs', isRating: false },
        { value: String(stats.total_restaurants), label: stats.total_restaurants === 1 ? 'Restaurant' : 'Restaurants', isRating: false },
        { value: avgDisplay, label: 'Avg Rating', isRating: true },
    ];

    return (
        <View style={styles.row}>
            {tiles.map(({ value, label, isRating }) => (
                <View
                    key={label}
                    style={[styles.cell, { backgroundColor: palette.surfaceContainerLow }]}
                >
                    <Text
                        style={[
                            isRating ? Type.rating : Type.headlineMedium,
                            { color: isRating ? palette.tertiary : palette.text, fontSize: isRating ? 22 : 20 },
                        ]}
                    >
                        {value}
                    </Text>
                    <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                        {label}
                    </Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    cell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },
});
