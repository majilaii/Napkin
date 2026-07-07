/**
 * GlyphChip — TICKET-130. The engraved line-art cuisine chip on trending ledger
 * rows (the piece of direction B the founder kept — NOT a picture: Ionicons
 * outline glyph on a tinted plate with an inset engraving rule).
 *
 * 40×48 plate, tint seeded from restaurant_id across exactly three existing
 * tokens (surfaceJournal / oliveCream / tertiaryFixed — no new theme tokens),
 * a 1px terracotta inset border (absolute inset 3.5), and a centered 20px
 * outline glyph in terracotta at 0.8 opacity. No react-native-svg — Ionicons
 * only. If the founder vetoes chips, delete GlyphChip usage; the ledger stands.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cuisineGlyph, tintIndex } from '@/lib/cuisineGlyph';

type Palette = typeof Colors.light;

/**
 * Seeded tint pick — shared with PublicListsBrowseBlock's poster cards so both
 * surfaces draw from the same three-token paper palette.
 */
export function chipTint(seed: string, palette: Palette): string {
    const tints = [palette.surfaceJournal, palette.oliveCream, palette.tertiaryFixed] as const;
    return tints[tintIndex(seed)];
}

export function GlyphChip({
    cuisine,
    seed,
}: {
    cuisine: string | null | undefined;
    /** Stable id (restaurant_id) — keeps the tint deterministic across renders. */
    seed: string;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.chip, { backgroundColor: chipTint(seed, palette) }]}>
            <View style={styles.inset} />
            <Ionicons
                name={cuisineGlyph(cuisine)}
                size={20}
                color={palette.primary}
                style={styles.glyph}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        width: 40,
        height: 48,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Engraved inner rule — an inset plate line, not a sectioning border.
    inset: {
        position: 'absolute',
        top: 3.5,
        left: 3.5,
        right: 3.5,
        bottom: 3.5,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: 'rgba(160,63,40,0.22)',
    },
    glyph: {
        opacity: 0.8,
    },
});
