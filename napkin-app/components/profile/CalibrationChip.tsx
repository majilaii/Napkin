/**
 * CalibrationChip — TICKET-022
 *
 * Renders the "taste match" signal between the viewing user and a target user.
 *
 * Two forms:
 *   Full form  (profile header):  "<NN>% match · within <D> across <K> spots"
 *   Compact form (review card):   "<NN>% match"
 *
 * Loading state renders "—% match · calculating" (full form only).
 *
 * Hidden when:
 *   - calibration is null (overlap insufficient, viewer/target are Tablemates, error)
 *   - loading resolves to null
 *
 * Design rules:
 *   - Numerals (NN, D, K) → Newsreader italic, textPrimary
 *   - Tail words → Manrope caption, textSecondary
 *   - Middle dot · is a literal character separator
 *   - NO accent color — calibration is a utility signal, not a brand moment
 *   - NOT tappable in v1 — no press state, no drill-down
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Calibration } from '@/hooks/users/useUserProfile';

interface CalibrationChipProps {
    /** null = hide chip (insufficient overlap or error). undefined = still loading. */
    calibration: Calibration | null | undefined;
    /** 'full' renders the extended form with delta + overlap count. Default: 'full'. */
    form?: 'full' | 'compact';
}

export function CalibrationChip({ calibration, form = 'full' }: CalibrationChipProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Loading state — only shown in full form
    if (calibration === undefined) {
        if (form === 'compact') return null;
        return (
            <View style={styles.row} accessibilityLabel="calculating taste match">
                <Text style={[styles.numeral, { color: palette.textMuted }]}>—%</Text>
                <Text style={[styles.tail, { color: palette.textMuted }]}>{' match · calculating'}</Text>
            </View>
        );
    }

    // Hidden when null (insufficient overlap, Tablemate, error)
    if (calibration === null) return null;

    const { match_pct, mae, overlap_n } = calibration;

    if (form === 'compact') {
        return (
            <Text
                style={styles.compactRow}
                accessibilityLabel={`${match_pct} percent taste match with this review's author`}
                accessibilityRole="text"
            >
                <Text style={[styles.numeral, { color: palette.text }]}>{match_pct}%</Text>
                <Text style={[styles.tail, { color: palette.textSecondary }]}>{' match'}</Text>
            </Text>
        );
    }

    // Full form: "<NN>% match · within <D> across <K> spots"
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
    compactRow: {
        flexDirection: 'row' as const,
    },
    numeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 17,
    },
    tail: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 17,
    },
});
