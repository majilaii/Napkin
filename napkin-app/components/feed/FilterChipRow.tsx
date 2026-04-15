/**
 * FilterChipRow — horizontally scrollable row of single-select filter chips.
 * Terracotta fill for active, surfaceContainerHigh fill for inactive.
 * Uses Type.caption (Manrope 500 12px) for labels.
 * Display names are truncated to 10 characters with ellipsis.
 */

import React from 'react';
import { FlatList, Pressable, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';

type Palette = typeof Colors.light;

export interface FilterChip {
    key: string;
    label: string;
}

interface FilterChipRowProps {
    chips: FilterChip[];
    activeKey: string | null;
    onSelect: (key: string | null) => void;
    palette: Palette;
}

const MAX_LABEL_LENGTH = 10;

function truncate(text: string): string {
    if (text.length <= MAX_LABEL_LENGTH) return text;
    return text.slice(0, MAX_LABEL_LENGTH) + '…';
}

export function FilterChipRow({
    chips,
    activeKey,
    onSelect,
    palette,
}: FilterChipRowProps) {
    return (
        <FlatList
            horizontal
            data={chips}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.container}
            renderItem={({ item }) => {
                const isActive = item.key === activeKey;
                return (
                    <Pressable
                        onPress={() => onSelect(isActive ? null : item.key)}
                        style={[
                            styles.chip,
                            {
                                backgroundColor: isActive
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                    >
                        <Text
                            style={[
                                Type.caption,
                                {
                                    color: isActive
                                        ? '#ffffff'
                                        : palette.textSecondary,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {truncate(item.label)}
                        </Text>
                    </Pressable>
                );
            }}
        />
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
    },
    chip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        borderRadius: Radius.full,
    },
});
