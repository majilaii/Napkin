/**
 * AtlasLegend — tiny footnote row rendered below the map.
 *
 * Two items:
 *   solo   — a single colored disc with initial (example uses "J")
 *   round  — a small cluster with the faint terracotta ring enclosing it
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

const CREAM = '#fdf6ec';

interface Props {
    palette?: typeof Colors.light;
}

export function AtlasLegend({ palette: paletteProp }: Props) {
    const palette = paletteProp ?? Colors.light;

    return (
        <View style={styles.row}>
            {/* Solo swatch — single disc */}
            <View style={styles.item}>
                <View
                    style={[
                        styles.disc,
                        { backgroundColor: palette.tertiaryFixed },
                    ]}
                />
                <Text style={[styles.label, { color: palette.textMuted }]}>
                    solo
                </Text>
            </View>

            <Text style={[styles.sep, { color: palette.textMuted }]}>·</Text>

            {/* Round swatch — cluster of 2 with faint ring */}
            <View style={styles.item}>
                <View style={styles.roundWrap}>
                    <View style={styles.roundRing} />
                    <View style={styles.clusterRow}>
                        <View
                            style={[
                                styles.miniDisc,
                                { backgroundColor: palette.secondaryContainer },
                            ]}
                        />
                        <View
                            style={[
                                styles.miniDisc,
                                styles.miniDiscOverlap,
                                { backgroundColor: palette.primaryMuted },
                            ]}
                        />
                    </View>
                </View>
                <Text style={[styles.label, { color: palette.textMuted }]}>
                    round
                </Text>
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
        gap: 10,
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

    disc: {
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: CREAM,
    },

    roundWrap: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 14,
    },
    roundRing: {
        position: 'absolute',
        left: -2,
        right: -2,
        top: -2,
        bottom: -2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(160, 63, 40, 0.4)',
    },
    clusterRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    miniDisc: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: CREAM,
    },
    miniDiscOverlap: {
        marginLeft: -3,
    },
});

export default AtlasLegend;
