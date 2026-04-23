/**
 * MealSlotRow — a single breakfast/lunch/dinner slot on the day-page.
 *
 * Filled state: compact summary (restaurant · rating · first line of note), tappable → entry-detail.
 * Empty state: dashed border + "tap to add" affordance, tappable → composer with prefill.
 *
 * Wireframe C1/C2 grammar.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MealSlot, SlotEntry } from '@/lib/mealSlots';

interface Props {
    slot: MealSlot;
    entry: SlotEntry | null;
    onFillTap: (entry: SlotEntry) => void;
    onEmptyTap: (slot: MealSlot) => void;
}

const SLOT_LABELS: Record<MealSlot, string> = {
    breakfast: 'breakfast',
    lunch: 'lunch',
    dinner: 'dinner',
};

function formatRatingLabel(rating: number | null): string {
    if (rating == null) return '';
    const r = Math.round(rating * 2) / 2;
    return Number.isInteger(r) ? `${r}/5` : `${r}/5`;
}

export function MealSlotRow({ slot, entry, onFillTap, onEmptyTap }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (entry) {
        // Filled slot — compact summary
        const firstLine = entry.content?.trim().split('\n')[0] ?? null;
        return (
            <Pressable
                onPress={() => onFillTap(entry)}
                style={({ pressed }) => [
                    styles.filledRow,
                    { backgroundColor: palette.surfaceContainerLow, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityLabel={`${SLOT_LABELS[slot]}: ${entry.restaurantName}. Tap to open.`}
            >
                <View style={styles.slotLabelCol}>
                    <Text style={[styles.slotTimeLabel, { color: palette.textMuted }]}>
                        {SLOT_LABELS[slot].toUpperCase()}
                    </Text>
                </View>
                <View style={styles.filledContent}>
                    <Text style={[styles.restName, { color: palette.text }]} numberOfLines={1}>
                        {entry.restaurantName}
                    </Text>
                    {firstLine ? (
                        <Text style={[styles.entrySnippet, { color: palette.textSecondary }]} numberOfLines={1}>
                            {firstLine}
                        </Text>
                    ) : null}
                </View>
                {entry.rating != null ? (
                    <Text style={[styles.ratingMini, { color: palette.text }]}>
                        {formatRatingLabel(entry.rating)}
                    </Text>
                ) : null}
            </Pressable>
        );
    }

    // Empty slot — dashed border + tap affordance
    return (
        <Pressable
            onPress={() => onEmptyTap(slot)}
            style={({ pressed }) => [
                styles.emptyRow,
                {
                    borderColor: palette.divider,
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
            accessibilityLabel={`Add ${SLOT_LABELS[slot]}`}
        >
            <View style={[styles.addCircle, { backgroundColor: palette.primary }]}>
                <Ionicons name="add" size={18} color="#fff" />
            </View>
            <Text style={[styles.emptyLabel, { color: palette.textMuted }]}>
                {SLOT_LABELS[slot]}?
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    filledRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        gap: Spacing.sm,
    },
    slotLabelCol: {
        width: 64,
        flexShrink: 0,
    },
    slotTimeLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 2,
    },
    filledContent: {
        flex: 1,
        minWidth: 0,
    },
    restName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 19,
        lineHeight: 24,
        fontWeight: '400',
    },
    entrySnippet: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 4,
    },
    ratingMini: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        flexShrink: 0,
    },
    emptyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md + 4,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        gap: Spacing.sm,
    },
    addCircle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emptyLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
});
