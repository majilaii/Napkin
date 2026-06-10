/**
 * RowToggle — shared tap-to-toggle row component.
 * TICKET-063: extracted from DestinationPicker so both DestinationPicker
 * and CandidatePickerPanel share the terracotta-tint + ✓ idiom.
 *
 * Heirloom Journal: terracotta primaryMuted fill when checked, surfaceJournalLow
 * when unchecked. No 1px solid borders. No emoji in chrome (✓ is UI chrome, not an emoji).
 */
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

export interface RowToggleProps {
    label: string;
    /** Use italic Newsreader for the label (Table names). */
    italic?: boolean;
    checked: boolean;
    onToggle: () => void;
    /** Override the palette — if not provided, reads current color scheme. */
    palette?: Palette;
}

export function RowToggle({
    label,
    italic,
    checked,
    onToggle,
    palette: paletteProp,
}: RowToggleProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? (Colors[scheme] as Palette);

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
            {checked && (
                <Text style={[Type.bodySmall, { color: palette.primary, marginLeft: Spacing.sm }]}>
                    {'✓'}
                </Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
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
});
