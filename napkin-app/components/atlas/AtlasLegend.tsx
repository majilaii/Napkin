/**
 * AtlasLegend — tiny footnote row rendered below the map.
 *
 * Three items: solo · round · mixed — each with a mini swatch + label.
 * Swatch shapes mirror the actual pin variants at reduced size.
 *
 * Wireframe: atlas-canvas.html .map-legend rules (~line 554-604).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

const TERRACOTTA = '#a03f28';
const OLIVE = '#5c614d';
const AMBER_DOT = '#b8842a';
// Project forces light-only: useColorScheme() returns 'light' as const
const CREAM = '#fdf6ec';

interface Props {
    palette?: typeof Colors.light;
}

export function AtlasLegend({ palette: paletteProp }: Props) {
    const palette = paletteProp ?? Colors.light;
    const cream = CREAM;

    return (
        <View style={styles.row}>
            {/* Solo swatch */}
            <View style={styles.item}>
                <View
                    style={[
                        styles.soloSwatch,
                        { backgroundColor: cream },
                    ]}
                />
                <Text style={[styles.label, { color: palette.textMuted }]}>solo</Text>
            </View>

            <Text style={[styles.sep, { color: palette.textMuted }]}>·</Text>

            {/* Round swatch */}
            <View style={styles.item}>
                <View style={styles.roundSwatchOlive}>
                    <View style={[styles.roundSwatchCreamGap, { backgroundColor: cream }]}>
                        <View
                            style={[
                                styles.roundSwatchInner,
                                { backgroundColor: cream },
                            ]}
                        />
                    </View>
                </View>
                <Text style={[styles.label, { color: palette.textMuted }]}>round</Text>
            </View>

            <Text style={[styles.sep, { color: palette.textMuted }]}>·</Text>

            {/* Mixed swatch (same ring + amber dot) */}
            <View style={styles.item}>
                <View style={styles.mixedSwatchWrap}>
                    <View style={styles.roundSwatchOlive}>
                        <View style={[styles.roundSwatchCreamGap, { backgroundColor: cream }]}>
                            <View
                                style={[
                                    styles.roundSwatchInner,
                                    { backgroundColor: cream },
                                ]}
                            />
                        </View>
                    </View>
                    <View style={[styles.mixedDot, { borderColor: cream }]} />
                </View>
                <Text style={[styles.label, { color: palette.textMuted }]}>mixed</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 8,
        gap: 8,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    label: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.3,
    },
    sep: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        opacity: 0.55,
    },

    // Solo: 10px circle with 1.2px terracotta border
    soloSwatch: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1.2,
        borderColor: TERRACOTTA,
    },

    // Round double-ring: olive outer → cream gap → terracotta inner
    // 14px total
    roundSwatchOlive: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: OLIVE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundSwatchCreamGap: {
        width: 11.2,
        height: 11.2,
        borderRadius: 5.6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundSwatchInner: {
        width: 9.6,
        height: 9.6,
        borderRadius: 4.8,
        borderWidth: 0.8,
        borderColor: TERRACOTTA,
    },

    // Mixed: same ring + small amber dot
    mixedSwatchWrap: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    mixedDot: {
        position: 'absolute',
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: AMBER_DOT,
        right: -2,
        bottom: 1,
        borderWidth: 0.8,
    },
});

export default AtlasLegend;
