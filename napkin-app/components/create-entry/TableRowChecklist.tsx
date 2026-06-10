/**
 * TableRowChecklist — vertical canvas row-checklist for Table selection.
 *
 * Canvas Section 3 direction (logger-canvas.jsx, TableContextMultiPhone):
 *   - One row per Table: glyph square + italic-serif name + checkbox
 *   - Selected row: journal fill (palette.surfaceJournal) + terracotta ghost border
 *   - Optional reason sub-line (shown only when provided)
 *   - Helper: "Tables see each other's logs. Leave all off to keep this private to your Journal."
 *
 * Renders nothing when tables.length === 0 (zero-table / Emergence Arc state).
 * For >5 tables, shows first 5 + "all tables" overflow row that calls onOpenOverflow.
 *
 * Props: { tables, selectedIds, onToggle, onOpenOverflow?, reasons? }
 * No business logic — selection state lives in the parent screen.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const MAX_INLINE = 5;

export interface TableRowItem {
    id: string;
    name: string;
    reason?: string;
}

interface Props {
    /** All Tables in Smart-three order; rendered up to MAX_INLINE. */
    tables: TableRowItem[];
    /** Currently selected Table ids. */
    selectedIds: string[];
    /** Fired when a row is tapped (toggles that id). */
    onToggle: (id: string) => void;
    /** Fired when the "all tables" overflow row is tapped. */
    onOpenOverflow?: () => void;
    /** Extra per-table reason strings, keyed by table id (augments table.reason). */
    reasons?: Record<string, string>;
}

function getGlyph(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
}

export function TableRowChecklist({
    tables,
    selectedIds,
    onToggle,
    onOpenOverflow,
    reasons,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Zero-table state — render nothing (Emergence Arc: solo is first-class)
    if (tables.length === 0) return null;

    const inline = tables.slice(0, MAX_INLINE);
    const hasOverflow = tables.length > MAX_INLINE;
    const overflowCount = tables.length - MAX_INLINE;

    return (
        <View style={styles.wrapper}>
            {/* Section label */}
            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                    SHARE TO A TABLE?
                </Text>
                <Text style={[styles.sectionOptional, { color: palette.textMuted }]}>
                    optional
                </Text>
            </View>

            {/* Table rows */}
            {inline.map(table => {
                const isSelected = selectedIds.includes(table.id);
                const reason = reasons?.[table.id] ?? table.reason;

                return (
                    <Pressable
                        key={table.id}
                        onPress={() => onToggle(table.id)}
                        style={({ pressed }) => [
                            styles.row,
                            {
                                backgroundColor: isSelected
                                    ? palette.surfaceJournal
                                    : pressed
                                        ? palette.surfaceContainerLow
                                        : 'transparent',
                                borderColor: isSelected
                                    ? palette.terracottaBorder
                                    : 'transparent',
                            },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                        accessibilityLabel={table.name}
                    >
                        {/* Glyph square */}
                        <View
                            style={[
                                styles.glyph,
                                {
                                    backgroundColor: isSelected
                                        ? palette.primary
                                        : palette.primaryMuted,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.glyphText,
                                    {
                                        color: isSelected
                                            ? palette.textInverse
                                            : palette.primary,
                                    },
                                ]}
                            >
                                {getGlyph(table.name)}
                            </Text>
                        </View>

                        {/* Name + optional reason — flex:1 minWidth:0 prevents clipping */}
                        <View style={styles.nameContainer}>
                            <Text
                                style={[styles.tableName, { color: palette.text }]}
                                numberOfLines={2}
                            >
                                {table.name}
                            </Text>
                            {reason ? (
                                <Text
                                    style={[styles.reason, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    {reason}
                                </Text>
                            ) : null}
                        </View>

                        {/* Checkbox */}
                        <View
                            style={[
                                styles.checkbox,
                                {
                                    borderColor: isSelected
                                        ? palette.primary
                                        : palette.ruleInkSoft,
                                    backgroundColor: isSelected
                                        ? palette.primary
                                        : 'transparent',
                                },
                            ]}
                        >
                            {isSelected ? (
                                <Text style={styles.checkmark}>✓</Text>
                            ) : null}
                        </View>
                    </Pressable>
                );
            })}

            {/* Overflow row */}
            {hasOverflow ? (
                <Pressable
                    onPress={onOpenOverflow}
                    style={({ pressed }) => [
                        styles.row,
                        {
                            backgroundColor: pressed
                                ? palette.surfaceContainerLow
                                : 'transparent',
                            borderColor: 'transparent',
                        },
                    ]}
                    accessibilityLabel={`View all tables (${overflowCount} more)`}
                >
                    <View
                        style={[
                            styles.glyph,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    >
                        <Text
                            style={[styles.glyphText, { color: palette.textSecondary }]}
                        >
                            {overflowCount}+
                        </Text>
                    </View>
                    <Text
                        style={[
                            styles.tableName,
                            { color: palette.textSecondary, flex: 1 },
                        ]}
                    >
                        all tables
                    </Text>
                </Pressable>
            ) : null}

            {/* Helper copy */}
            <Text style={[styles.helper, { color: palette.textMuted }]}>
                {"Tables see each other's logs. Leave all off to keep this private to your Journal."}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        gap: 6,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2,
    },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    sectionOptional: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: Radius.md - 4,
        borderWidth: 1,
    },
    glyph: {
        width: 30,
        height: 30,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    glyphText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 18,
    },
    nameContainer: {
        flex: 1,
        minWidth: 0,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
        fontWeight: '400',
    },
    reason: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
        lineHeight: 15,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 4,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    checkmark: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 16,
    },
    helper: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
        lineHeight: 16,
        marginTop: Spacing.xs,
        paddingHorizontal: 2,
    },
});
