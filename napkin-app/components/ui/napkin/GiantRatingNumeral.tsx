/**
 * GiantRatingNumeral — Newsreader italic X/5 or X.5/5 numeral.
 * Used on memory-card feed entries (card scale) and entry-detail (detail scale).
 *
 * Does NOT replace Rating.tsx (5-tick glyph) — that stays for DiaryRow and compact surfaces.
 *
 * Numeral format: integer values as "4/5", half-values as "3.5/5".
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Scale = 'card' | 'detail';

interface Props {
    value: number;
    scale?: Scale;
}

function formatRating(value: number): string {
    const clamped = Math.max(0, Math.min(5, value));
    const rounded = Math.round(clamped * 2) / 2;
    // Use integer display when no half-star
    if (rounded === Math.floor(rounded)) {
        return `${Math.floor(rounded)}/5`;
    }
    return `${rounded}/5`;
}

export function GiantRatingNumeral({ value, scale = 'card' }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // card = 28px, detail = ~50px (card × ~1.8)
    const fontSize = scale === 'detail' ? 50 : 28;

    return (
        <Text style={[styles.numeral, { fontSize, color: palette.text }]}>
            {formatRating(value)}
        </Text>
    );
}

const styles = StyleSheet.create({
    numeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontWeight: '400',
        lineHeight: undefined, // let it auto-size
        includeFontPadding: false,
    },
});
