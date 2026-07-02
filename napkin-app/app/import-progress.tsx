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
import { useAuth } from '@/providers/AuthProvider';
import { useActiveImports, type ActiveImport } from '@/hooks/wishlist/useActiveImports';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import { importSourceLabel, relativeTime } from '@/components/wishlist/importSourceLabel';
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
    const { user } = useAuth();
    const active = useActiveImports();
    // Completed batches — every import stays reachable here for fix/prune.
    const { data: recent } = useRecentImports(user?.id, 10);
    const recentBatches = recent ?? [];

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
                {active.length === 0 && recentBatches.length === 0 ? (
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

                {/* Earlier — completed batches; tap in to fix a wrong pin or prune */}
                {recentBatches.length > 0 ? (
                    <>
                        <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>
                            EARLIER
                        </Text>
                        {recentBatches.map((b) => (
                            <Pressable
                                key={b.job_id}
                                onPress={() => router.push(`/imports/${b.job_id}` as any)}
                                style={({ pressed }) => [
                                    styles.recentRow,
                                    { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.7 : 1 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`open import of ${b.item_count} spots`}
                            >
                                <Ionicons
                                    name={b.source?.type === 'tiktok' ? 'logo-tiktok' : 'download-outline'}
                                    size={16}
                                    color={palette.textSecondary}
                                />
                                <View style={styles.recentBody}>
                                    <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
                                        {`${b.item_count} ${b.item_count === 1 ? 'spot' : 'spots'} ${importSourceLabel(b.source)}`}
                                    </Text>
                                    {b.preview_names.length > 0 ? (
                                        <Text style={[styles.recentNames, { color: palette.textMuted }]} numberOfLines={1}>
                                            {b.preview_names.join(' · ')}
                                        </Text>
                                    ) : null}
                                </View>
                                <Text style={[styles.recentTime, { color: palette.textMuted }]}>
                                    {relativeTime(b.created_at)}
                                </Text>
                                <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
                            </Pressable>
                        ))}
                    </>
                ) : null}
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
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        marginTop: Spacing.md,
        marginBottom: Spacing.sm,
    },
    recentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: Spacing.xs,
    },
    recentBody: { flex: 1, minWidth: 0, gap: 2 },
    recentTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 13.5 },
    recentNames: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 12.5 },
    recentTime: { fontFamily: 'Manrope_500Medium', fontSize: 11, flexShrink: 0 },
});
