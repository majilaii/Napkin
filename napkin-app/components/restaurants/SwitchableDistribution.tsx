/**
 * SwitchableDistribution — single tier-switchable histogram for restaurant page v3.
 *
 * Shows 5 rows (5★ → 1★), slim terracotta bars.
 * Heading: italic serif kicker "— {Tier}'s distribution"
 * Hint on right: "tap to switch" (hidden when only one tier has data).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SignalTier } from './SignalStrip';

interface Props {
    activeTier: SignalTier;
    distributions: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    showTapHint?: boolean;
}

type Palette = typeof Colors.light;

function tierLabel(tier: SignalTier): string {
    switch (tier) {
        case 'you': return 'Your';
        case 'your_table': return "Your table's";
        case 'napkin': return 'Napkin';
    }
}

export function SwitchableDistribution({ activeTier, distributions, showTapHint = true }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    // When your_table is requested but data is null, show an empty state rather
    // than silently falling back to napkin data under the "Your table's distribution" heading.
    const yourTableNull = activeTier === 'your_table' && distributions.your_table === null;

    const dist = yourTableNull
        ? [0, 0, 0, 0, 0]
        : activeTier === 'your_table'
            ? distributions.your_table!
            : activeTier === 'you'
                ? distributions.you
                : distributions.napkin;

    const total = dist.reduce((a, b) => a + b, 0);

    const ruleColor = 'rgba(221, 192, 186, 0.4)';

    return (
        <View style={[styles.wrap, { borderTopColor: ruleColor }]}>
            <View style={styles.head}>
                <Text style={[styles.lbl, { color: palette.textSecondary }]}>
                    {'— '}
                    <Text style={[styles.lblBold, { color: palette.text }]}>{tierLabel(activeTier)} </Text>
                    distribution
                </Text>
                {showTapHint ? (
                    <Text style={[styles.hint, { color: palette.textMuted }]}>TAP TO SWITCH</Text>
                ) : null}
            </View>

            {yourTableNull ? (
                <Text style={[styles.emptyState, { color: palette.textMuted }]}>
                    — not enough visits yet
                </Text>
            ) : null}

            {/* Rows: 5★ down to 1★ */}
            {!yourTableNull && [5, 4, 3, 2, 1].map((star) => {
                const count = dist[star - 1] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                    <View key={star} style={styles.row}>
                        <Text style={[styles.starLabel, { color: palette.textSecondary }]}>
                            {star}
                        </Text>
                        <View style={[styles.barWrap, { backgroundColor: palette.surfaceContainerLow }]}>
                            <View
                                style={[
                                    styles.bar,
                                    { width: `${pct}%`, backgroundColor: palette.primary },
                                ]}
                            />
                        </View>
                        <Text style={[styles.countLabel, { color: palette.textMuted }]}>
                            {count}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginHorizontal: 22,
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
    },
    head: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 10,
    },
    lbl: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    lblBold: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 13,
        fontStyle: 'italic',
    },
    hint: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        opacity: 0.7,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 3,
    },
    starLabel: {
        width: 14,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        textAlign: 'right',
    },
    barWrap: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    bar: {
        height: '100%',
        borderRadius: 2,
    },
    countLabel: {
        width: 20,
        textAlign: 'right',
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
    emptyState: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        paddingVertical: 8,
    },
});
