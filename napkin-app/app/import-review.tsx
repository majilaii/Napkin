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
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { track } from '@/lib/track';
import {
    getImport,
    setImportSpots,
    setImportDestinations,
    setImportMode,
    removeImport,
    pokeImportQueue,
    type PersistedImportSpot,
} from '@/lib/importQueue';
import { truncationNote } from '@/lib/importTruncation';
import { deleteAppGroupFile } from '@/modules/media-extract';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { PlacePickerModal, type PlacePickerResult } from '@/components/wishlist/PlacePickerModal';
import { ImportSourceCard } from '@/components/wishlist/ImportSourceCard';
import { ImportListPickerSheet } from '@/components/lists/ImportListPickerSheet';
import { importSourceLabel, manifestDisplaySource } from '@/components/wishlist/importSourceLabel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // TICKET-181: editable destinations. The wishlist pin defaults to the manifest's
    // pinWishlist (?? true — the base destination); lists are chosen here (the share
    // flow never picks them). Table destinations are NOT surfaced (v1) — they ride
    // untouched on the manifest and are never mutated by this editor.
    const { user } = useAuth();
    const { data: myLists = [] } = useMyLists(user?.id);
    // When the share pre-chose a table, the wishlist pin is LOCKED on: a table share
    // is a share OF the save (fn_save_import_spot mints both), so list-only + table
    // is not a representable state. The drain forces pin_wishlist=true on the table
    // fan-out for the same reason.
    const hasTableDestination = (manifest?.destinations?.tableIds?.length ?? 0) > 0;
    const [pinWishlist, setPinWishlist] = useState<boolean>(
        () => hasTableDestination || (manifest?.pinWishlist ?? true),
    );
    const [listIds, setListIds] = useState<string[]>(() => manifest?.destinations?.listIds ?? []);
    const [newListTitles, setNewListTitles] = useState<string[]>(
        () => manifest?.destinations?.newListTitles ?? [],
    );
    const [listSheetOpen, setListSheetOpen] = useState(false);

    const toggleList = useCallback(
        (id: string) =>
            setListIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
        [],
    );
    const addNewTitle = useCallback(
        (title: string) => setNewListTitles((prev) => [...prev, title]),
        [],
    );
    const removeNewTitle = useCallback(
        (title: string) => setNewListTitles((prev) => prev.filter((t) => t !== title)),
        [],
    );

    // Chips for the "saving to" card: chosen existing lists (name resolved) + new
    // titles. Tapping a list chip removes it. Serif italic — a list name is content.
    const listChips = useMemo(
        () => [
            ...listIds.map((id) => ({
                key: id,
                name: myLists.find((l) => l.id === id)?.title ?? 'list',
                onRemove: () => toggleList(id),
            })),
            ...newListTitles.map((t) => ({
                key: `new:${t}`,
                name: t,
                onRemove: () => removeNewTitle(t),
            })),
        ],
        [listIds, newListTitles, myLists, toggleList, removeNewTitle],
    );

    // Zero-destination guard: with the wishlist pin off AND no lists chosen, there's
    // nowhere for the spots to go — the save disables (the greyed button IS the
    // message; no murmur sentence). Tables aren't counted (not shown/editable here).
    const hasDestination = pinWishlist || listChips.length > 0;

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

    // TICKET-151: honesty line when a Maps list was capped (list_count > kept).
    // shownCount = the persisted candidate count — stable under untick/fix, so the
    // numerator doesn't drift as the user edits. Null (no line) for non-list / ≤20
    // imports; today Maps lists drain as auto, so this stays dead-quiet until the
    // TICKET-152 large-list review path lights it up.
    const truncationLine = useMemo(
        () => truncationNote(manifest?.listCount, manifest?.spots?.length ?? spots.length),
        [manifest, spots.length],
    );

    const handleSave = () => {
        if (!manifest || keptCount === 0 || !hasDestination) return;
        const kept = spots.filter((s) => ticked.has(s.candidate_id));
        // TICKET-088: how much human correction the extraction needed.
        const originalById = new Map(
            (manifest.spots ?? []).map((s) => [s.candidate_id, s]),
        );
        const fixedN = kept.filter((s) => {
            const o = originalById.get(s.candidate_id);
            return o && (o.restaurant_id !== s.restaurant_id || o.external_id !== s.external_id);
        }).length;
        track('import_review_edits', {
            kept_n: kept.length,
            removed_n: spots.length - kept.length,
            fixed_n: fixedN,
        });
        setImportSpots(manifest.jobId, kept); // prune to confirmed (incl. fixes)
        // TICKET-181: persist the edited destinations BEFORE the mode flip. The
        // drain-release below flips mode → 'auto' and re-pokes; if a crash lands
        // between the flip and this write, the re-drain must save to the EDITED
        // destinations (list-only pin + chosen lists), never the stale ones. Tables
        // ride untouched (setImportDestinations never writes tableIds).
        setImportDestinations(manifest.jobId, { listIds, newListTitles, pinWishlist });
        setImportMode(manifest.jobId, 'auto'); // release for the normal save path
        pokeImportQueue(); // kick the drain now
        toast.show(`saving ${keptCount} ${keptCount === 1 ? 'spot' : 'spots'}…`);
        router.back();
    };

    const handleDiscard = () => {
        if (!manifest) {
            router.back();
            return;
        }
        // TICKET-180: confirm, and NAME the source so you know what you're binning.
        Alert.alert(
            `discard this import ${importSourceLabel(manifestDisplaySource(manifest))}?`,
            "this can't be undone.",
            [
                { text: 'keep', style: 'cancel' },
                {
                    text: 'discard',
                    style: 'destructive',
                    onPress: () => {
                        removeImport(manifest.jobId);
                        // Don't leak the copied .mov in the App-Group container (no GC sweep).
                        if (manifest.videoPath) {
                            try {
                                deleteAppGroupFile(manifest.videoPath);
                            } catch {
                                /* best-effort */
                            }
                        }
                        router.back();
                    },
                },
            ],
        );
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

            {/* TICKET-180: source card — verify WHERE it came from before approving.
                Carries the "from TikTok · @handle · watch again" identity, so the
                title below drops to the bare count (no duplicated source phrase). */}
            <View style={styles.sourceCardWrap}>
                <ImportSourceCard manifest={manifest} />
            </View>

            {/* Batch-grammar header: "12 spots" */}
            <View style={styles.header}>
                <Text style={[styles.title, { color: palette.text }]}>
                    {`${spots.length} ${spots.length === 1 ? 'spot' : 'spots'}`}
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
                {/* TICKET-151: "first 20 of 117" when the source list was truncated. */}
                {truncationLine ? (
                    <Text style={[styles.subtitle, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                        {truncationLine}
                    </Text>
                ) : null}
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
                                {/* TICKET-181: the ⇄ repoint icon → a quiet "wrong?"
                                    text (same handler). Taupe at rest, terracotta while
                                    this spot's fix panel is open. */}
                                <Pressable
                                    onPress={() => setFixTarget(s)}
                                    hitSlop={8}
                                    accessibilityLabel={`fix ${s.restaurant_name ?? 'this spot'}`}
                                >
                                    <Text
                                        style={[
                                            styles.wrong,
                                            {
                                                color:
                                                    fixTarget?.candidate_id === s.candidate_id
                                                        ? palette.primary
                                                        : palette.textMuted,
                                            },
                                        ]}
                                    >
                                        wrong?
                                    </Text>
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

                {/* TICKET-181: "saving to" — the wishlist pin toggle + a chip per chosen
                    list + a dashed "+ list". Replaces the old "→ wishlist · 1 list"
                    murmur. Chips: outlineVariant border, terracotta-soft fill when on;
                    list NAMES are serif italic (content), functional labels Manrope. */}
                <Text style={[styles.savingKicker, { color: palette.textMuted }]}>SAVING TO</Text>
                <View style={styles.chipRow}>
                    {/* wishlist toggle — locked on when a table share rides this import */}
                    <Pressable
                        onPress={hasTableDestination ? undefined : () => setPinWishlist((v) => !v)}
                        disabled={hasTableDestination}
                        style={[
                            styles.chip,
                            { borderColor: palette.outlineVariant },
                            pinWishlist
                                ? { backgroundColor: palette.primaryMuted }
                                : { backgroundColor: 'transparent' },
                            // Locked (table share rides this import): still checked,
                            // dimmed so the dead tap reads as non-interactive.
                            hasTableDestination ? { opacity: 0.6 } : null,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: pinWishlist, disabled: hasTableDestination }}
                        accessibilityLabel="save to wishlist"
                    >
                        {pinWishlist ? (
                            <Ionicons name="checkmark" size={14} color={palette.primary} />
                        ) : null}
                        <Text
                            style={[
                                styles.chipLabel,
                                { color: pinWishlist ? palette.primary : palette.textMuted },
                            ]}
                        >
                            wishlist
                        </Text>
                    </Pressable>

                    {/* one chip per chosen list — tap to remove */}
                    {listChips.map((c) => (
                        <Pressable
                            key={c.key}
                            onPress={c.onRemove}
                            style={[
                                styles.chip,
                                { backgroundColor: palette.primaryMuted, borderColor: palette.outlineVariant },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`remove ${c.name}`}
                        >
                            <Ionicons name="checkmark" size={14} color={palette.primary} />
                            <Text style={[styles.chipName, { color: palette.primary }]} numberOfLines={1}>
                                {c.name}
                            </Text>
                        </Pressable>
                    ))}

                    {/* dashed + list */}
                    <Pressable
                        onPress={() => setListSheetOpen(true)}
                        style={[styles.chip, styles.addChip, { borderColor: palette.outlineVariant }]}
                        accessibilityRole="button"
                        accessibilityLabel="add to a list"
                    >
                        <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>+ list</Text>
                    </Pressable>
                </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 14, backgroundColor: palette.background }]}>
                <Pressable
                    onPress={handleSave}
                    disabled={keptCount === 0 || !hasDestination}
                    style={[
                        styles.cta,
                        { backgroundColor: keptCount === 0 || !hasDestination ? palette.outlineVariant : palette.primary },
                    ]}
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

            {/* TICKET-181: the "+ list" picker — deferred multi-select; selection is
                committed onto the manifest at save (setImportDestinations). Plain
                sibling Modal (this screen is a pushed card, not a Modal). */}
            <ImportListPickerSheet
                visible={listSheetOpen}
                onClose={() => setListSheetOpen(false)}
                userId={user?.id}
                selectedListIds={listIds}
                newListTitles={newListTitles}
                onToggleList={toggleList}
                onAddNewTitle={addNewTitle}
                onRemoveNewTitle={removeNewTitle}
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
    sourceCardWrap: { paddingHorizontal: 22, paddingBottom: Spacing.md },
    header: { paddingHorizontal: 22, paddingBottom: Spacing.md },
    title: { ...Type.screenTitle },
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
    wrong: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12.5,
        letterSpacing: 0.2,
    },
    tick: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savingKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        marginTop: Spacing.md,
        marginBottom: Spacing.sm,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderWidth: 1,
        borderRadius: Radius.full,
        paddingVertical: 7,
        paddingHorizontal: 13,
        maxWidth: '100%',
    },
    addChip: {
        borderStyle: 'dashed',
    },
    chipLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    chipName: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 14.5,
        flexShrink: 1,
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
