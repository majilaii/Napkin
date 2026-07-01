/**
 * RatingPlate — the restaurant page's anchor object.
 *
 * A circular "plate" sitting right of the masthead, holding YOUR number in
 * terracotta italic serif. Unrated → a dashed, waiting plate (same grammar as
 * the profile Top 4 empty tile: dashed outlineVariant on surfaceContainerLow).
 * The plate is Napkin's poster: rated = collected, dashed = still to come.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

interface Props {
    /** Your average rating here; null = you haven't rated it yet. */
    rating: number | null;
    palette: Palette;
}

export function RatingPlate({ rating, palette }: Props) {
    const has = rating != null;
    return (
        <View
            accessibilityLabel={has ? `your rating ${rating!.toFixed(1)}` : 'not rated yet'}
            style={[
                styles.plate,
                has
                    ? {
                          backgroundColor: palette.surfaceNote,
                          borderColor: palette.outlineVariant,
                          borderWidth: StyleSheet.hairlineWidth,
                      }
                    : {
                          backgroundColor: palette.surfaceContainerLow,
                          borderColor: palette.outlineVariant,
                          borderWidth: 1.5,
                          borderStyle: 'dashed',
                      },
            ]}
        >
            <Text
                style={[
                    styles.num,
                    has ? { color: palette.primary } : { color: palette.textMuted, fontSize: 20 },
                ]}
            >
                {has ? rating!.toFixed(1) : '—'}
            </Text>
            <Text style={[styles.kicker, { color: palette.textMuted }]}>YOURS</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    plate: {
        width: 76,
        height: 76,
        borderRadius: 38,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 15,
        elevation: 2,
    },
    num: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 28,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8,
        letterSpacing: 1.2,
    },
});
