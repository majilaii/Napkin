/**
 * MemberStatsStrip — three stat tiles: avg rating, entry count, round count.
 * Uses the same breakdown-cell pattern as entry-detail/table-night-detail.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MemberStats } from '@/hooks/members/useMemberProfile';

interface MemberStatsStripProps {
    stats: MemberStats;
}

export function MemberStatsStrip({ stats }: MemberStatsStripProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const tiles = [
        {
            value: stats.avg != null ? stats.avg.toFixed(1) : '—',
            label: 'Avg Rating',
            isRating: true,
        },
        {
            value: String(stats.entry_count),
            label: stats.entry_count === 1 ? 'Entry' : 'Entries',
            isRating: false,
        },
        {
            value: String(stats.round_count),
            label: stats.round_count === 1 ? 'Round' : 'Rounds',
            isRating: false,
        },
    ];

    return (
        <View style={styles.row}>
            {tiles.map(({ value, label, isRating }) => (
                <View
                    key={label}
                    style={[
                        styles.cell,
                        { backgroundColor: palette.surfaceContainerLow },
                    ]}
                >
                    <Text
                        style={[
                            isRating ? Type.rating : Type.headlineMedium,
                            {
                                color: isRating ? palette.tertiary : palette.text,
                                fontSize: isRating ? 22 : 20,
                            },
                        ]}
                    >
                        {value}
                    </Text>
                    <Text
                        style={[
                            Type.labelSmall,
                            { color: palette.textMuted, marginTop: Spacing.xs },
                        ]}
                    >
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
