/**
 * RatingHistogram — the profile "RATINGS" module (TICKET-165, replacing the
 * Regulars rail). "How this person rates, at a glance" — the Letterboxd profile
 * histogram in Napkin's own grammar.
 *
 * Same family as the restaurant RATINGS module (SwitchableDistribution) + the
 * /taste histogram (taste.tsx): a clear section heading, ten half-star amber
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

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';
import { HISTOGRAM_BINS, fillHistogram } from './tasteUtils';
import type { HistogramBucket } from '@/hooks/users/useUserTaste';
import type { DimensionAvgs } from '@/hooks/users/useUserProfile';

const BAR_AREA_HEIGHT = 48;
const MIN_BAR = 3;
// The chart is a fixed-width data graphic. Cap its embedded labels and expose
// the same values in the Pressable accessibility label at every text size.
const CHART_MAX_FONT_SCALE = 1.2;
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
    const spineSummary = spines
        .map((spine) => `${spine.label} ${spine.stat.avg.toFixed(1)}`)
        .join(', ');

    const card = (
        <View style={[styles.card, { backgroundColor: palette.surfaceJournalLow }]}>
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
                        <Text style={[styles.scaleEnd, { color: palette.textMuted }]} maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}>½ ★</Text>
                        <Text style={[styles.scaleEnd, { color: palette.textMuted }]} maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}>5 ★</Text>
                    </View>
                </View>

                <View style={styles.avgCol}>
                    <Text
                        style={[styles.avg, { color: palette.text }]}
                        maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}
                    >
                        {averageRating != null ? averageRating.toFixed(1) : '—'}
                    </Text>
                    <Text
                        style={[styles.avgSub, { color: palette.textMuted }]}
                        maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}
                    >
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
                                <Text
                                    style={[styles.spineLabel, { color: palette.textSecondary }]}
                                    maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}
                                >
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
                                <Text
                                    style={[styles.spineNum, { color: palette.text }]}
                                    maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}
                                >
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
            <View>
                <SectionHeader title="Ratings" />
                <Pressable
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`Ratings. Average ${averageRating != null ? averageRating.toFixed(1) : 'unavailable'} across ${total} ${total === 1 ? 'meal' : 'meals'}.${spineSummary ? ` ${spineSummary}.` : ''} See breakdown`}
                >
                    {card}
                </Pressable>
            </View>
        );
    }
    return (
        <View>
            <SectionHeader title="Ratings" />
            {card}
        </View>
    );
}

/**
 * The quiet ghost frame — self, below the 3-rated floor. Flat ghost bars, a
 * "—" numeral, one short line. Non-interactive on purpose: tapping into an
 * empty /taste would just dead-end into the same "nothing rated yet" message.
 */
function GhostFrame({ palette }: { palette: Palette }) {
    return (
        <View>
            <SectionHeader title="Ratings" />
            <View style={[styles.card, { backgroundColor: palette.surfaceJournalLow }]}>
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
                        <Text
                            style={[styles.avg, { color: palette.textMuted }]}
                            maxFontSizeMultiplier={CHART_MAX_FONT_SCALE}
                        >
                            —
                        </Text>
                    </View>
                </View>
                <Text
                    style={[styles.emptyLine, { color: palette.textMuted }]}
                    maxFontSizeMultiplier={2}
                >
                    Your rating spread appears here
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: Spacing.lg,
        borderRadius: 16,
        padding: 18,
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
        fontSize: 11,
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
        fontVariant: ['tabular-nums'],
    },
    avgSub: {
        ...Type.metadata,
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
        width: 62,
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.6,
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
        ...Type.bodySmall,
    },
});
