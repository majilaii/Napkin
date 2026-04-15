/**
 * ActiveRoundsShelf — pinned shelf above the date-grouped feed.
 * Shows "IN PROGRESS" label (Type.label) + TableNightCard for each active round.
 * Renders null when items array is empty.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { type TableNightActivity } from '@/hooks/tables/useTableActivity';
import { TableNightCard } from './TableNightCard';

type Palette = typeof Colors.light;

interface ActiveRoundsShelfProps {
    items: TableNightActivity[];
    palette: Palette;
}

export function ActiveRoundsShelf({ items, palette }: ActiveRoundsShelfProps) {
    if (items.length === 0) return null;

    return (
        <View style={styles.shelf}>
            <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.sm }]}>
                IN PROGRESS
            </Text>
            <View style={styles.cards}>
                {items.map((item) => (
                    <TableNightCard key={`active-${item.id}`} item={item} palette={palette} />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    shelf: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    cards: {
        gap: Spacing.md,
    },
});
