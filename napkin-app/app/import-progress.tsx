/**
 * /import-progress — live status of in-flight imports (b48).
 *
 * "I shared a video — what's happening to it?" Each active import shows its phase
 * (reading → saving / review → done) and, once resolved, the spots being saved.
 * Review-mode imports get a "review" CTA → /import-review; failed ones get
 * try-again / discard. Completed batches live in the wishlist's "recently
 * imported" band + /imports/[jobId].
 *
 * Heirloom Journal: warm paper, italic serif names, terracotta CTA, no hard borders.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActiveImports, type ActiveImport } from '@/hooks/wishlist/useActiveImports';
import { retryImport, removeImport } from '@/lib/importQueue';
import { deleteAppGroupFile } from '@/modules/media-extract';

const PHASE_COPY: Record<ActiveImport['phase'], string> = {
    reading: 'reading the share…',
    saving: 'saving your spots…',
    review: 'ready to review',
    failed: "couldn't import",
};

export default function ImportProgressScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const active = useActiveImports();

    const discard = (m: ActiveImport) => {
        removeImport(m.jobId);
        if (m.manifest.videoPath) {
            try {
                deleteAppGroupFile(m.manifest.videoPath);
            } catch {
                /* best-effort */
            }
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBack} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: palette.text }]}>imports</Text>
                <View style={styles.headerBack} />
            </View>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 40, paddingTop: Spacing.sm }}
                showsVerticalScrollIndicator={false}
            >
                {active.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            — nothing importing right now.
                        </Text>
                        <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                            {"share a video or link to napkin and it'll show up here."}
                        </Text>
                    </View>
                ) : (
                    active.map((m) => {
                        const spotNames = (m.manifest.spots ?? [])
                            .map((s) => s.restaurant_name)
                            .filter(Boolean)
                            .slice(0, 4) as string[];
                        const extra = m.spotCount - spotNames.length;
                        return (
                            <View
                                key={m.jobId}
                                style={[styles.card, { backgroundColor: palette.surfaceJournalLow }]}
                            >
                                <View style={styles.cardTop}>
                                    {m.phase === 'reading' || m.phase === 'saving' ? (
                                        <ActivityIndicator size="small" color={palette.primary} />
                                    ) : (
                                        <Ionicons
                                            name={m.phase === 'review' ? 'sparkles-outline' : 'alert-circle-outline'}
                                            size={18}
                                            color={m.phase === 'failed' ? palette.textMuted : palette.primary}
                                        />
                                    )}
                                    <Text style={[styles.cardPhase, { color: palette.text }]}>
                                        {m.phase === 'review' || m.phase === 'saving'
                                            ? `${m.spotCount} ${m.spotCount === 1 ? 'spot' : 'spots'} · ${PHASE_COPY[m.phase]}`
                                            : PHASE_COPY[m.phase]}
                                    </Text>
                                </View>

                                {spotNames.length > 0 ? (
                                    <Text style={[styles.cardSpots, { color: palette.textMuted }]} numberOfLines={2}>
                                        {spotNames.join(' · ')}
                                        {extra > 0 ? ` · +${extra} more` : ''}
                                    </Text>
                                ) : null}

                                {m.phase === 'review' ? (
                                    <Pressable
                                        onPress={() => router.push(`/import-review?jobId=${m.jobId}` as any)}
                                        style={[styles.cta, { backgroundColor: palette.primary }]}
                                    >
                                        <Text style={[styles.ctaLabel, { color: '#fffdf8' }]}>review spots</Text>
                                    </Pressable>
                                ) : null}

                                {m.phase === 'failed' ? (
                                    <View style={styles.failRow}>
                                        <Pressable onPress={() => retryImport(m.jobId)} hitSlop={6}>
                                            <Text style={[styles.failAction, { color: palette.primary }]}>try again</Text>
                                        </Pressable>
                                        <Text style={[styles.failDot, { color: palette.textMuted }]}>·</Text>
                                        <Pressable onPress={() => discard(m)} hitSlop={6}>
                                            <Text style={[styles.failAction, { color: palette.textMuted }]}>discard</Text>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xs,
    },
    headerBack: { width: 32, alignItems: 'flex-start' },
    headerTitle: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22 },
    emptyWrap: { paddingTop: 80, alignItems: 'center', gap: 8 },
    emptyText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
    emptyHint: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
    card: {
        borderRadius: 16,
        padding: 16,
        marginBottom: Spacing.sm,
        gap: 10,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardPhase: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
    cardSpots: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14, lineHeight: 20 },
    cta: {
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    ctaLabel: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
    failRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    failAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    failDot: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
});
