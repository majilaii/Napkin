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
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
import { mintImportMatchCorrection } from '@/lib/importResolution';
import { reconcileV2LargeImportManifest } from '@/lib/completenessReconciliation';
import { queryKeys } from '@/lib/queryKeys';
import {
    getImportForUser,
    importManifestProtocol,
    setLargeJob,
    removeImport,
    type LargeImportJobItem,
} from '@/lib/importQueue';
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
    const manifest = useMemo(
        () => (jobId ? getImportForUser(jobId, user?.id) : null),
        [jobId, user?.id],
    );
    const job = manifest?.largeJob ?? null;
    const isV2 = manifest ? importManifestProtocol(manifest) === 'v2' : false;
    const pinAll = job?.pinAll ?? true;

    // Working copy — mutations patch this and write through to the manifest.
    const [items, setItems] = useState<LargeImportJobItem[]>(() => job?.items ?? []);
    const [destListId, setDestListId] = useState<string | null>(() => job?.destListId ?? null);
    const [picker, setPicker] = useState<{ item: LargeImportJobItem } | null>(null);
    const [busy, setBusy] = useState(false);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const hydratedManifestKeyRef = useRef<string | null>(null);

    // Auth can resolve after this route mounts. Hydrate once per owner/import
    // identity when the scoped manifest becomes available, and clear immediately
    // if ownership disappears; repeated renders/status writes must not reset edits.
    useEffect(() => {
        if (!manifest || !job || !user?.id) {
            hydratedManifestKeyRef.current = null;
            setItems([]);
            setDestListId(null);
            setPicker(null);
            return;
        }
        const manifestKey = `${user.id}:${jobId ?? ''}:${manifest.importNonce}`;
        if (hydratedManifestKeyRef.current === manifestKey) return;
        hydratedManifestKeyRef.current = manifestKey;
        setItems(job.items);
        setDestListId(job.destListId);
        setPicker(null);
    }, [job, jobId, manifest, user?.id]);

    const repoint = useRepointWishlistItem(user?.id, jobId);
    const remove = useWishlistRemove(user?.id);
    const wishlistAdd = useWishlistAdd(user?.id);

    const { exceptions, completing, imported } = useMemo(() => partitionDigest(items), [items]);
    const counts = useMemo(() => deriveCounts(items), [items]);

    useEffect(() => {
        if (!isV2 || !jobId || !job?.serverJobId || !user?.id) return;
        let cancelled = false;
        const reconcile = async () => {
            try {
                const next = await reconcileV2LargeImportManifest(jobId, user.id);
                if (!cancelled && next) {
                    setItems(next.items);
                    setDestListId(next.destListId);
                }
            } catch {
                // Best-effort polling; the next tick/foreground retries against
                // the same durable manifest and server ledger.
            }
        };
        void reconcile();
        const interval = setInterval(() => void reconcile(), 5_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isV2, job?.serverJobId, jobId, user?.id]);

    // Write the working copy back to state AND through to the durable manifest so
    // re-entering the digest (from /import-progress) is consistent.
    const writeThrough = useCallback(
        (next: LargeImportJobItem[]) => {
            setItems(next);
            if (!jobId) return;
            const fresh = getImportForUser(jobId, user?.id);
            if (fresh?.largeJob) setLargeJob(jobId, { ...fresh.largeJob, items: next });
        },
        [jobId, user?.id],
    );

    const persistDestinationListId = useCallback(
        (listId: string) => {
            setDestListId(listId);
            if (!jobId) return;
            const fresh = getImportForUser(jobId, user?.id);
            if (fresh?.largeJob) setLargeJob(jobId, { ...fresh.largeJob, destListId: listId });
        },
        [jobId, user?.id],
    );

    // Resolve a picker result to a REAL restaurant_id: a Napkin UUID is used
    // directly; a Google place id is upserted via places-search persist (the
    // picker's save path) before it can be pinned / list-routed.
    const resolvePick = useCallback(
        async (
            r: PlacePickerResult,
            expectedOwnerId: string | null | undefined,
        ): Promise<{ id: string; name: string; city: string | null } | null> => {
            if (UUID_RE.test(r.id)) return { id: r.id, name: r.name, city: r.city };
            try {
                const res = await callEdgeFn<{ restaurant_id?: string | null }[] | { data?: { restaurant_id?: string | null }[] }>(
                    'places-search',
                    {
                        body: {
                            place_id: r.external_id ?? r.id,
                            persist: true,
                            ...(expectedOwnerId ? { expected_owner_id: expectedOwnerId } : {}),
                        },
                    },
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

    const ensureDestinationList = useCallback(async (): Promise<string | null> => {
        if (!job?.destListTitle) return null;
        if (destListId) return destListId;

        const title = job.destListTitle.trim().slice(0, 60);
        if (!title) throw new Error('The destination list title is empty');
        const mine =
            (await callEdgeFn<{ id: string; title: string }[]>('lists', {
                action: 'list_mine',
            })) ?? [];
        const existing = mine.find(
            (list) => list.title.trim().toLowerCase() === title.toLowerCase(),
        );
        const listId = existing?.id ??
            (await callEdgeFn<{ id?: string }>('lists', {
                action: 'create',
                body: { title },
            })).id;
        if (!listId) throw new Error('Could not create the destination list');
        persistDestinationListId(listId);
        return listId;
    }, [destListId, job?.destListTitle, persistDestinationListId]);

    // ── replace (find match) ───────────────────────────────────────────────
    const onPick = useCallback(
        async (r: PlacePickerResult) => {
            const target = picker?.item;
            if (!target || !jobId || !manifest) return;
            const snapshot = items;
            let durable = snapshot;
            setBusy(true);
            setPickerError(null);
            try {
                const chosenExternalId = r.external_id ?? (UUID_RE.test(r.id) ? null : r.id);
                if (isV2 && !chosenExternalId) {
                    throw new Error('The selected place has no provider id');
                }
                const expectedOwnerId = manifest.userId;
                if (isV2 && (!expectedOwnerId || expectedOwnerId !== user?.id)) {
                    throw new Error('The import owner is no longer signed in');
                }
                if (isV2 && target.status === 'failed' && !target.completenessItemId) {
                    throw new Error('The exhausted queue item has not been hydrated');
                }
                const resolutionId = isV2
                    ? await mintImportMatchCorrection({
                          import_nonce: manifest.importNonce,
                          prior_resolution_id: target.resolution_id ?? null,
                          chosen_external_id: chosenExternalId!,
                          expected_owner_id: expectedOwnerId!,
                      })
                    : target.resolution_id ?? null;

                if (isV2 && target.status === 'failed') {
                    // Correct the original server item instead of creating client-only
                    // side effects. Its immutable pending destinations (including a
                    // not-yet-created list) are then fulfilled through the nonce ledger.
                    await callEdgeFn('restaurant-completeness', {
                        action: 'correct',
                        body: {
                            item_id: target.completenessItemId!,
                            resolution_id: resolutionId,
                        },
                    });
                    writeThrough(
                        patch(snapshot, target.client_nonce, {
                            restaurant_name: r.name,
                            restaurant_city: r.city,
                            resolution_id: resolutionId,
                            external_id: chosenExternalId,
                            status: 'queued',
                            wishlist_id: null,
                            listRouted: job?.destListTitle ? false : target.listRouted,
                            needsLook: false,
                        }),
                    );
                    setPicker(null);
                    void reconcileV2LargeImportManifest(jobId, user!.id);
                    return;
                }

                const resolved = await resolvePick(r, expectedOwnerId);
                if (!resolved) {
                    setPickerError("couldn't find that place");
                    return;
                }
                const newId = resolved.id;
                const oldId = target.restaurant_id ?? null;
                const base: Partial<LargeImportJobItem> = {
                    restaurant_name: resolved.name,
                    restaurant_city: resolved.city,
                    resolution_id: resolutionId,
                    external_id: null,
                    status: 'saved',
                    needsLook: false,
                };

                const wantsList = Boolean(job?.destListTitle);
                const routedListId = wantsList ? await ensureDestinationList() : null;
                if (wantsList && !routedListId) {
                    throw new Error('Could not hydrate the destination list');
                }

                // Retire the old list effect before changing the row's restaurant id.
                // This ordering makes every confirmed step representable in the
                // manifest: a retry can resume from `listRouted:false` without losing
                // the old id needed for cleanup or resurrecting a stale route.
                const listAlreadyCorrect = Boolean(
                    routedListId && target.listRouted === true && oldId === newId,
                );
                if (
                    routedListId &&
                    target.listRouted === true &&
                    oldId &&
                    oldId !== newId
                ) {
                    await callEdgeFn('lists', {
                        action: 'remove_entry',
                        body: { list_id: routedListId, restaurant_id: oldId },
                    });
                    durable = patch(durable, target.client_nonce, {
                        listRouted: false,
                        needsLook: true,
                    });
                    writeThrough(durable);
                }

                if (target.wishlist_id != null) {
                    // Pinned repoint — the TICKET-118 seam. Patch ids from the
                    // RESPONSE (the `merged` branch deletes item_id and returns a
                    // different id), never from the pre-call value.
                    const res = (await repoint.mutateAsync({
                        item_id: target.wishlist_id,
                        restaurant_id: newId,
                    })) as { id?: string; restaurant_id?: string };
                    durable = patch(durable, target.client_nonce, {
                        ...base,
                        wishlist_id: res.id ?? target.wishlist_id,
                        restaurant_id: res.restaurant_id ?? newId,
                        listRouted: wantsList ? listAlreadyCorrect : target.listRouted,
                        needsLook: wantsList && !listAlreadyCorrect,
                    });
                    writeThrough(durable);
                } else {
                    // No live wishlist route (list-only OR exhausted). A private
                    // queue ghost id does not imply that any destination landed,
                    // so recreate each selected destination explicitly.
                    let wishlist_id: string | null = null;
                    if (pinAll) {
                        const added = (await wishlistAdd.mutateAsync({ restaurant_id: newId })) as { id?: string };
                        wishlist_id = added?.id ?? null;
                    }
                    durable = patch(durable, target.client_nonce, {
                        ...base,
                        restaurant_id: newId,
                        wishlist_id,
                        listRouted: wantsList ? listAlreadyCorrect : target.listRouted,
                        needsLook: wantsList && !listAlreadyCorrect,
                    });
                    writeThrough(durable);
                }

                if (routedListId && !listAlreadyCorrect) {
                    await callEdgeFn('lists', {
                        action: 'add_entries',
                        body: { list_id: routedListId, restaurant_ids: [newId] },
                    });
                    durable = patch(durable, target.client_nonce, {
                        listRouted: true,
                        needsLook: false,
                    });
                    writeThrough(durable);
                }

                if (routedListId) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(routedListId) });
                }
                setPicker(null);
                toast.show(`fixed → ${resolved.name}`);
            } catch {
                // Preserve every confirmed side effect. Retrying resumes from this
                // checkpoint instead of restoring ids/routes that no longer exist.
                writeThrough(durable);
                const durableTarget = durable.find(
                    (item) => item.client_nonce === target.client_nonce,
                );
                if (durableTarget) setPicker({ item: durableTarget });
                setPickerError("couldn't verify that match — try again");
            } finally {
                setBusy(false);
            }
        },
        [picker, jobId, manifest, items, isV2, job?.destListTitle, ensureDestinationList, resolvePick, repoint, writeThrough, pinAll, wishlistAdd, queryClient, toast, user?.id],
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
            let durable = snapshot;
            setBusy(true);
            try {
                if (isV2 && item.status === 'failed') {
                    if (!item.completenessItemId) {
                        throw new Error('The exhausted queue item has not been hydrated');
                    }
                    // Dismiss server-first. A local-only delete would leave the same
                    // exhausted item on the global retry surface, where it could later
                    // be retried into duplicate destination effects.
                    await callEdgeFn('restaurant-completeness', {
                        action: 'dismiss',
                        body: { item_id: item.completenessItemId },
                    });
                    durable = snapshot.filter((i) => i.client_nonce !== item.client_nonce);
                    writeThrough(durable);
                    toast.show(`removed ${item.restaurant_name ?? 'spot'}`);
                    return;
                }

                if (item.wishlist_id != null && !item.restaurant_id) {
                    throw new Error('Cannot remove a hydrated wishlist route without its restaurant id');
                }
                const shouldRemoveList = destListId != null && item.listRouted !== false;
                if (shouldRemoveList && !item.restaurant_id) {
                    throw new Error('Cannot remove a hydrated list route without its live ids');
                }

                // Apply and persist each independent side effect in turn. If the
                // second one fails, the manifest describes the first success rather
                // than resurrecting stale ids with a whole-snapshot rollback.
                if (shouldRemoveList && destListId && item.restaurant_id) {
                    await callEdgeFn('lists', {
                        action: 'remove_entry',
                        body: { list_id: destListId, restaurant_id: item.restaurant_id },
                    });
                    durable = patch(durable, item.client_nonce, {
                        listRouted: false,
                        needsLook: item.wishlist_id != null,
                    });
                    writeThrough(durable);
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(destListId) });
                }

                if (item.wishlist_id != null && item.restaurant_id) {
                    await remove.mutateAsync(item.restaurant_id);
                    durable = patch(durable, item.client_nonce, {
                        wishlist_id: null,
                        needsLook: false,
                    });
                    writeThrough(durable);
                }

                durable = durable.filter((candidate) => candidate.client_nonce !== item.client_nonce);
                writeThrough(durable);
                toast.show(`removed ${item.restaurant_name ?? 'spot'}`);
            } catch {
                // `durable` may already contain one confirmed effect. Never restore
                // the stale pre-call snapshot; idempotent remove endpoints make a
                // second tap finish any unknown/lost-response outcome safely.
                writeThrough(durable);
                toast.show("couldn't finish removing — try again");
            } finally {
                setBusy(false);
            }
        },
        [items, isV2, destListId, writeThrough, remove, queryClient, toast],
    );

    // Per-row overflow — affordances branch on wishlist_id (M2).
    const openRowMenu = useCallback(
        (item: LargeImportJobItem) => {
            const pinned = isPinnedItem(item);
            Alert.alert(item.restaurant_name ?? 'this spot', undefined, [
                {
                    text: 'replace',
                    onPress: () => {
                        setPickerError(null);
                        setPicker({ item });
                    },
                },
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

    const headerLine = [
        `${counts.imported} imported`,
        counts.queued > 0 ? `${counts.queued} completing` : null,
        counts.needsLook > 0 ? `${counts.needsLook} need a look` : null,
        counts.queued === 0 && counts.needsLook === 0 ? 'all clean' : null,
    ]
        .filter(Boolean)
        .join(' · ');

    if (!manifest || !job) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyText, { color: palette.textMuted }]}>— nothing to review.</Text>
                </View>
            </View>
        );
    }

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
                                        <Pressable
                                            onPress={() => {
                                                setPickerError(null);
                                                setPicker({ item: it });
                                            }}
                                            hitSlop={6}
                                            disabled={busy}
                                            style={styles.rowActionTarget}
                                        >
                                            <Text style={[styles.action, { color: palette.primary }]}>find match</Text>
                                        </Pressable>
                                        <Text style={[styles.actionDot, { color: palette.textMuted }]}>·</Text>
                                        <Pressable
                                            onPress={() => handleRemove(it)}
                                            hitSlop={6}
                                            disabled={busy}
                                            style={styles.rowActionTarget}
                                        >
                                            <Text style={[styles.action, { color: palette.textMuted }]}>remove</Text>
                                        </Pressable>
                                    </View>
                                </View>
                            </View>
                        ))}
                    </>
                ) : null}

                {completing.length > 0 ? (
                    <>
                        <Text
                            style={[
                                styles.sectionKicker,
                                {
                                    color: palette.textMuted,
                                    marginTop: exceptions.length > 0 ? Spacing.lg : 0,
                                },
                            ]}
                        >
                            COMPLETING
                        </Text>
                        {completing.map((it) => (
                            <View
                                key={it.client_nonce}
                                style={[styles.row, { backgroundColor: palette.surfaceJournalLow }]}
                            >
                                <View style={styles.rowBody}>
                                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                        {it.restaurant_name ?? it.name}
                                    </Text>
                                    <Text style={[styles.meta, { color: palette.textMuted }]}>completing…</Text>
                                </View>
                            </View>
                        ))}
                    </>
                ) : null}

                {/* Full imported list — per-row overflow. */}
                {imported.length > 0 ? (
                    <>
                        <Text
                            style={[
                                styles.sectionKicker,
                                {
                                    color: palette.textMuted,
                                    marginTop:
                                        exceptions.length > 0 || completing.length > 0
                                            ? Spacing.lg
                                            : 0,
                                },
                            ]}
                        >
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
                                    style={styles.overflowTarget}
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
                errorText={pickerError}
                onSelect={onPick}
                onDismiss={() => {
                    setPicker(null);
                    setPickerError(null);
                }}
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
    rowActionTarget: { minHeight: 40, justifyContent: 'center' },
    overflowTarget: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    action: { fontFamily: 'Manrope_700Bold', fontSize: 12.5, letterSpacing: 0.2 },
    actionDot: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
});
