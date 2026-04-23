/**
 * RateMoreToUnlockPrompt — TICKET-022
 *
 * Renders a calm prompt when the viewer's own rated-entry count is below
 * the calibration minimum threshold (OVERLAP_MIN = 5), occupying the slot
 * where the CalibrationChip would otherwise render.
 *
 * Copy: "rate more restaurants to unlock taste match"
 *
 * Design rules:
 *   - Newsreader italic, textMuted, lowercase — no icon, no CTA button
 *   - Only renders on surfaces where a Ring 2 chip would otherwise appear
 *     (i.e., public_only relationship). Never on self or tables_in_common.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Minimum viewer rated-entry count before calibration is available. */
const VIEWER_MIN_RATED = 5;

interface RateMoreToUnlockPromptProps {
    /** Viewer's total count of rated entries (from user-profile response). */
    viewerRatedEntryCount: number | undefined;
}

export function RateMoreToUnlockPrompt({ viewerRatedEntryCount }: RateMoreToUnlockPromptProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Only render when we know the count is below the threshold
    if (viewerRatedEntryCount == null || viewerRatedEntryCount >= VIEWER_MIN_RATED) {
        return null;
    }

    return (
        <Text
            style={[styles.prompt, { color: palette.textMuted }]}
            accessibilityLabel="rate more restaurants to unlock taste match with this user"
            accessibilityRole="text"
        >
            rate more restaurants to unlock taste match
        </Text>
    );
}

const styles = StyleSheet.create({
    prompt: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 17,
    },
});
