/**
 * DestinationPicker — TICKET-060 R2/R12.
 *
 * My-Wishlist pre-ticked + Tables from useTables.
 * Multi-select: multiple Tables can be ticked at once.
 * One "save" CTA fans to all ticked destinations via ONE create_import call.
 *
 * List rows are deliberately absent (R12 — Lists return when Lists ship).
 *
 * Heirloom Journal: lowercase italic title "where does this go?",
 * surfaceJournalLow rows, terracotta primary CTA. No 1px borders. No emoji in chrome.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
// Radius kept for saveButton style
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTables } from '@/hooks/tables/useTables';
import { useAuth } from '@/providers/AuthProvider';
import { RowToggle } from './RowToggle';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DestinationSelection {
    wishlist: boolean;
    table_ids: string[];
    /**
     * Parallel array of table names corresponding to table_ids.
     * Populated by the singleTableOnly flow (TICKET-063b) so the caller
     * can display the chosen table name without a separate lookup.
     */
    table_names?: string[];
}

export interface DestinationPickerProps {
    /** Called with the final selection when the user taps "save". */
    onConfirm: (selection: DestinationSelection) => void;
    /** Called when the user taps cancel/back. */
    onCancel: () => void;
    /** Whether the confirm mutation is in-flight. */
    isSaving?: boolean;
    /** Whole-save failure copy, shown above the primary action. */
    errorText?: string | null;
    /**
     * TICKET-063b: when true, constrains to single-table selection only.
     * - Hides the "my wishlist" row.
     * - Table rows behave as single-select (selecting one deselects others).
     * - Title reads "share to a table"; CTA reads "share".
     * - onConfirm returns { wishlist: false, table_ids: [id], table_names: [name] }.
     */
    singleTableOnly?: boolean;
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function DestinationPicker({
    onConfirm,
    onCancel,
    isSaving = false,
    errorText,
    singleTableOnly = false,
}: DestinationPickerProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const { user } = useAuth();

    const { data: memberships, isLoading: tablesLoading } = useTables(user?.id);

    // My Wishlist is pre-ticked (OQ3 resolution — always default).
    // Hidden + unused in singleTableOnly mode.
    const [wishlistTicked, setWishlistTicked] = useState(true);
    const [tickedTableIds, setTickedTableIds] = useState<Set<string>>(new Set());

    // Memoised so handleSave can look up the table name without stale closure.
    const tables = useMemo(
        () => (memberships ?? []).map((m: any) => m.tables ?? m) as Array<{ id: string; name: string }>,
        [memberships],
    );

    const toggleTable = useCallback((tableId: string) => {
        if (singleTableOnly) {
            // Single-select: selecting a new table deselects the previous.
            // Tapping the already-selected table deselects it (empty state).
            setTickedTableIds((prev) => {
                const next = new Set<string>();
                if (!prev.has(tableId)) next.add(tableId);
                return next;
            });
        } else {
            setTickedTableIds((prev) => {
                const next = new Set(prev);
                if (next.has(tableId)) next.delete(tableId);
                else next.add(tableId);
                return next;
            });
        }
    }, [singleTableOnly]);

    // Whether the CTA is enabled.
    const hasSelection = singleTableOnly
        ? tickedTableIds.size === 1
        : (wishlistTicked || tickedTableIds.size > 0);

    const handleSave = useCallback(() => {
        if (singleTableOnly) {
            const selectedId = [...tickedTableIds][0];
            if (!selectedId) return;
            const selectedTable = tables.find((t) => t.id === selectedId);
            onConfirm({
                wishlist: false,
                table_ids: [selectedId],
                table_names: selectedTable ? [selectedTable.name] : [],
            });
        } else {
            onConfirm({
                wishlist: wishlistTicked,
                table_ids: [...tickedTableIds],
            });
        }
    }, [onConfirm, wishlistTicked, tickedTableIds, singleTableOnly, tables]);

    const title = singleTableOnly ? 'share to a table' : 'where does this go?';
    const ctaLabel = singleTableOnly ? 'share' : 'save';

    return (
        <View>
            {/* Sheet title */}
            <Text style={[styles.title, { color: palette.text }]}>
                {title}
            </Text>

            <ScrollView
                style={styles.listScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* My Wishlist row — hidden in singleTableOnly mode */}
                {!singleTableOnly && (
                    <RowToggle
                        label="my wishlist"
                        checked={wishlistTicked}
                        onToggle={() => setWishlistTicked((v) => !v)}
                        palette={palette}
                    />
                )}

                {/* Table rows */}
                {tablesLoading ? (
                    <ActivityIndicator
                        color={palette.primary}
                        size="small"
                        style={{ marginVertical: Spacing.md }}
                    />
                ) : (
                    tables.map((table) => (
                        <RowToggle
                            key={table.id}
                            label={table.name}
                            italic
                            checked={tickedTableIds.has(table.id)}
                            onToggle={() => toggleTable(table.id)}
                            palette={palette}
                        />
                    ))
                )}
            </ScrollView>

            {errorText ? (
                <Text
                    accessibilityLiveRegion="polite"
                    style={[Type.bodySmall, styles.saveError, { color: palette.error }]}
                >
                    {errorText}
                </Text>
            ) : null}

            {/* Primary CTA */}
            <Pressable
                onPress={handleSave}
                disabled={isSaving || !hasSelection}
                style={({ pressed }) => [
                    styles.saveButton,
                    {
                        backgroundColor: hasSelection
                            ? palette.primary
                            : palette.surfaceContainerHigh,
                        opacity: pressed || isSaving ? 0.75 : 1,
                    },
                ]}
                accessibilityLabel={ctaLabel}
            >
                {isSaving ? (
                    <ActivityIndicator color={palette.textInverse} size="small" />
                ) : (
                    <Text
                        style={[
                            Type.label,
                            {
                                color: hasSelection
                                    ? palette.textInverse
                                    : palette.textMuted,
                            },
                        ]}
                    >
                        {ctaLabel}
                    </Text>
                )}
            </Pressable>

            {/* Cancel */}
            <Pressable onPress={onCancel} hitSlop={8} style={styles.cancelRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>cancel</Text>
            </Pressable>
        </View>
    );
}

// RowToggle is now imported from ./RowToggle (TICKET-063: shared component)

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    title: {
        ...Type.headlineItalic,
        marginBottom: Spacing.md,
    },
    listScroll: {
        maxHeight: 300,
    },
    saveError: {
        marginBottom: Spacing.sm,
    },
    saveButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginTop: Spacing.sm,
    },
    cancelRow: {
        paddingVertical: Spacing.sm,
        alignItems: 'center',
        minHeight: 48,
        justifyContent: 'center',
    },
});
