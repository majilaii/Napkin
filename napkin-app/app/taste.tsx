/**
 * /taste — the taste drill-in (TICKET-112, redesigned TICKET-150). Self uses
 * the full journal; public profiles use public entries only.
 *
 * "The ledger of your palate" — a typographic page, no charts lib:
 *   earned Taste emblem → hero numeral → half-star histogram (amber) →
 *   cuisine leaders (highest / toughest, menu dots) → the city ledger → a
 *   closing line about your regular.
 *
 * The emblem draws from the existing terracotta / amber / olive identity
 * palette; the factual histogram stays amber. Ratings in Newsreader italic;
 * labels in Manrope (functional). Dotted leaders are Text middle-dots —
 * the menu idiom, not a border trick.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserTaste } from '@/hooks/users/useUserTaste';
import { deriveTasteEmblemInput, useUserSpots } from '@/hooks/users/useUserSpots';
import { TasteEmblem, TasteEmblemPending } from '@/components/profile/TasteEmblem';
import { tasteEmblemFor } from '@/lib/tasteEmblem';
import {
    HISTOGRAM_BINS,
    cityStatAccessibilityLabel,
    cuisineStatAccessibilityLabel,
    deriveCityLedger,
    deriveRegular,
    fillHistogram,
    hasTasteDrillInContent,
    ratingDistributionAccessibilityLabel,
    resolveTasteRouteTarget,
} from '@/components/profile/tasteUtils';

const HIST_BAR_MAX = 56;
const LEADER = '·'.repeat(80);

function fmt(avg: number | null): string {
    return avg == null ? '—' : avg.toFixed(1);
}

export default function TasteScreen() {
    const { userId: routeUserId } = useLocalSearchParams<{ userId?: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { targetUserId, isSelf } = resolveTasteRouteTarget(routeUserId, user?.id);
    const { data: taste, isLoading: tasteLoading, isError: tasteError } = useUserTaste(targetUserId);
    // City ledger + regular derive from spots (already the band's source — no new fetch).
    const { data: spots, isLoading: spotsLoading, isError: spotsError } = useUserSpots(targetUserId);
    const cityLedger = useMemo(() => (spots ? deriveCityLedger(spots) : null), [spots]);
    const regular = useMemo(() => (spots ? deriveRegular(spots) : null), [spots]);
    const emblemInput = useMemo(() => (spots ? deriveTasteEmblemInput(spots) : null), [spots]);
    const emblem = useMemo(() => (emblemInput ? tasteEmblemFor(emblemInput) : null), [emblemInput]);

    const histogram = useMemo(() => fillHistogram(taste?.rating_histogram), [taste]);
    const histTotal = useMemo(() => histogram.reduce((a, b) => a + b, 0), [histogram]);
    const histMax = Math.max(...histogram, 1);
    const histogramAccessibilityLabel = useMemo(
        () => ratingDistributionAccessibilityLabel(histogram),
        [histogram],
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
                <Pressable
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons name="chevron-back" size={26} color={palette.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: palette.text }]}>
                    {isSelf ? 'Your taste' : 'Taste'}
                </Text>
                <View style={{ width: 44 }} />
            </View>

            {tasteLoading || spotsLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : tasteError || spotsError || !taste || !spots ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                        couldn&apos;t load this taste just now.
                    </Text>
                </View>
            ) : !hasTasteDrillInContent(taste.entry_count, spots.length) ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyHead, { color: palette.text }]}>Nothing logged yet</Text>
                    <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                        {isSelf
                            ? 'Log a few meals and your taste takes shape here.'
                            : 'There isn’t enough public journal activity here yet.'}
                    </Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 48 }]}
                    showsVerticalScrollIndicator={false}
                >
                    {emblem && emblemInput ? (
                        <TasteEmblem
                            emblem={emblem}
                            totalMeals={emblemInput.totalMeals}
                            totalPlaces={emblemInput.totalPlaces}
                            cityCount={emblemInput.cityCount}
                            countryCount={emblemInput.countryCount}
                            isSelf={isSelf}
                        />
                    ) : emblemInput ? (
                        <TasteEmblemPending
                            totalMeals={emblemInput.totalMeals}
                            cityCount={emblemInput.cityCount}
                            countryCount={emblemInput.countryCount}
                            isSelf={isSelf}
                        />
                    ) : null}

                    {/* Overall + count — omitted when the journal has only unrated logs. */}
                    {taste.entry_count > 0 ? (
                        <View style={styles.overallBlock}>
                            <Text style={[styles.overallNum, { color: palette.primary }]}>
                                {fmt(taste.overall_avg)}
                            </Text>
                            <Text style={[styles.overallMeta, { color: palette.textMuted }]}>
                                {`across ${taste.entry_count} rated ${taste.entry_count === 1 ? 'meal' : 'meals'}`}
                            </Text>
                        </View>
                    ) : null}

                    {/* The shape of it — half-star histogram */}
                    {taste.entry_count >= 3 && histTotal > 0 ? (
                        <View
                            style={styles.histBlock}
                            accessible
                            accessibilityLabel={histogramAccessibilityLabel}
                        >
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

                    {/* Cuisine leaders — junk-filtered, disjoint (server) */}
                    {taste.top_cuisines.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                HIGHEST MARKS
                            </Text>
                            {taste.top_cuisines.map((c) => (
                                <View
                                    key={`top-${c.cuisine}`}
                                    accessible
                                    accessibilityLabel={cuisineStatAccessibilityLabel(c.cuisine, c.avg, c.n)}
                                >
                                    <View
                                        style={styles.leaderRow}
                                        accessibilityElementsHidden
                                        importantForAccessibility="no-hide-descendants"
                                    >
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
                                        <Text style={[styles.leaderNum, { color: palette.primary }]}>
                                            {c.avg.toFixed(1)}
                                        </Text>
                                        <Text style={[styles.leaderN, { color: palette.textMuted }]}>{`×${c.n}`}</Text>
                                    </View>
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
                                <View
                                    key={`bot-${c.cuisine}`}
                                    accessible
                                    accessibilityLabel={cuisineStatAccessibilityLabel(c.cuisine, c.avg, c.n)}
                                >
                                    <View
                                        style={styles.leaderRow}
                                        accessibilityElementsHidden
                                        importantForAccessibility="no-hide-descendants"
                                    >
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
                                </View>
                            ))}
                        </>
                    ) : null}

                    {/* The city ledger */}
                    {cityLedger && cityLedger.rows.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                {isSelf ? 'WHERE YOU’VE EATEN' : 'WHERE THEY’VE EATEN'}
                            </Text>
                            {cityLedger.rows.map((c) => (
                                <View
                                    key={c.city}
                                    accessible
                                    accessibilityLabel={cityStatAccessibilityLabel(c.city, c.meals)}
                                >
                                    <View
                                        style={styles.leaderRow}
                                        accessibilityElementsHidden
                                        importantForAccessibility="no-hide-descendants"
                                    >
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
                                        <Text style={[styles.cityCount, { color: palette.textSecondary }]}>
                                            {c.meals}
                                        </Text>
                                    </View>
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
                            {isSelf
                                ? `You keep going back to ${regular.name} — ${regular.visits} visits.`
                                : `They keep going back to ${regular.name} — ${regular.visits} visits.`}
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
        paddingHorizontal: 14,
        paddingBottom: Spacing.sm,
    },
    headerTitle: {
        ...Type.screenTitle,
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
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
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
        marginBottom: Spacing.sm,
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
