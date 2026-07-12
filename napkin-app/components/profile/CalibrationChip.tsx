/**
 * CalibrationChip — TICKET-022 (profile header, full form)
 *
 * Renders the "taste match" signal between the viewing user and a target user:
 *   "<NN>% match · within <D> across <K> spots"
 *
 * States:
 *   - calibration === undefined → "—% match · calculating" (loading)
 *   - calibration === null → hidden (insufficient overlap / Tablemate / error)
 *
 * Design rules:
 *   - Numerals (NN, D, K) → semibold functional type, textPrimary
 *   - Tail words → Manrope metadata, textSecondary
 *   - Middle dot · is a literal character separator
 *   - NO accent color — calibration is a utility signal, not a brand moment
 *   - NOT tappable in v1 — no press state, no drill-down
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Calibration } from '@/hooks/users/useUserProfile';

interface CalibrationChipProps {
    /** null = hide chip (insufficient overlap or error). undefined = still loading. */
    calibration: Calibration | null | undefined;
}

export function CalibrationChip({ calibration }: CalibrationChipProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (calibration === undefined) {
        return (
            <View style={styles.row} accessibilityLabel="calculating taste match">
                <Text style={[styles.numeral, { color: palette.textMuted }]}>—%</Text>
                <Text style={[styles.tail, { color: palette.textMuted }]}>{' match · calculating'}</Text>
            </View>
        );
    }

    if (calibration === null) return null;

    const { match_pct, mae, overlap_n } = calibration;
    const maeDisplay = mae.toFixed(1);
    const a11yLabel = `${match_pct} percent taste match with this user, within ${maeDisplay} of a star across ${overlap_n} shared restaurants`;

    return (
        <View
            style={styles.row}
            accessibilityLabel={a11yLabel}
            accessibilityRole="text"
        >
            <Text style={[styles.numeral, { color: palette.text }]}>{match_pct}%</Text>
            <Text style={[styles.tail, { color: palette.textSecondary }]}>{' match · within '}</Text>
            <Text style={[styles.numeral, { color: palette.text }]}>{maeDisplay}</Text>
            <Text style={[styles.tail, { color: palette.textSecondary }]}>{' across '}</Text>
            <Text style={[styles.numeral, { color: palette.text }]}>{overlap_n}</Text>
            <Text style={[styles.tail, { color: palette.textSecondary }]}>{' spots'}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
    },
    numeral: {
        ...Type.titleSmall,
        lineHeight: 19,
        fontVariant: ['tabular-nums'],
    },
    tail: {
        ...Type.metadata,
    },
});
