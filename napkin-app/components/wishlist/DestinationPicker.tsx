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
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTables } from '@/hooks/tables/useTables';
import { useAuth } from '@/providers/AuthProvider';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DestinationSelection {
    wishlist: boolean;
    table_ids: string[];
}

export interface DestinationPickerProps {
    /** Called with the final selection when the user taps "save". */
    onConfirm: (selection: DestinationSelection) => void;
    /** Called when the user taps cancel/back. */
    onCancel: () => void;
    /** Whether the confirm mutation is in-flight. */
    isSaving?: boolean;
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function DestinationPicker({
    onConfirm,
    onCancel,
    isSaving = false,
}: DestinationPickerProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const { user } = useAuth();

    const { data: memberships, isLoading: tablesLoading } = useTables(user?.id);

    // My Wishlist is pre-ticked (OQ3 resolution — always default)
    const [wishlistTicked, setWishlistTicked] = useState(true);
    const [tickedTableIds, setTickedTableIds] = useState<Set<string>>(new Set());

    const toggleTable = useCallback((tableId: string) => {
        setTickedTableIds((prev) => {
            const next = new Set(prev);
            if (next.has(tableId)) {
                next.delete(tableId);
            } else {
                next.add(tableId);
            }
            return next;
        });
    }, []);

    const handleSave = useCallback(() => {
        onConfirm({
            wishlist: wishlistTicked,
            table_ids: [...tickedTableIds],
        });
    }, [onConfirm, wishlistTicked, tickedTableIds]);

    const tables = (memberships ?? []).map((m: any) => m.tables ?? m);

    return (
        <View>
            {/* Sheet title */}
            <Text style={[styles.title, { color: palette.text }]}>
                where does this go?
            </Text>

            <ScrollView
                style={styles.listScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* My Wishlist row — always shown, pre-ticked */}
                <RowToggle
                    label="my wishlist"
                    checked={wishlistTicked}
                    onToggle={() => setWishlistTicked((v) => !v)}
                    palette={palette}
                />

                {/* Table rows */}
                {tablesLoading ? (
                    <ActivityIndicator
                        color={palette.primary}
                        size="small"
                        style={{ marginVertical: Spacing.md }}
                    />
                ) : (
                    tables.map((table: { id: string; name: string }) => (
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

            {/* Primary CTA */}
            <Pressable
                onPress={handleSave}
                disabled={isSaving || (!wishlistTicked && tickedTableIds.size === 0)}
                style={({ pressed }) => [
                    styles.saveButton,
                    {
                        backgroundColor:
                            wishlistTicked || tickedTableIds.size > 0
                                ? palette.primary
                                : palette.surfaceContainerHigh,
                        opacity: pressed || isSaving ? 0.75 : 1,
                    },
                ]}
                accessibilityLabel="save"
            >
                {isSaving ? (
                    <ActivityIndicator color={palette.textInverse} size="small" />
                ) : (
                    <Text
                        style={[
                            Type.label,
                            {
                                color:
                                    wishlistTicked || tickedTableIds.size > 0
                                        ? palette.textInverse
                                        : palette.textMuted,
                            },
                        ]}
                    >
                        save
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

// ── RowToggle ─────────────────────────────────────────────────────────────────

interface RowToggleProps {
    label: string;
    italic?: boolean;
    checked: boolean;
    onToggle: () => void;
    palette: Palette;
}

function RowToggle({ label, italic, checked, onToggle, palette }: RowToggleProps) {
    return (
        <Pressable
            onPress={onToggle}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={label}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: checked
                        ? palette.primaryMuted
                        : palette.surfaceJournalLow,
                    opacity: pressed ? 0.85 : 1,
                },
            ]}
        >
            <Text
                style={[
                    italic ? styles.rowLabelItalic : styles.rowLabel,
                    { color: palette.text },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
            {/* Checkmark */}
            {checked && (
                <Text style={[Type.bodySmall, { color: palette.primary, marginLeft: Spacing.sm }]}>
                    {'✓'}
                </Text>
            )}
        </Pressable>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    title: {
        ...Type.headlineItalic,
        marginBottom: Spacing.md,
    },
    listScroll: {
        maxHeight: 300,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        minHeight: 48,
    },
    rowLabel: {
        ...Type.body,
        flex: 1,
    } as any,
    rowLabelItalic: {
        ...Type.headlineItalic,
        fontSize: 15,
        flex: 1,
    } as any,
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
