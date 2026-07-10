/**
 * /import-digest — review-by-exception for a large Maps-list import (TICKET-152).
 *
 * These are the user's OWN curated pins (deterministic source), so everything
 * that resolved cleanly auto-saved. This is the POST-save surface: header tally,
 * exceptions (ghosts / gate misses) first with find-match / remove, then the full
 * imported list with a per-row replace · unpin · remove overflow. Row mutations
 * live-patch the wishlist + destination list (canonical snapshot → patch →
 * rollback → narrow invalidation) and write through to the manifest so the digest
 * stays consistent if re-opened from /import-progress.
 *
 * Data source is the manifest job (getImport(jobId).largeJob.items) — no server
 * read for the list itself; the row mutations hit live caches.
 *
 * Copy economy: functional labels in Manrope; the restaurant NAME (content) is
 * the only serif-italic. Theme tokens only.
 */
import React, { useMemo, useState, useCallback } from 'react';
import { Alert, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { getImport, setLargeJob, removeImport, type LargeImportJobItem } from '@/lib/importQueue';
import { partitionDigest, deriveCounts, isPinnedItem } from '@/lib/largeImportJob';
import { useRepointWishlistItem } from '@/hooks/wishlist/useRepointWishlistItem';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { PlacePickerModal, type PlacePickerResult } from '@/components/wishlist/PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ImportDigestScreen() {
    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    // Snapshot the job's static settings once.
    const job = useMemo(() => (jobId ? getImport(jobId)?.largeJob ?? null : null), [jobId]);
    const pinAll = job?.pinAll ?? true;
    const destListId = job?.destListId ?? null;

    // Working copy — mutations patch this and write through to the manifest.
    const [items, setItems] = useState<LargeImportJobItem[]>(() => job?.items ?? []);
    const [picker, setPicker] = useState<{ item: LargeImportJobItem } | null>(null);
    const [busy, setBusy] = useState(false);

    const repoint = useRepointWishlistItem(user?.id, jobId);
    const remove = useWishlistRemove(user?.id);
    const wishlistAdd = useWishlistAdd(user?.id);

    const { exceptions, imported } = useMemo(() => partitionDigest(items), [items]);
    const counts = useMemo(() => deriveCounts(items), [items]);

    // Write the working copy back to state AND through to the durable manifest so
    // re-entering the digest (from /import-progress) is consistent.
    const writeThrough = useCallback(
        (next: LargeImportJobItem[]) => {
            setItems(next);
            if (!jobId) return;
            const fresh = getImport(jobId);
            if (fresh?.largeJob) setLargeJob(jobId, { ...fresh.largeJob, items: next });
        },
        [jobId],
    );

    // Resolve a picker result to a REAL restaurant_id: a Napkin UUID is used
    // directly; a Google place id is upserted via places-search persist (the
    // picker's save path) before it can be pinned / list-routed.
    const resolvePick = useCallback(
        async (r: PlacePickerResult): Promise<{ id: string; name: string; city: string | null } | null> => {
            if (UUID_RE.test(r.id)) return { id: r.id, name: r.name, city: r.city };
            try {
                const res = await callEdgeFn<{ restaurant_id?: string | null }[] | { data?: { restaurant_id?: string | null }[] }>(
                    'places-search',
                    { body: { place_id: r.id, persist: true } },
                );
                const row = Array.isArray(res) ? res[0] : res?.data?.[0];
                const id = row?.restaurant_id;
                return id ? { id, name: r.name, city: r.city } : null;
            } catch {
                return null;
            }
        },
        [],
    );

    // List re-route helpers — the destination-list membership must follow a swap
    // (the wishlist `repoint` action never touches list_entries).
    const reRouteList = useCallback(
        async (oldId: string | null, newId: string) => {
            if (!destListId) return;
            if (oldId && oldId !== newId) {
                try {
                    await callEdgeFn('lists', { action: 'remove_entry', body: { list_id: destListId, restaurant_id: oldId } });
                } catch {
                    /* best-effort */
                }
            }
            try {
                await callEdgeFn('lists', { action: 'add_entries', body: { list_id: destListId, restaurant_ids: [newId] } });
            } catch {
                /* best-effort */
            }
        },
        [destListId],
    );

    // ── replace (find match) ───────────────────────────────────────────────
    const onPick = useCallback(
        async (r: PlacePickerResult) => {
            const target = picker?.item;
            setPicker(null);
            if (!target || !jobId) return;
            const snapshot = items;
            setBusy(true);
            try {
                const resolved = await resolvePick(r);
                if (!resolved) {
                    toast.show("couldn't find that place");
                    return;
                }
                const newId = resolved.id;
                const oldId = target.restaurant_id ?? null;
                const base: Partial<LargeImportJobItem> = {
                    restaurant_name: resolved.name,
                    restaurant_city: resolved.city,
                    external_id: null,
                    status: 'saved',
                    needsLook: false,
                };

                if (target.wishlist_id != null) {
                    // Pinned repoint — the TICKET-118 seam. Patch ids from the
                    // RESPONSE (the `merged` branch deletes item_id and returns a
                    // different id), never from the pre-call value.
                    const res = (await repoint.mutateAsync({
                        item_id: target.wishlist_id,
                        restaurant_id: newId,
                    })) as { id?: string; restaurant_id?: string };
                    await reRouteList(oldId, newId);
                    writeThrough(
                        patch(snapshot, target.client_nonce, {
                            ...base,
                            wishlist_id: res.id ?? target.wishlist_id,
                            restaurant_id: res.restaurant_id ?? newId,
                        }),
                    );
                } else if (target.restaurant_id != null) {
                    // List-only re-route (no wishlist row to repoint).
                    await reRouteList(oldId, newId);
                    writeThrough(patch(snapshot, target.client_nonce, { ...base, restaurant_id: newId }));
                } else {
                    // Failed spot never landed → fresh save.
                    let wishlist_id: string | null = null;
                    if (pinAll) {
                        const added = (await wishlistAdd.mutateAsync({ restaurant_id: newId })) as { id?: string };
                        wishlist_id = added?.id ?? null;
                    }
                    if (destListId) {
                        try {
                            await callEdgeFn('lists', {
                                action: 'add_entries',
                                body: { list_id: destListId, restaurant_ids: [newId] },
                            });
                        } catch {
                            /* best-effort */
                        }
                    }
                    writeThrough(patch(snapshot, target.client_nonce, { ...base, restaurant_id: newId, wishlist_id }));
                }

                if (destListId) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(destListId) });
                }
                toast.show(`fixed → ${resolved.name}`);
            } catch {
                writeThrough(snapshot); // rollback
                toast.show("couldn't fix — try again");
            } finally {
                setBusy(false);
            }
        },
        [picker, items, jobId, resolvePick, repoint, reRouteList, writeThrough, pinAll, destListId, wishlistAdd, queryClient, toast],
    );

    // ── unpin (pinned only — drops the wishlist pin, keeps the list entry) ──
    const handleUnpin = useCallback(
        (item: LargeImportJobItem) => {
            if (item.wishlist_id == null || !item.restaurant_id) return;
            const snapshot = items;
            // Becomes list-only (or drops from the digest when there's no list).
            writeThrough(
                destListId
                    ? patch(snapshot, item.client_nonce, { wishlist_id: null })
                    : snapshot.filter((i) => i.client_nonce !== item.client_nonce),
            );
            remove.mutate(item.restaurant_id, {
                onSuccess: () => toast.show(`unpinned ${item.restaurant_name ?? 'spot'}`),
                onError: () => {
                    writeThrough(snapshot);
                    toast.show("couldn't unpin — try again");
                },
            });
        },
        [items, destListId, writeThrough, remove, toast],
    );

    // ── remove (drops the pin AND the list entry) ──────────────────────────
    const handleRemove = useCallback(
        async (item: LargeImportJobItem) => {
            const snapshot = items;
            writeThrough(snapshot.filter((i) => i.client_nonce !== item.client_nonce));
            try {
                if (item.wishlist_id != null && item.restaurant_id) {
                    await remove.mutateAsync(item.restaurant_id);
                }
                if (destListId && item.restaurant_id) {
                    await callEdgeFn('lists', {
                        action: 'remove_entry',
                        body: { list_id: destListId, restaurant_id: item.restaurant_id },
                    });
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(destListId) });
                }
                toast.show(`removed ${item.restaurant_name ?? 'spot'}`);
            } catch {
                writeThrough(snapshot);
                toast.show("couldn't remove — try again");
            }
        },
        [items, destListId, writeThrough, remove, queryClient, toast],
    );

    // Per-row overflow — affordances branch on wishlist_id (M2).
    const openRowMenu = useCallback(
        (item: LargeImportJobItem) => {
            const pinned = isPinnedItem(item);
            Alert.alert(item.restaurant_name ?? 'this spot', undefined, [
                { text: 'replace', onPress: () => setPicker({ item }) },
                ...(pinned ? [{ text: 'unpin', onPress: () => handleUnpin(item) }] : []),
                { text: 'remove', style: 'destructive' as const, onPress: () => handleRemove(item) },
                { text: 'cancel', style: 'cancel' as const },
            ]);
        },
        [handleUnpin, handleRemove],
    );

    const done = () => {
        if (jobId) removeImport(jobId); // dismissing the digest finalizes the job
        router.back();
    };

    const headerLine =
        counts.needsLook > 0
            ? `${counts.imported} imported · ${counts.needsLook} need a look`
            : `${counts.imported} imported · all clean`;

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.header}>
                {/* Back = temporary leave (manifest survives, re-openable). */}
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBack} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: palette.text }]}>{job?.title ?? 'your map'}</Text>
                <Pressable onPress={done} hitSlop={12} style={styles.headerDone} accessibilityLabel="done">
                    <Text style={[styles.doneLabel, { color: palette.primary }]}>done</Text>
                </Pressable>
            </View>

            <Text style={[styles.tally, { color: palette.textMuted }]}>{headerLine}</Text>
            {busy ? <ActivityIndicator size="small" color={palette.primary} style={{ marginTop: Spacing.xs }} /> : null}

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: 22, paddingTop: Spacing.md, paddingBottom: insets.bottom + 40 }}
                showsVerticalScrollIndicator={false}
            >
                {items.length === 0 ? (
                    <View style={styles.emptyWrap}>
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>— nothing left here.</Text>
                    </View>
                ) : null}

                {/* Exceptions first — ghosts / gate misses / per-spot failures. */}
                {exceptions.length > 0 ? (
                    <>
                        <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>NEED A LOOK</Text>
                        {exceptions.map((it) => (
                            <View
                                key={it.client_nonce}
                                style={[styles.row, { backgroundColor: palette.card }, Shadow.subtle]}
                            >
                                <View style={styles.rowBody}>
                                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                        {it.restaurant_name ?? it.name}
                                    </Text>
                                    {it.address ? (
                                        <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                            {it.address}
                                        </Text>
                                    ) : null}
                                    <View style={styles.exceptionActions}>
                                        <Pressable onPress={() => setPicker({ item: it })} hitSlop={6} disabled={busy}>
                                            <Text style={[styles.action, { color: palette.primary }]}>find match</Text>
                                        </Pressable>
                                        <Text style={[styles.actionDot, { color: palette.textMuted }]}>·</Text>
                                        <Pressable onPress={() => handleRemove(it)} hitSlop={6} disabled={busy}>
                                            <Text style={[styles.action, { color: palette.textMuted }]}>remove</Text>
                                        </Pressable>
                                    </View>
                                </View>
                            </View>
                        ))}
                    </>
                ) : null}

                {/* Full imported list — per-row overflow. */}
                {imported.length > 0 ? (
                    <>
                        <Text style={[styles.sectionKicker, { color: palette.textMuted, marginTop: exceptions.length > 0 ? Spacing.lg : 0 }]}>
                            IMPORTED
                        </Text>
                        {imported.map((it) => (
                            <View
                                key={it.client_nonce}
                                style={[styles.row, { backgroundColor: palette.surfaceJournalLow }]}
                            >
                                <View style={styles.rowBody}>
                                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                        {it.restaurant_name ?? it.name}
                                    </Text>
                                    {it.restaurant_city ? (
                                        <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                            {it.restaurant_city}
                                        </Text>
                                    ) : null}
                                </View>
                                <Pressable
                                    onPress={() => openRowMenu(it)}
                                    hitSlop={10}
                                    disabled={busy}
                                    accessibilityLabel={`options for ${it.restaurant_name ?? 'this spot'}`}
                                >
                                    <Ionicons name="ellipsis-horizontal" size={20} color={palette.textMuted} />
                                </Pressable>
                            </View>
                        ))}
                    </>
                ) : null}
            </ScrollView>

            <PlacePickerModal
                visible={picker !== null}
                title="find the right place"
                subtitle={`replace ${picker?.item.restaurant_name ?? picker?.item.name ?? 'this spot'}`}
                initialQuery={[picker?.item.restaurant_name ?? picker?.item.name, picker?.item.address]
                    .filter(Boolean)
                    .join(' ')}
                busy={busy}
                onSelect={onPick}
                onDismiss={() => setPicker(null)}
                palette={palette}
            />
        </View>
    );
}

/** Immutable single-item patch by nonce (pure — keeps the optimistic snapshot intact). */
function patch(
    items: LargeImportJobItem[],
    nonce: string,
    fields: Partial<LargeImportJobItem>,
): LargeImportJobItem[] {
    return items.map((i) => (i.client_nonce === nonce ? { ...i, ...fields } : i));
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
        gap: 8,
    },
    headerBack: { width: 44, alignItems: 'flex-start' },
    headerDone: { width: 44, alignItems: 'flex-end' },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
    },
    doneLabel: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
    tally: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        textAlign: 'center',
        paddingHorizontal: 22,
    },
    emptyWrap: { paddingTop: 56, alignItems: 'center' },
    emptyText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        marginBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        marginBottom: Spacing.sm,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    name: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, lineHeight: 21 },
    meta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    exceptionActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    action: { fontFamily: 'Manrope_700Bold', fontSize: 12.5, letterSpacing: 0.2 },
    actionDot: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
});
