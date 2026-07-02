/**
 * ScoreBand — the design-2a score band: equal centered cells split by
 * ghosted hairlines, big italic-serif numeral over a tiny caps label and a
 * count.
 *
 *   4.0        5.0        5.0        4.6
 *   YOU        TABLE      NAPKIN     GOOGLE
 *   3 visits   1 of you   2 folks    7.7k
 *
 * You = terracotta, Table/Napkin = ink, Google = muted (external, inert).
 * The band ALWAYS renders its full skeleton: tiers without data show a
 * ghosted "—" so a cold page keeps the same bones as a warm one — emptiness
 * reads as awaiting, never as a missing section. Google renders only when
 * real (an external "—" says nothing). Static display — tier switching lives
 * on the Ratings histogram's pills.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import type { SignalCellData } from './SignalStrip';

type Palette = typeof Colors.light;

interface Props {
    you: SignalCellData;
    yourTable: SignalCellData;
    napkin: SignalCellData;
    google: SignalCellData;
    palette: Palette;
}

export function ScoreBand({ you, yourTable, napkin, google, palette }: Props) {
    // You/Table/Napkin always render (ghosted when empty); Google only when real.
    const cells = [
        { key: 'you', label: 'You', data: you, num: palette.primary, lbl: palette.text },
        { key: 'table', label: 'Table', data: yourTable, num: palette.text, lbl: palette.textSecondary },
        { key: 'napkin', label: 'Napkin', data: napkin, num: palette.text, lbl: palette.textSecondary },
        ...(google.hasData
            ? [{ key: 'google', label: 'Google', data: google, num: palette.textMuted, lbl: palette.textMuted }]
            : []),
    ];

    // App is light-locked; ghosted ink hairline per canvas.
    const rule = 'rgba(28,28,25,0.07)';

    return (
        <View style={[styles.band, { borderBottomColor: rule }]}>
            {cells.map((c, i) => {
                const ghost = !c.data.hasData;
                return (
                    <View
                        key={c.key}
                        style={[styles.cell, i > 0 && { borderLeftWidth: 1, borderLeftColor: rule }]}
                    >
                        <Text
                            style={[
                                styles.num,
                                ghost
                                    ? { color: palette.textMuted, opacity: 0.4 }
                                    : { color: c.num },
                            ]}
                        >
                            {c.data.value != null ? c.data.value.toFixed(1) : '—'}
                        </Text>
                        <Text style={[styles.label, { color: ghost ? palette.textMuted : c.lbl }]}>
                            {c.label.toUpperCase()}
                        </Text>
                        {!ghost && c.data.sub ? (
                            <Text style={[styles.sub, { color: palette.textMuted }]}>{c.data.sub}</Text>
                        ) : null}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    band: {
        flexDirection: 'row',
        alignItems: 'stretch',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 10,
        borderBottomWidth: 1,
    },
    cell: {
        flex: 1,
        alignItems: 'center',
    },
    num: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 26,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        marginTop: 6,
    },
    sub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9.5,
        marginTop: 2,
    },
});

export default ScoreBand;
