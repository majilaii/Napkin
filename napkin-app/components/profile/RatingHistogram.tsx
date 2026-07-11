/**
 * RatingHistogram — the profile "RATINGS" module (TICKET-165, replacing the
 * Regulars rail). "How this person rates, at a glance" — the Letterboxd profile
 * histogram in Napkin's own grammar.
 *
 * Same family as the restaurant RATINGS module (SwitchableDistribution) + the
 * /taste histogram (taste.tsx): a Manrope "RATINGS" kicker, ten half-star amber
 * bars over a ghosted baseline rule with ½★/5★ end labels, and a big italic
 * Newsreader average on the right. Below, up to four dimension spines
 * (VIBE / FLAVOR / SERVICE / VALUE) — a hairline track with a marker dot at the
 * mean; thin dimensions (n < 3) drop out, and the whole spine block hides when
 * none qualify.
 *
 * Two accents, per the profile budget: amber (tertiary) bars + terracotta
 * (primary) spine dots. The average numeral is ink (quiet), not an accent.
 *
 * Gate (owned by the caller's hasPalateAccess + isSelf):
 *   • ≥ 3 rated meals → the live module (self: taps through to /taste).
 *   • < 3, self       → a quiet ghost frame + one short line.
 *   • < 3, stranger   → nothing (caller renders null).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HISTOGRAM_BINS, fillHistogram } from './tasteUtils';
import type { HistogramBucket } from '@/hooks/users/useUserTaste';
import type { DimensionAvgs } from '@/hooks/users/useUserProfile';

const BAR_AREA_HEIGHT = 48;
const MIN_BAR = 3;
/** A dimension needs at least this many rated meals to earn a spine. */
const SPINE_MIN_N = 3;
/** The whole module hides (stranger) / ghosts (self) below this many rated meals. */
const MODULE_MIN_RATED = 3;

type Palette = typeof Colors.light;

/** The four secondary dimensions, in display order (TICKET-165 copy). */
const SPINES: { key: keyof DimensionAvgs; label: string }[] = [
    { key: 'vibe', label: 'Vibe' },
    { key: 'flavor', label: 'Flavor' },
    { key: 'service', label: 'Service' },
    { key: 'value', label: 'Value' },
];

interface Props {
    histogram: HistogramBucket[] | undefined;
    dimensionAvgs: DimensionAvgs | undefined;
    averageRating: number | null | undefined;
    /** Self → below 3 rated shows a ghost frame; ≥ 3 taps through to /taste. */
    isSelf: boolean;
    /** Self only — the live module taps to /taste. */
    onPress?: () => void;
}

export function RatingHistogram({ histogram, dimensionAvgs, averageRating, isSelf, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;

    const counts = useMemo(() => fillHistogram(histogram), [histogram]);
    const total = useMemo(() => counts.reduce((a, b) => a + b, 0), [counts]);
    const max = Math.max(...counts, 1);

    // Below the 3-rated floor: strangers get nothing; self gets a quiet ghost.
    if (total < MODULE_MIN_RATED) {
        if (!isSelf) return null;
        return <GhostFrame palette={palette} />;
    }

    const spines = SPINES
        .map((s) => ({ ...s, stat: dimensionAvgs?.[s.key] }))
        .filter(
            (s): s is { key: keyof DimensionAvgs; label: string; stat: { avg: number; n: number } } =>
                s.stat != null && s.stat.n >= SPINE_MIN_N && s.stat.avg != null,
        );

    const body = (
        <View style={styles.wrap}>
            <Text style={[styles.kicker, { color: palette.textMuted }]}>RATINGS</Text>

            <View style={styles.body}>
                <View style={styles.chart}>
                    <View style={styles.bars}>
                        <View style={[styles.baseline, { backgroundColor: palette.dividerSoft }]} />
                        {HISTOGRAM_BINS.map((bin, i) => {
                            const count = counts[i];
                            const h =
                                count > 0 ? Math.max(MIN_BAR, (count / max) * BAR_AREA_HEIGHT) : MIN_BAR;
                            return (
                                <View key={bin} style={styles.barCol}>
                                    <View
                                        style={[
                                            styles.bar,
                                            {
                                                height: h,
                                                backgroundColor:
                                                    count > 0 ? palette.tertiary : palette.surfaceJournalHi,
                                            },
                                        ]}
                                    />
                                </View>
                            );
                        })}
                    </View>
                    <View style={styles.scale}>
                        <Text style={[styles.scaleEnd, { color: palette.textMuted }]}>½ ★</Text>
                        <Text style={[styles.scaleEnd, { color: palette.textMuted }]}>5 ★</Text>
                    </View>
                </View>

                <View style={styles.avgCol}>
                    <Text style={[styles.avg, { color: palette.text }]}>
                        {averageRating != null ? averageRating.toFixed(1) : '—'}
                    </Text>
                    <Text style={[styles.avgSub, { color: palette.textMuted }]}>
                        {`${total} ${total === 1 ? 'meal' : 'meals'}`}
                    </Text>
                </View>
            </View>

            {spines.length > 0 ? (
                <View style={styles.spines}>
                    {spines.map((s) => {
                        const pct = Math.max(0, Math.min(1, s.stat.avg / 5));
                        return (
                            <View key={s.key} style={styles.spineRow}>
                                <Text style={[styles.spineLabel, { color: palette.textSecondary }]}>
                                    {s.label.toUpperCase()}
                                </Text>
                                <View style={styles.spineTrackWrap}>
                                    <View
                                        style={[styles.spineTrack, { backgroundColor: palette.surfaceJournalHi }]}
                                    />
                                    <View
                                        style={[
                                            styles.spineDot,
                                            { left: `${pct * 100}%`, backgroundColor: palette.primary },
                                        ]}
                                    />
                                </View>
                                <Text style={[styles.spineNum, { color: palette.text }]}>
                                    {s.stat.avg.toFixed(1)}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            ) : null}
        </View>
    );

    if (isSelf && onPress) {
        return (
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="see your taste">
                {body}
            </Pressable>
        );
    }
    return body;
}

/**
 * The quiet ghost frame — self, below the 3-rated floor. Flat ghost bars, a
 * "—" numeral, one short line. Non-interactive on purpose: tapping into an
 * empty /taste would just dead-end into the same "nothing rated yet" message.
 */
function GhostFrame({ palette }: { palette: Palette }) {
    return (
        <View style={styles.wrap}>
            <Text style={[styles.kicker, { color: palette.textMuted }]}>RATINGS</Text>
            <View style={styles.body}>
                <View style={styles.chart}>
                    <View style={styles.bars}>
                        <View style={[styles.baseline, { backgroundColor: palette.dividerSoft }]} />
                        {HISTOGRAM_BINS.map((bin) => (
                            <View key={bin} style={styles.barCol}>
                                <View
                                    style={[
                                        styles.bar,
                                        { height: MIN_BAR, backgroundColor: palette.surfaceJournalHi },
                                    ]}
                                />
                            </View>
                        ))}
                    </View>
                </View>
                <View style={styles.avgCol}>
                    <Text style={[styles.avg, { color: palette.textMuted }]}>—</Text>
                </View>
            </View>
            <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                your rating spread appears here
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginTop: Spacing.md,
        // Matches ProfileIndex (the module directly below) so the RATINGS
        // kicker's left edge lines up down the stack.
        paddingHorizontal: Spacing.lg,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
        marginBottom: Spacing.sm,
    },
    body: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.md,
    },
    chart: {
        flex: 1,
    },
    bars: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
        height: BAR_AREA_HEIGHT,
    },
    baseline: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
    },
    barCol: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    bar: {
        width: '100%',
        borderRadius: 3,
    },
    scale: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    scaleEnd: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.5,
    },
    avgCol: {
        alignItems: 'flex-end',
        paddingBottom: 2,
    },
    avg: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 34,
        lineHeight: 36,
    },
    avgSub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        marginTop: 2,
    },
    spines: {
        marginTop: Spacing.md,
        gap: 9,
    },
    spineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    spineLabel: {
        width: 58,
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 0.8,
    },
    spineTrackWrap: {
        flex: 1,
        height: 14,
        justifyContent: 'center',
    },
    spineTrack: {
        height: 2,
        borderRadius: 1,
        width: '100%',
    },
    spineDot: {
        position: 'absolute',
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: -4,
        top: 3,
    },
    spineNum: {
        width: 30,
        textAlign: 'right',
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 16,
        fontVariant: ['tabular-nums'],
    },
    emptyLine: {
        marginTop: Spacing.sm,
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
