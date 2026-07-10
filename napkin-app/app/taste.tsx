/**
 * /taste — the taste drill-in (TICKET-112, redesigned TICKET-150). Own profile
 * only, v1.
 *
 * "The ledger of your palate" — a typographic page, no charts lib:
 *   hero numeral → half-star histogram (amber) → editorial line → the four
 *   axis marks in an inset panel → cuisine leaders (highest / toughest, menu
 *   dots) → the city ledger → a closing line about your regular.
 *
 * Two accents only: terracotta (numerals, axis bars) + amber (histogram).
 * Olive stays ink. Ratings in Newsreader italic (brand numerals);
 * labels in Manrope (functional). Dotted leaders are Text middle-dots —
 * the menu idiom, not a border trick.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserTaste } from '@/hooks/users/useUserTaste';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import {
    TASTE_AXES as AXES,
    HISTOGRAM_BINS,
    deriveHardestAxis,
    deriveCityLedger,
    deriveRegular,
    fillHistogram,
} from '@/components/profile/tasteUtils';

const HIST_BAR_MAX = 56;
const LEADER = '·'.repeat(80);

function fmt(avg: number | null): string {
    return avg == null ? '—' : avg.toFixed(1);
}

export default function TasteScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const identifier = user?.id;
    const { data: taste, isLoading, isError } = useUserTaste(identifier);
    // City ledger + regular derive from spots (already the band's source — no new fetch).
    const { data: spots } = useUserSpots(identifier);
    const cityLedger = useMemo(() => (spots ? deriveCityLedger(spots) : null), [spots]);
    const regular = useMemo(() => (spots ? deriveRegular(spots) : null), [spots]);

    const histogram = useMemo(() => fillHistogram(taste?.rating_histogram), [taste]);
    const histTotal = useMemo(() => histogram.reduce((a, b) => a + b, 0), [histogram]);
    const histMax = Math.max(...histogram, 1);

    const hardestAxis = useMemo(
        () => (taste && taste.entry_count >= 5 ? deriveHardestAxis(taste.categories) : null),
        [taste],
    );

    /** Meals carrying a category breakdown — one quiet caption instead of four n's. */
    const breakdownN = useMemo(
        () => (taste ? Math.max(...AXES.map(({ key }) => taste.categories[key].n)) : 0),
        [taste],
    );

    const coverageLine = useMemo(() => {
        if (!cityLedger) return null;
        const parts = [
            cityLedger.cityCount > cityLedger.rows.length ? `${cityLedger.cityCount} cities` : null,
            cityLedger.countryCount > 1 ? `${cityLedger.countryCount} countries` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : null;
    }, [cityLedger]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Header — hierarchical back to profile */}
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={26} color={palette.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: palette.text }]}>Your taste</Text>
                <View style={{ width: 26 }} />
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : isError || !taste ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                        couldn&apos;t load your taste just now.
                    </Text>
                </View>
            ) : taste.entry_count === 0 ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyHead, { color: palette.text }]}>Nothing rated yet</Text>
                    <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                        Rate a few meals and your taste takes shape here.
                    </Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 48 }]}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Overall + count */}
                    <View style={styles.overallBlock}>
                        <Text style={[styles.overallNum, { color: palette.primary }]}>
                            {fmt(taste.overall_avg)}
                        </Text>
                        <Text style={[styles.overallMeta, { color: palette.textMuted }]}>
                            {`across ${taste.entry_count} rated ${taste.entry_count === 1 ? 'meal' : 'meals'}`}
                        </Text>
                    </View>

                    {/* The shape of it — half-star histogram */}
                    {taste.entry_count >= 3 && histTotal > 0 ? (
                        <View style={styles.histBlock}>
                            <View style={styles.histRow}>
                                {HISTOGRAM_BINS.map((bin, i) => {
                                    const count = histogram[i];
                                    const h = count > 0 ? Math.max(4, (count / histMax) * HIST_BAR_MAX) : 3;
                                    return (
                                        <View key={bin} style={styles.histCol}>
                                            <View
                                                style={[
                                                    styles.histBar,
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
                            <View style={styles.histScale}>
                                <Text style={[styles.histEnd, { color: palette.textMuted }]}>½ ★</Text>
                                <Text style={[styles.histEnd, { color: palette.textMuted }]}>5 ★</Text>
                            </View>
                        </View>
                    ) : null}

                    {/* Editorial line — only on real, well-sampled spread */}
                    {hardestAxis ? (
                        <Text style={[styles.editorial, { color: palette.textSecondary }]}>
                            {`You rate ${hardestAxis.toLowerCase()} the hardest.`}
                        </Text>
                    ) : null}

                    {/* Category ledger — inset panel, one caption instead of four n's */}
                    {breakdownN > 0 ? (
                        <>
                            <View style={styles.kickerRow}>
                                <Text style={[styles.sectionKicker, { color: palette.textMuted, marginBottom: 0 }]}>
                                    BY THE NUMBERS
                                </Text>
                                <Text style={[styles.kickerMeta, { color: palette.textMuted }]}>
                                    {`${breakdownN} OF ${taste.entry_count} MEALS`}
                                </Text>
                            </View>
                            <View style={[styles.axisPanel, { backgroundColor: palette.surfaceJournalLow }]}>
                                {AXES.map(({ key, label }) => {
                                    const stat = taste.categories[key];
                                    const pct = stat.avg != null ? Math.max(0, Math.min(1, stat.avg / 5)) : 0;
                                    return (
                                        <View key={key} style={styles.catRow}>
                                            <Text style={[styles.catLabel, { color: palette.textSecondary }]}>
                                                {label.toUpperCase()}
                                            </Text>
                                            <View style={styles.catBarWrap}>
                                                <View
                                                    style={[styles.catTrack, { backgroundColor: palette.surfaceJournalHi }]}
                                                >
                                                    <View
                                                        style={[
                                                            styles.catFill,
                                                            { width: `${pct * 100}%`, backgroundColor: palette.primary },
                                                        ]}
                                                    />
                                                </View>
                                            </View>
                                            <Text style={[styles.catNum, { color: palette.text }]}>{fmt(stat.avg)}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    ) : null}

                    {/* Cuisine leaders — junk-filtered, disjoint (server) */}
                    {taste.top_cuisines.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                HIGHEST MARKS
                            </Text>
                            {taste.top_cuisines.map((c) => (
                                <View key={`top-${c.cuisine}`} style={styles.leaderRow}>
                                    <Text style={[styles.leaderName, { color: palette.text }]} numberOfLines={1}>
                                        {c.cuisine}
                                    </Text>
                                    <Text
                                        style={[styles.leaderDots, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                        ellipsizeMode="clip"
                                    >
                                        {LEADER}
                                    </Text>
                                    <Text style={[styles.leaderNum, { color: palette.primary }]}>{c.avg.toFixed(1)}</Text>
                                    <Text style={[styles.leaderN, { color: palette.textMuted }]}>{`×${c.n}`}</Text>
                                </View>
                            ))}
                        </>
                    ) : null}

                    {taste.bottom_cuisines.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                TOUGHEST MARKS
                            </Text>
                            {taste.bottom_cuisines.map((c) => (
                                <View key={`bot-${c.cuisine}`} style={styles.leaderRow}>
                                    <Text style={[styles.leaderName, { color: palette.text }]} numberOfLines={1}>
                                        {c.cuisine}
                                    </Text>
                                    <Text
                                        style={[styles.leaderDots, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                        ellipsizeMode="clip"
                                    >
                                        {LEADER}
                                    </Text>
                                    <Text style={[styles.leaderNum, { color: palette.textSecondary }]}>
                                        {c.avg.toFixed(1)}
                                    </Text>
                                    <Text style={[styles.leaderN, { color: palette.textMuted }]}>{`×${c.n}`}</Text>
                                </View>
                            ))}
                        </>
                    ) : null}

                    {/* The city ledger */}
                    {cityLedger && cityLedger.rows.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                WHERE YOU&apos;VE EATEN
                            </Text>
                            {cityLedger.rows.map((c) => (
                                <View key={c.city} style={styles.leaderRow}>
                                    <Text style={[styles.leaderName, { color: palette.text }]} numberOfLines={1}>
                                        {c.city}
                                    </Text>
                                    <Text
                                        style={[styles.leaderDots, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                        ellipsizeMode="clip"
                                    >
                                        {LEADER}
                                    </Text>
                                    <Text style={[styles.cityCount, { color: palette.textSecondary }]}>{c.meals}</Text>
                                </View>
                            ))}
                            {coverageLine ? (
                                <Text style={[styles.coverage, { color: palette.textMuted }]}>{coverageLine}</Text>
                            ) : null}
                        </>
                    ) : null}

                    {/* The regular — closing line */}
                    {regular ? (
                        <Text style={[styles.editorialClose, { color: palette.textSecondary }]}>
                            {`You keep going back to ${regular.name} — ${regular.visits} visits.`}
                        </Text>
                    ) : null}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    headerTitle: {
        ...Type.screenTitle,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 40,
    },
    emptyHead: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
    },
    emptyLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
    },
    scroll: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
    },
    overallBlock: {
        alignItems: 'center',
        gap: 2,
        paddingVertical: Spacing.md,
    },
    overallNum: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 56,
        lineHeight: 62,
    },
    overallMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12.5,
    },
    histBlock: {
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.md,
    },
    histRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
        height: HIST_BAR_MAX,
    },
    histCol: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    histBar: {
        width: '100%',
        borderRadius: 3,
    },
    histScale: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    histEnd: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.5,
    },
    editorial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 23,
        textAlign: 'center',
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    kickerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: Spacing.lg,
        marginBottom: Spacing.sm,
    },
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
        marginBottom: Spacing.sm,
    },
    kickerMeta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1,
    },
    axisPanel: {
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
    },
    catRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 9,
    },
    catLabel: {
        width: 66,
        fontFamily: 'Manrope_700Bold',
        fontSize: 10.5,
        letterSpacing: 0.8,
    },
    catBarWrap: {
        flex: 1,
    },
    catTrack: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    catFill: {
        height: 6,
        borderRadius: 3,
    },
    catNum: {
        width: 34,
        textAlign: 'right',
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 19,
        fontVariant: ['tabular-nums'],
    },
    leaderRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingVertical: 8,
    },
    leaderName: {
        flexShrink: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
    },
    leaderDots: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        letterSpacing: 3,
        opacity: 0.45,
        paddingHorizontal: 6,
    },
    leaderNum: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 18,
        fontVariant: ['tabular-nums'],
    },
    leaderN: {
        width: 30,
        textAlign: 'right',
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        fontVariant: ['tabular-nums'],
    },
    cityCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        fontVariant: ['tabular-nums'],
    },
    coverage: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
        marginTop: Spacing.md,
    },
    editorialClose: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 23,
        textAlign: 'center',
        marginTop: Spacing.xl,
        paddingHorizontal: Spacing.md,
    },
});
