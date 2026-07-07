/**
 * ShareGlyph — one column of the activation hub's source row (TICKET-122).
 *
 * Source-app NAME (Manrope) with a neutral, theme-built share glyph drawn beneath
 * it — teaching *where to tap* in each source app without describing it. Names are
 * nominative use; the glyph is a plain Ionicons outline, never a brand mark
 * (locked decision #3). No emoji, one accent max.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import type { GlyphName } from './activationHubUtils';

type Palette = typeof Colors.light;

interface Props {
    source: string;
    glyph: GlyphName;
    palette: Palette;
}

export function ShareGlyph({ source, glyph, palette }: Props) {
    return (
        <View style={styles.column} accessibilityLabel={`${source}: tap share`}>
            <Text style={[styles.name, { color: palette.textSecondary }]}>{source}</Text>
            <Ionicons name={glyph} size={20} color={palette.textMuted} />
        </View>
    );
}

const styles = StyleSheet.create({
    column: {
        flex: 1,
        alignItems: 'center',
        gap: 7,
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.1,
    },
});

export default ShareGlyph;
