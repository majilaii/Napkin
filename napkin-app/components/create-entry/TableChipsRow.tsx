/**
 * TableChipsRow — inline chip preview for selected Tables in the composer.
 *
 * TICKET-043: "Smart three" — shows up to 3 Tables inline as tappable chips
 * with a "+N more" overflow chip. Tapping a visible chip toggles selection.
 * Tapping "+N more" opens the sheet.
 *
 * Smart-three ordering (driven by caller via `orderedTables`):
 *   1. Tables pre-selected by context (pinned first — e.g. opened from Table A page)
 *   2. Most-recently-posted-to by the user (from useRecentlyPostedTables)
 *
 * When 0 Tables available → component renders nothing (empty-Tables state).
 *
 * Filled-state chip label:
 *   - 0 selected:  italic "Post to a table?" placeholder
 *   - 1 selected:  "Sunday Roast"
 *   - 2+ selected: "Sunday Roast +1"
 *
 * Only the first chip (or the placeholder) is rendered inline; the rest collapse
 * into "+N more" which opens the sheet when tapped.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const MAX_INLINE_CHIPS = 3;

export interface TableChip {
    id: string;
    name: string;
}

interface Props {
    /** All Tables the user belongs to, in Smart-three order (context-pinned first, then recency). */
    orderedTables: TableChip[];
    /** Currently selected Table ids. */
    selectedIds: string[];
    /** Fired when a visible chip is tapped (toggles that id). */
    onToggle: (id: string) => void;
    /** Fired when the +N more chip is tapped (or the placeholder). */
    onOpenSheet: () => void;
}

export function TableChipsRow({ orderedTables, selectedIds, onToggle, onOpenSheet }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // If user is in zero Tables, render nothing (per spec: hide the field entirely).
    if (orderedTables.length === 0) return null;

    // Show up to MAX_INLINE_CHIPS Tables inline; the rest go into "+N more".
    const inlineChips = orderedTables.slice(0, MAX_INLINE_CHIPS);
    const overflowCount = orderedTables.length - MAX_INLINE_CHIPS;
    const overflowNames = orderedTables.slice(MAX_INLINE_CHIPS).map(t => t.name).join(', ');

    // Filled-state label for when no chips are selected (placeholder).
    const noSelectionLabel = 'Post to a table?';

    // Compute the displayed label for the first selected chip:
    //   1 selected → that table's name
    //   2+ selected → "<firstName> +N"
    const selectedChips = orderedTables.filter(t => selectedIds.includes(t.id));
    const unselectedInlineChips = inlineChips.filter(t => !selectedIds.includes(t.id));

    return (
        <View style={styles.row}>
            {/* If none selected, show a tappable placeholder chip that opens the sheet */}
            {selectedIds.length === 0 ? (
                <Pressable
                    onPress={onOpenSheet}
                    style={({ pressed }) => [
                        styles.chip,
                        styles.placeholderChip,
                        {
                            borderColor: palette.divider,
                            backgroundColor: pressed ? palette.surfaceContainerHigh : 'transparent',
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={noSelectionLabel}
                >
                    <Text style={[styles.placeholderLabel, { color: palette.textMuted }]}>
                        {noSelectionLabel}
                    </Text>
                </Pressable>
            ) : (
                <>
                    {/* Show selected chips inline (up to MAX_INLINE_CHIPS) */}
                    {selectedChips.slice(0, MAX_INLINE_CHIPS).map((table, i) => (
                        <Pressable
                            key={table.id}
                            onPress={() => onToggle(table.id)}
                            style={({ pressed }) => [
                                styles.chip,
                                {
                                    borderColor: 'rgba(160,63,40,0.4)',
                                    backgroundColor: pressed
                                        ? 'rgba(160,63,40,0.12)'
                                        : 'rgba(160,63,40,0.08)',
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: true }}
                            accessibilityLabel={table.name}
                        >
                            <Text
                                style={[styles.chipLabel, { color: palette.primary }]}
                                numberOfLines={1}
                            >
                                {i === 0 && selectedChips.length > 1
                                    ? `${table.name} +${selectedChips.length - 1}`
                                    : table.name}
                            </Text>
                        </Pressable>
                    ))}

                    {/* Show unselected inline chips that fit (ghosted outline) */}
                    {unselectedInlineChips.slice(0, MAX_INLINE_CHIPS - Math.min(selectedChips.length, MAX_INLINE_CHIPS)).map(table => (
                        <Pressable
                            key={table.id}
                            onPress={() => onToggle(table.id)}
                            style={({ pressed }) => [
                                styles.chip,
                                {
                                    borderColor: palette.divider,
                                    backgroundColor: pressed ? palette.surfaceContainerHigh : 'transparent',
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: false }}
                            accessibilityLabel={table.name}
                        >
                            <Text
                                style={[styles.chipLabel, { color: palette.textSecondary }]}
                                numberOfLines={1}
                            >
                                {table.name}
                            </Text>
                        </Pressable>
                    ))}
                </>
            )}

            {/* +N more chip (overflow) */}
            {overflowCount > 0 ? (
                <Pressable
                    onPress={onOpenSheet}
                    style={({ pressed }) => [
                        styles.chip,
                        {
                            borderColor: palette.divider,
                            backgroundColor: pressed ? palette.surfaceContainerHigh : 'transparent',
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${overflowCount} more tables: ${overflowNames}`}
                >
                    <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>
                        +{overflowCount} more
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        borderWidth: 1,
        flexShrink: 0,
        maxWidth: 180,
    },
    placeholderChip: {
        // No special overrides — just the ghost outline
    },
    chipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    placeholderLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 13,
    },
});
