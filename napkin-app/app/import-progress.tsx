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
import { Alert, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useActiveImports, type ActiveImport } from '@/hooks/wishlist/useActiveImports';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import { useHasImported } from '@/hooks/wishlist/useHasImported';
import { ImportActivationHub } from '@/components/import-education';
import { importSourceIcon, importSourceLabel, relativeTime } from '@/components/wishlist/importSourceLabel';
import { retryImport, removeImport, setImportMode, setImportSpots, pokeImportQueue } from '@/lib/importQueue';
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
    // Full activation hub until a first import lands, then the compact standing row.
    const hasImported = useHasImported(user?.id);

    const toast = useToast();

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

    // Bulk actions across every batch awaiting review (founder: entering each
    // batch to save it is busywork when several pile up).
    const reviewBatches = active.filter((m) => m.phase === 'review');
    const reviewSpotTotal = reviewBatches.reduce((sum, m) => sum + m.spotCount, 0);
    // Approve-all saves the review DEFAULTS — warned spots ("called overrated")
    // default to unticked, so they're excluded here just like in the screen.
    const keptFor = (m: ActiveImport) =>
        (m.manifest.spots ?? []).filter((s) => s.stance !== 'warned');
    const approveSpotTotal = reviewBatches.reduce((sum, m) => sum + keptFor(m).length, 0);

    const approveAll = () => {
        for (const m of reviewBatches) {
            const spots = m.manifest.spots ?? [];
            const kept = keptFor(m);
            if (kept.length === 0 && spots.length > 0) {
                discard(m); // nothing default-kept — same as unticking everything
                continue;
            }
            if (kept.length !== spots.length) setImportSpots(m.jobId, kept);
            setImportMode(m.jobId, 'auto'); // release; spots already persisted
        }
        pokeImportQueue();
        toast.show(`saving ${approveSpotTotal} ${approveSpotTotal === 1 ? 'spot' : 'spots'}…`);
    };

    const discardAll = () => {
        Alert.alert(
            `discard ${reviewBatches.length} imports?`,
            `${reviewSpotTotal} unsaved ${reviewSpotTotal === 1 ? 'spot' : 'spots'} — this can't be undone.`,
            [
                { text: 'keep them', style: 'cancel' },
                {
                    text: 'discard all',
                    style: 'destructive',
                    onPress: () => {
                        for (const m of reviewBatches) discard(m);
                    },
                },
            ],
        );
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
                {/* Standing activation hub — the durable way to learn/repeat saving.
                    Full teaches the gesture (subsumes the old empty-state copy);
                    compact is a quiet standing row once the user has imported. */}
                <View style={styles.hubWrap}>
                    <ImportActivationHub
                        variant={hasImported ? 'compact' : 'full'}
                        showHubLink={false}
                        palette={palette}
                    />
                </View>

                {active.length === 0 && recentBatches.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            — nothing importing right now.
                        </Text>
                    </View>
                ) : (
                    // One row grammar for everything — same as EARLIER below.
                    active.map((m) => {
                        const spotNames = (m.manifest.spots ?? [])
                            .map((s) => s.restaurant_name)
                            .filter(Boolean)
                            .slice(0, 3) as string[];
                        const isWorking = m.phase === 'reading' || m.phase === 'saving';
                        const isReview = m.phase === 'review';
                        return (
                            <Pressable
                                key={m.jobId}
                                disabled={!isReview}
                                onPress={
                                    isReview
                                        ? () => router.push(`/import-review?jobId=${m.jobId}` as any)
                                        : undefined
                                }
                                style={({ pressed }) => [
                                    styles.recentRow,
                                    { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.7 : 1 },
                                ]}
                                accessibilityRole={isReview ? 'button' : undefined}
                                accessibilityLabel={
                                    isReview ? `review ${m.spotCount} spots` : PHASE_COPY[m.phase]
                                }
                            >
                                {isWorking ? (
                                    <ActivityIndicator size="small" color={palette.primary} />
                                ) : (
                                    <Ionicons
                                        name={isReview ? 'sparkles-outline' : 'alert-circle-outline'}
                                        size={16}
                                        color={isReview ? palette.primary : palette.textMuted}
                                    />
                                )}
                                <View style={styles.recentBody}>
                                    <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
                                        {isReview || m.phase === 'saving'
                                            ? `${m.spotCount} ${m.spotCount === 1 ? 'spot' : 'spots'} · ${PHASE_COPY[m.phase]}`
                                            : PHASE_COPY[m.phase]}
                                    </Text>
                                    {spotNames.length > 0 ? (
                                        <Text style={[styles.recentNames, { color: palette.textMuted }]} numberOfLines={1}>
                                            {spotNames.join(' · ')}
                                        </Text>
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
                                {isReview ? (
                                    <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
                                ) : null}
                            </Pressable>
                        );
                    })
                )}

                {/* Bulk actions — only when several batches await review */}
                {reviewBatches.length >= 2 ? (
                    <View style={styles.bulkRow}>
                        <Pressable onPress={approveAll} hitSlop={8} accessibilityRole="button">
                            <Text style={[styles.bulkAction, { color: palette.primary }]}>
                                {`approve all ${approveSpotTotal}`}
                            </Text>
                        </Pressable>
                        <Text style={[styles.bulkDot, { color: palette.textMuted }]}>·</Text>
                        <Pressable onPress={discardAll} hitSlop={8} accessibilityRole="button">
                            <Text style={[styles.bulkAction, { color: palette.textMuted }]}>discard all</Text>
                        </Pressable>
                    </View>
                ) : null}

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
                                    name={importSourceIcon(b.source)}
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
    hubWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.md },
    emptyWrap: { paddingTop: 56, alignItems: 'center', gap: 8 },
    emptyText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
    failRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    failAction: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    failDot: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
    bulkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 10,
    },
    bulkAction: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    bulkDot: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
    },
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
