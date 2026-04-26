/**
 * ChipRow — horizontal scrollable row of action chips below the writing surface.
 * Chips: photos · dish · with… · today · tables…
 *
 * Each chip is a Pressable that fires the corresponding onPress callback.
 * Uses ghosted warm-rule pill styling (no solid fill, borderColor = divider).
 * "active" chips (have data) get a soft terracotta tint per wireframe.
 */
import React from 'react';
import { ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DateChip } from './DateChip';

interface ChipRowProps {
    photoCount: number;
    onPhotosPress: () => void;
    dishValue: string;
    onDishPress: () => void;
    companionCount: number;
    onCompanionsPress: () => void;
    visitedAt: Date;
    onDateChange: (date: Date) => void;
    /**
     * Selected table name to show on the chip ("Sunday Roast"); null/undefined
     * means no table selected (chip reads "tables…").
     * Only render the chip when the user is in ≥1 Table — caller controls
     * via `tablesAvailable`.
     */
    tablesAvailable: boolean;
    selectedTableName: string | null;
    onTablesPress: () => void;
}

interface ChipProps {
    icon: string;
    label: string;
    active?: boolean;
    onPress: () => void;
    palette: typeof Colors.light;
}

function ActionChip({ icon, label, active, onPress, palette }: ChipProps) {
    const borderColor = active
        ? 'rgba(160,63,40,0.3)'
        : palette.divider;
    const bgColor = active
        ? 'rgba(160,63,40,0.06)'
        : 'transparent';
    const textColor = active ? palette.primary : palette.textSecondary;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.chip,
                {
                    borderColor,
                    backgroundColor: bgColor,
                    opacity: pressed ? 0.8 : 1,
                },
            ]}
            accessibilityRole="button"
        >
            <Ionicons name={icon as any} size={13} color={textColor} />
            <Text style={[styles.chipLabel, { color: textColor }]}>{label}</Text>
        </Pressable>
    );
}

export function ChipRow({
    photoCount,
    onPhotosPress,
    dishValue,
    onDishPress,
    companionCount,
    onCompanionsPress,
    visitedAt,
    onDateChange,
    tablesAvailable,
    selectedTableName,
    onTablesPress,
}: ChipRowProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            style={styles.scroll}
        >
            <ActionChip
                icon={photoCount > 0 ? 'images-outline' : 'camera-outline'}
                label={photoCount > 0 ? `${photoCount} photo${photoCount !== 1 ? 's' : ''}` : 'photos'}
                active={photoCount > 0}
                onPress={onPhotosPress}
                palette={palette}
            />

            <ActionChip
                icon="restaurant-outline"
                label={dishValue ? dishValue : 'dish'}
                active={!!dishValue}
                onPress={onDishPress}
                palette={palette}
            />

            <ActionChip
                icon={companionCount > 0 ? 'people-outline' : 'person-add-outline'}
                label={companionCount > 0 ? `${companionCount} companion${companionCount !== 1 ? 's' : ''}` : 'with…'}
                active={companionCount > 0}
                onPress={onCompanionsPress}
                palette={palette}
            />

            {/* Date chip has its own picker UI */}
            <DateChip value={visitedAt} onChange={onDateChange} />

            {/* Tables chip — same affordance pattern as the rest. Only renders
                when the user is in ≥1 Table. Single-select v1; multi-select
                arrives with the entries.table_id schema rework. */}
            {tablesAvailable ? (
                <ActionChip
                    icon="people-circle-outline"
                    label={selectedTableName ?? 'tables…'}
                    active={!!selectedTableName}
                    onPress={onTablesPress}
                    palette={palette}
                />
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: {
        marginHorizontal: -Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        borderWidth: 1,
        flexShrink: 0,
    },
    chipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        fontWeight: '500',
    },
});
