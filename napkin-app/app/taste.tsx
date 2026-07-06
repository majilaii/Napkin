/**
 * /taste — the taste drill-in (TICKET-112). Own profile only, v1.
 *
 * A typographic ledger (no charts lib): four category rows (Manrope caps label ·
 * Newsreader-italic mean numeral · plain-View distribution bar · n), a client-
 * derived "you rate {axis} the hardest" line (only when the spread is real and
 * every axis has enough data), and a cuisine top-3 / bottom-3 section. Coverage
 * line reused from the profile taste band.
 *
 * Two accents only: terracotta (means/bars) + olive (secondary text). Ratings in
 * Newsreader italic (brand numerals); labels/prompts in Manrope (functional).
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserTaste } from '@/hooks/users/useUserTaste';
import { useUserSpots, deriveTaste } from '@/hooks/users/useUserSpots';
import { TASTE_AXES as AXES, deriveHardestAxis } from '@/components/profile/tasteUtils';

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
    // Coverage line reuses the spots-derived taste (same source as the band).
    const { data: spots } = useUserSpots(identifier);
    const coverage = useMemo(() => (spots ? deriveTaste(spots) : null), [spots]);

    const hardestAxis = useMemo(
        () => (taste && taste.entry_count >= 5 ? deriveHardestAxis(taste.categories) : null),
        [taste],
    );

    const coverageLine = useMemo(() => {
        if (!coverage) return null;
        const parts = [
            coverage.cityCount > 0 ? `${coverage.cityCount} ${coverage.cityCount === 1 ? 'city' : 'cities'}` : null,
            coverage.countryCount > 1 ? `${coverage.countryCount} countries` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : null;
    }, [coverage]);

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
                    contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
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

                    {/* Editorial line — only on real, well-sampled spread */}
                    {hardestAxis ? (
                        <Text style={[styles.editorial, { color: palette.textSecondary }]}>
                            {`You rate ${hardestAxis.toLowerCase()} the hardest.`}
                        </Text>
                    ) : null}

                    {/* Category ledger */}
                    <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>BY THE NUMBERS</Text>
                    {AXES.map(({ key, label }) => {
                        const stat = taste.categories[key];
                        const pct = stat.avg != null ? Math.max(0, Math.min(1, stat.avg / 5)) : 0;
                        return (
                            <View key={key} style={styles.catRow}>
                                <Text style={[styles.catLabel, { color: palette.textSecondary }]}>
                                    {label.toUpperCase()}
                                </Text>
                                <View style={styles.catBarWrap}>
                                    <View style={[styles.catTrack, { backgroundColor: palette.surfaceJournalHi }]}>
                                        <View
                                            style={[
                                                styles.catFill,
                                                { width: `${pct * 100}%`, backgroundColor: palette.primary },
                                            ]}
                                        />
                                    </View>
                                </View>
                                <Text style={[styles.catNum, { color: palette.text }]}>{fmt(stat.avg)}</Text>
                                <Text style={[styles.catN, { color: palette.textMuted }]}>
                                    {stat.n > 0 ? `n${stat.n}` : '—'}
                                </Text>
                            </View>
                        );
                    })}

                    {/* Cuisine top / bottom */}
                    {taste.top_cuisines.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                CUISINES YOU RATE HIGHEST
                            </Text>
                            {taste.top_cuisines.map((c) => (
                                <View key={`top-${c.cuisine}`} style={styles.cuisineRow}>
                                    <Text style={[styles.cuisineName, { color: palette.text }]} numberOfLines={1}>
                                        {c.cuisine}
                                    </Text>
                                    <Text style={[styles.cuisineNum, { color: palette.primary }]}>{c.avg.toFixed(1)}</Text>
                                    <Text style={[styles.cuisineN, { color: palette.textMuted }]}>{`n${c.n}`}</Text>
                                </View>
                            ))}
                        </>
                    ) : null}

                    {taste.bottom_cuisines.length > 0 && taste.top_cuisines.length > 1 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: Spacing.xl }]}>
                                RATE MORE CRITICALLY
                            </Text>
                            {taste.bottom_cuisines.map((c) => (
                                <View key={`bot-${c.cuisine}`} style={styles.cuisineRow}>
                                    <Text style={[styles.cuisineName, { color: palette.text }]} numberOfLines={1}>
                                        {c.cuisine}
                                    </Text>
                                    <Text style={[styles.cuisineNum, { color: palette.textSecondary }]}>{c.avg.toFixed(1)}</Text>
                                    <Text style={[styles.cuisineN, { color: palette.textMuted }]}>{`n${c.n}`}</Text>
                                </View>
                            ))}
                        </>
                    ) : null}

                    {/* Coverage line (reused from the taste band) */}
                    {coverageLine ? (
                        <Text style={[styles.coverage, { color: palette.textMuted }]}>{coverageLine}</Text>
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
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 20,
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
    editorial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 23,
        textAlign: 'center',
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.md,
    },
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
        marginTop: Spacing.md,
        marginBottom: Spacing.sm,
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
    },
    catN: {
        width: 30,
        textAlign: 'right',
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    cuisineRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
        paddingVertical: 8,
    },
    cuisineName: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
    },
    cuisineNum: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 18,
    },
    cuisineN: {
        width: 30,
        textAlign: 'right',
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    coverage: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
        marginTop: Spacing.xl,
    },
});
