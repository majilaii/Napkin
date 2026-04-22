/**
 * AtlasPinMarker — map pin primitives for the Atlas map view.
 *
 * Three variants:
 *   SoloPin   — 24px cream circle, 1.5px terracotta border, italic 11px rating
 *   RoundPin  — 34px: outer olive ring + cream gap + 1px terracotta inner
 *               italic 14px rating inside
 *   MixedPin  — Same shell as RoundPin + 6px amber edge-dot at 4 o'clock
 *
 * Heart overlay: when wishedByViewer=true a 12px terracotta-outline heart icon
 * sits at top:-6, left:-6, overlapping the pin edge by ~2px.
 *
 * Each variant is a plain View — used as children of react-native-maps <Marker>.
 * Tap is handled by Marker.onPress (no inner Pressable needed).
 *
 * Ambient shadow on all pins per design system.
 * Wireframe reference: atlas-canvas.html lines ~484-534 (pin CSS).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

// Ambient shadow per spec
const PIN_SHADOW = {
    shadowColor: '#1c1c19',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
} as const;

const TERRACOTTA = '#a03f28';
const OLIVE = '#5c614d';
const AMBER_DOT_COLOR = '#b8842a';
// Always light — useColorScheme() returns 'light' as const in this project
const CREAM = '#fdf6ec';

function formatRating(rating: number | null): string {
    if (rating === null) return '—';
    return `${rating}`;
}

// ── Heart overlay ─────────────────────────────────────────────────────────────

function HeartOverlay() {
    return (
        <View style={styles.heartWrap} pointerEvents="none">
            <Ionicons name="heart-outline" size={12} color={TERRACOTTA} />
        </View>
    );
}

// ── Prop types ────────────────────────────────────────────────────────────────

export interface PinProps {
    rating: number | null;
    wishedByViewer?: boolean;
    /** Pass palette for theme alignment */
    palette?: typeof Colors.light;
}

// ── SoloPin ───────────────────────────────────────────────────────────────────
// 24px cream circle, 1.5px terracotta border, 11px italic rating inside

export function SoloPin({ rating, wishedByViewer = false, palette }: PinProps) {
    const inkColor = palette?.terracottaInk ?? '#9a3412';

    return (
        <View style={styles.pinOuter}>
            {wishedByViewer && <HeartOverlay />}
            <View style={[styles.soloBubble, PIN_SHADOW]}>
                <Text style={[styles.soloRating, { color: inkColor }]}>
                    {formatRating(rating)}
                </Text>
            </View>
        </View>
    );
}

// ── RoundPin ──────────────────────────────────────────────────────────────────
// 34px total: olive outer fill (acts as 2px outer ring) → cream gap → cream inner with 1px terracotta border

export function RoundPin({ rating, wishedByViewer = false, palette }: PinProps) {
    const inkColor = palette?.terracottaInk ?? '#9a3412';

    return (
        <View style={styles.pinOuter}>
            {wishedByViewer && <HeartOverlay />}
            <View style={[styles.roundOliveRing, PIN_SHADOW]}>
                <View style={styles.roundCreamGap}>
                    <View style={styles.roundInnerBubble}>
                        <Text style={[styles.roundRating, { color: inkColor }]}>
                            {formatRating(rating)}
                        </Text>
                    </View>
                </View>
            </View>
        </View>
    );
}

// ── MixedPin ──────────────────────────────────────────────────────────────────
// Same double-ring shell as Round + 6px amber dot at 4 o'clock half-outside

export function MixedPin({ rating, wishedByViewer = false, palette }: PinProps) {
    const inkColor = palette?.terracottaInk ?? '#9a3412';

    return (
        <View style={styles.pinOuter}>
            {wishedByViewer && <HeartOverlay />}
            <View style={styles.mixedWrapper}>
                <View style={[styles.roundOliveRing, PIN_SHADOW]}>
                    <View style={styles.roundCreamGap}>
                        <View style={styles.roundInnerBubble}>
                            <Text style={[styles.roundRating, { color: inkColor }]}>
                                {formatRating(rating)}
                            </Text>
                        </View>
                    </View>
                </View>
                {/* Amber dot at 4 o'clock: right, slightly below center */}
                <View style={styles.amberDot} />
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    // Outer container: positions heart at top-left
    pinOuter: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Heart — top-left overlapping edge by ~2px
    heartWrap: {
        position: 'absolute',
        top: -6,
        left: -6,
        zIndex: 10,
    },

    // ── Solo ──────────────────────────────────────────────────────────────────
    soloBubble: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: CREAM,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: TERRACOTTA,
    },
    soloRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 9,
        lineHeight: 11,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
        includeFontPadding: false,
    },

    // ── Round / Mixed double-ring ─────────────────────────────────────────────
    // Layer breakdown (total outer diameter = 34px):
    //   roundOliveRing:  34px olive fill — 2px outer ring visible
    //   roundCreamGap:   30px cream — 1px cream separator band
    //   roundInnerBubble: 28px cream with 1px terracotta border
    roundOliveRing: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: OLIVE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundCreamGap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: CREAM,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundInnerBubble: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: CREAM,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: TERRACOTTA,
    },
    roundRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
        lineHeight: 13,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
        includeFontPadding: false,
    },

    // ── Mixed extras ──────────────────────────────────────────────────────────
    mixedWrapper: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    amberDot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: AMBER_DOT_COLOR,
        // 4 o'clock: right edge half-outside, just below center of 34px circle
        right: -3,
        bottom: 5,
        // 1px cream outline
        borderWidth: 1,
        borderColor: CREAM,
    },
});

export type PinType = 'solo' | 'round' | 'mixed';
