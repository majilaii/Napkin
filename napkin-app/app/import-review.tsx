/**
 * /import-review — confirm the spots from a review-mode import (b47, restyled
 * 2026-07-02 to the batch-screen grammar the founder liked).
 *
 * Pre-save gate: the app resolved the import in the background and PERSISTED
 * the spots, but held the save. This screen shows "12 spots from TikTok" with
 * the same rows as /imports/[jobId] — each spot can be FIXED (place picker,
 * prefilled with the wrong name) or unticked — then one save releases the
 * manifest: prune to kept spots, flip mode → 'auto', poke the drain (the
 * normal save+route path — no duplicated save logic here).
 */
import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToast } from '@/providers/ToastProvider';
import {
    getImport,
    setImportSpots,
    setImportMode,
    removeImport,
    pokeImportQueue,
    type PersistedImportSpot,
} from '@/lib/importQueue';
import { deleteAppGroupFile } from '@/modules/media-extract';
import { PlacePickerModal, type PlacePickerResult } from '@/components/wishlist/PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceLabelFor(kind: 'video' | 'url' | undefined, url: string | undefined): string {
    if (kind === 'url' && url && /tiktok\.com/i.test(url)) return 'from TikTok';
    if (kind === 'url') return 'from a link';
    return 'from a video';
}

export default function ImportReviewScreen() {
    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();

    // Snapshot the manifest once — the drain won't touch a held review manifest.
    const manifest = useMemo(() => (jobId ? getImport(jobId) : null), [jobId]);

    // Local working copy: fixes edit rows in place before the save prunes.
    const [spots, setSpots] = useState<PersistedImportSpot[]>(() => manifest?.spots ?? []);
    // 086c: warned spots ("most overrated…") start unticked — visible so the
    // user can override, never saved by default.
    const [ticked, setTicked] = useState<Set<string>>(
        () =>
            new Set(
                (manifest?.spots ?? [])
                    .filter((s) => s.stance !== 'warned')
                    .map((s) => s.candidate_id),
            ),
    );
    const [fixTarget, setFixTarget] = useState<PersistedImportSpot | null>(null);

    const toggle = (id: string) =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    // Fix a mis-resolved spot BEFORE it saves: swap the row's restaurant.
    // Picker ids are either Napkin UUIDs (persisted) or Google place ids
    // (ghosts) — the manifest carries a field for each; the save path
    // upserts ghosts from `place`.
    const handleFixPick = useCallback(
        (r: PlacePickerResult) => {
            const target = fixTarget;
            setFixTarget(null);
            if (!target) return;
            const isNapkinId = UUID_RE.test(r.id);
            setSpots((prev) =>
                prev.map((s) =>
                    s.candidate_id === target.candidate_id
                        ? {
                              ...s,
                              restaurant_id: isNapkinId ? r.id : null,
                              external_id: isNapkinId ? null : r.id,
                              restaurant_name: r.name,
                              restaurant_city: r.city ?? null,
                              place: isNapkinId
                                  ? null
                                  : {
                                        external_id: r.id,
                                        name: r.name,
                                        location: { locality: r.city ?? undefined },
                                        cuisine: r.cuisine ?? null,
                                    },
                          }
                        : s,
                ),
            );
            setTicked((prev) => new Set(prev).add(target.candidate_id));
            toast.show(`fixed → ${r.name}`);
        },
        [fixTarget, toast],
    );

    const keptCount = ticked.size;

    const destSummary = useMemo(() => {
        const d = manifest?.destinations;
        const parts: string[] = ['wishlist'];
        if (d?.listIds?.length || d?.newListTitles?.length) {
            const n = (d.listIds?.length ?? 0) + (d.newListTitles?.length ?? 0);
            parts.push(`${n} ${n === 1 ? 'list' : 'lists'}`);
        }
        const tableCount = d?.tableIds?.length ?? 0;
        if (tableCount > 0) parts.push(tableCount === 1 ? 'a table' : `${tableCount} tables`);
        return parts.join(' · ');
    }, [manifest]);

    const handleSave = () => {
        if (!manifest || keptCount === 0) return;
        const kept = spots.filter((s) => ticked.has(s.candidate_id));
        setImportSpots(manifest.jobId, kept); // prune to confirmed (incl. fixes)
        setImportMode(manifest.jobId, 'auto'); // release for the normal save path
        pokeImportQueue(); // kick the drain now
        toast.show(`saving ${keptCount} ${keptCount === 1 ? 'spot' : 'spots'}…`);
        router.back();
    };

    const handleDiscard = () => {
        if (manifest) {
            removeImport(manifest.jobId);
            // Don't leak the copied .mov in the App-Group container (no GC sweep).
            if (manifest.videoPath) {
                try {
                    deleteAppGroupFile(manifest.videoPath);
                } catch {
                    /* best-effort */
                }
            }
        }
        router.back();
    };

    if (!manifest || spots.length === 0) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                        <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>
                <View style={styles.emptyWrap}>
                    <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 18 }]}>
                        — nothing to review.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                </Pressable>
            </View>

            {/* Batch-grammar header: "12 spots from TikTok" */}
            <View style={styles.header}>
                <Text style={[styles.title, { color: palette.text }]}>
                    {`${spots.length} ${spots.length === 1 ? 'spot' : 'spots'} ${sourceLabelFor(manifest.kind, manifest.url)}`}
                </Text>
                <View style={styles.subtitleRow}>
                    <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                        fix or untick, then save
                    </Text>
                    <Pressable
                        onPress={() =>
                            setTicked(
                                keptCount === spots.length
                                    ? new Set()
                                    : new Set(spots.map((s) => s.candidate_id)),
                            )
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.tickAll, { color: palette.primary }]}>
                            {keptCount === spots.length ? 'untick all' : 'tick all'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 170 }}
                showsVerticalScrollIndicator={false}
            >
                {spots.map((s) => {
                    const on = ticked.has(s.candidate_id);
                    return (
                        <View
                            key={s.candidate_id}
                            style={[
                                styles.row,
                                { backgroundColor: palette.card, opacity: on ? 1 : 0.45 },
                                Shadow.subtle,
                            ]}
                        >
                            <Pressable
                                onPress={() => toggle(s.candidate_id)}
                                style={styles.rowBody}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: on }}
                                accessibilityLabel={`keep ${s.restaurant_name ?? 'unnamed spot'}`}
                            >
                                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                    {s.restaurant_name ?? 'unnamed spot'}
                                </Text>
                                {s.restaurant_city || s.stance === 'warned' ? (
                                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                        {[
                                            s.restaurant_city,
                                            s.stance === 'warned' ? 'called overrated' : null,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </Text>
                                ) : null}
                            </Pressable>

                            <View style={styles.actions}>
                                <Pressable
                                    onPress={() => setFixTarget(s)}
                                    hitSlop={8}
                                    accessibilityLabel={`fix ${s.restaurant_name ?? 'this spot'}`}
                                >
                                    <Ionicons name="swap-horizontal-outline" size={20} color={palette.textMuted} />
                                </Pressable>
                                <Pressable
                                    onPress={() => toggle(s.candidate_id)}
                                    hitSlop={8}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: on }}
                                    accessibilityLabel={on ? 'untick' : 'keep'}
                                >
                                    <View
                                        style={[
                                            styles.tick,
                                            on
                                                ? { backgroundColor: palette.primary, borderColor: palette.primary }
                                                : { borderColor: palette.outlineVariant },
                                        ]}
                                    >
                                        {on ? <Ionicons name="checkmark" size={14} color="#fffdf8" /> : null}
                                    </View>
                                </Pressable>
                            </View>
                        </View>
                    );
                })}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 14, backgroundColor: palette.background }]}>
                <Text style={[styles.dest, { color: palette.textMuted }]}>{`→ ${destSummary}`}</Text>
                <Pressable
                    onPress={handleSave}
                    disabled={keptCount === 0}
                    style={[styles.cta, { backgroundColor: keptCount === 0 ? palette.outlineVariant : palette.primary }]}
                >
                    <Text style={[styles.ctaLabel, { color: '#fffdf8' }]}>
                        {keptCount === 0 ? 'keep at least one' : `save ${keptCount} ${keptCount === 1 ? 'spot' : 'spots'}`}
                    </Text>
                </Pressable>
                <Pressable onPress={handleDiscard} hitSlop={8} style={styles.discard}>
                    <Text style={[styles.discardLabel, { color: palette.textMuted }]}>discard import</Text>
                </Pressable>
            </View>

            <PlacePickerModal
                visible={fixTarget !== null}
                title="fix this spot"
                subtitle={`replace ${fixTarget?.restaurant_name ?? 'this spot'}`}
                initialQuery={fixTarget?.restaurant_name ?? ''}
                onSelect={handleFixPick}
                onDismiss={() => setFixTarget(null)}
                palette={palette}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: { paddingHorizontal: 22, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 80,
    },
    header: { paddingHorizontal: 22, paddingBottom: Spacing.md },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 26, lineHeight: 30 },
    subtitleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: 6,
    },
    subtitle: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
    tickAll: { fontFamily: 'Manrope_700Bold', fontSize: 12.5, letterSpacing: 0.2 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        marginBottom: Spacing.sm,
    },
    rowBody: { flex: 1, gap: 2 },
    name: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, lineHeight: 21 },
    meta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexShrink: 0 },
    tick: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        paddingTop: 12,
        gap: 10,
    },
    dest: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
    },
    cta: {
        height: 52,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
        letterSpacing: 0.3,
    },
    discard: {
        alignSelf: 'center',
        paddingVertical: 4,
    },
    discardLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
