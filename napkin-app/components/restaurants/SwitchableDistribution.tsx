/**
 * SwitchableDistribution — the design-2a "Ratings" module.
 *
 *   RATINGS                    [You][Table][Napkin]   ← pills switch the tier
 *   ▁ ▁ ▁ ▅ ▁ ▁ ▁ ▁ █ ▁                       4.5
 *   1   2   3   4   5                    3 ratings
 *
 * Ten vertical amber bars in half-star bins (0.5 → 5.0, TICKET-154 — a 4.5
 * is a 4.5, never rounded to 5), a big italic-serif average on the right.
 * The active pill is terracotta-filled; tiers without data don't get a pill.
 * With NO data at all the frame still renders — flat ghost tracks, "—"
 * average, "no ratings yet" — so a cold page keeps the warm page's bones.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SignalTier } from './SignalStrip';

interface Props {
    activeTier: SignalTier;
    /** 10 half-star bins per tier: index i = (i + 1) * 0.5 stars. */
    distributions: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    onTierChange: (tier: SignalTier) => void;
}

const BIN_COUNT = 10;
const EMPTY_BINS = new Array(BIN_COUNT).fill(0);
/** Star value of bin i. */
const binValue = (i: number) => (i + 1) * 0.5;

type Palette = typeof Colors.light;

const BAR_AREA_HEIGHT = 38;
const MIN_TRACK = 4;

function sum(xs: number[]): number {
    return xs.reduce((a, b) => a + b, 0);
}

function average(dist: number[]): number | null {
    const n = sum(dist);
    if (n === 0) return null;
    return dist.reduce((acc, count, i) => acc + count * binValue(i), 0) / n;
}

export function SwitchableDistribution({ activeTier, distributions, onTierChange }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const tiers: Array<{ tier: SignalTier; label: string; dist: number[] | null }> = [
        { tier: 'you', label: 'You', dist: distributions.you },
        { tier: 'your_table', label: 'Table', dist: distributions.your_table },
        { tier: 'napkin', label: 'Napkin', dist: distributions.napkin },
    ];
    const pills = tiers.filter((t) => t.dist != null && sum(t.dist) > 0);

    const active = tiers.find((t) => t.tier === activeTier);
    const dist = (pills.length > 0 ? active?.dist : null) ?? EMPTY_BINS;
    const total = sum(dist);
    const max = Math.max(...dist, 1);
    const avg = average(dist);

    // App is light-locked; ink hairlines per canvas.
    const track = 'rgba(28,28,25,0.07)';
    const pillBorder = 'rgba(28,28,25,0.12)';

    return (
        <View style={styles.wrap}>
            <View style={styles.head}>
                <Text style={[styles.kicker, { color: palette.textMuted }]}>RATINGS</Text>
                {pills.length > 1 ? (
                    <View style={styles.pills}>
                        {pills.map((p) => {
                            const isActive = p.tier === activeTier;
                            return (
                                <Pressable
                                    key={p.tier}
                                    onPress={() => onTierChange(p.tier)}
                                    hitSlop={6}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                    accessibilityLabel={`show ${p.label} ratings`}
                                    style={[
                                        styles.pill,
                                        isActive
                                            ? { backgroundColor: palette.primary }
                                            : { borderWidth: 1, borderColor: pillBorder },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.pillText,
                                            { color: isActive ? '#f6ecd9' : palette.textMuted },
                                        ]}
                                    >
                                        {p.label.toUpperCase()}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}
            </View>

            <View style={styles.body}>
                <View style={styles.chart}>
                    <View style={styles.bars}>
                        {EMPTY_BINS.map((_, i) => {
                            const count = dist[i] ?? 0;
                            const h = count > 0
                                ? Math.max(8, Math.round((count / max) * BAR_AREA_HEIGHT))
                                : MIN_TRACK;
                            return (
                                <View
                                    key={i}
                                    style={[
                                        styles.bar,
                                        {
                                            height: h,
                                            backgroundColor: count > 0 ? palette.amberBright : track,
                                            opacity: count > 0 && count < max ? 0.85 : 1,
                                        },
                                    ]}
                                />
                            );
                        })}
                    </View>
                    <View style={styles.axis}>
                        {/* Whole-star labels only — one per pair of half-star bins. */}
                        {EMPTY_BINS.map((_, i) => (
                            <Text key={i} style={[styles.axisLabel, { color: palette.textMuted }]}>
                                {i % 2 === 1 ? binValue(i).toFixed(0) : ''}
                            </Text>
                        ))}
                    </View>
                </View>
                <View style={styles.avgCol}>
                    <Text style={[styles.avg, { color: palette.text }]}>
                        {avg != null ? avg.toFixed(1) : '—'}
                    </Text>
                    <Text style={[styles.avgSub, { color: palette.textMuted }]}>
                        {total === 0 ? 'no ratings yet' : `${total} rating${total !== 1 ? 's' : ''}`}
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 20,
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
    },
    pills: {
        flexDirection: 'row',
        gap: 4,
    },
    pill: {
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    pillText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8.5,
        letterSpacing: 0.8,
    },
    body: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 14,
    },
    chart: {
        flex: 1,
    },
    bars: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 3,
        height: BAR_AREA_HEIGHT,
    },
    bar: {
        flex: 1,
        borderRadius: 2,
    },
    axis: {
        flexDirection: 'row',
        gap: 3,
        marginTop: 4,
    },
    axisLabel: {
        flex: 1,
        textAlign: 'center',
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
    },
    avgCol: {
        alignItems: 'flex-end',
        paddingBottom: 10,
    },
    avg: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 28,
    },
    avgSub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9.5,
        marginTop: 4,
    },
});
