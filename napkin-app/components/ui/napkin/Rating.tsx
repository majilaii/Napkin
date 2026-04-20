/**
 * Rating — canonical Napkin rating treatment.
 *
 * Serif italic N.N (amber) + muted /5. Three sizes per kit primitive:
 *   display — 44/22 (profile hero, review hero)
 *   card    — 28/14 (cards, stats)
 *   inline  — 18/11 (lists, rows)
 *
 * Canvas reference: primitives.jsx → Rating()
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Size = 'display' | 'card' | 'inline';

interface Props {
    value: number | null | undefined;
    size?: Size;
}

const SIZES: Record<Size, { v: number; d: number; gap: number; letter: number }> = {
    display: { v: 44, d: 22, gap: 6, letter: -0.6 },
    card: { v: 28, d: 14, gap: 5, letter: -0.3 },
    inline: { v: 18, d: 11, gap: 4, letter: -0.2 },
};

export function Rating({ value, size = 'card' }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const s = SIZES[size];

    if (value == null) return null;

    return (
        <View style={styles.row}>
            <Text
                style={[
                    styles.value,
                    {
                        fontSize: s.v,
                        letterSpacing: s.letter,
                        color: palette.tertiary,
                    },
                ]}
            >
                {value.toFixed(1)}
            </Text>
            <Text
                style={[
                    styles.denom,
                    {
                        fontSize: s.d,
                        marginLeft: s.gap,
                        color: palette.textMuted,
                    },
                ]}
            >
                /5
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    value: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontWeight: '400',
        lineHeight: undefined,
    },
    denom: {
        fontFamily: 'Newsreader_400Regular_Italic',
    },
});
