/**
 * /imports/[jobId] — import batch detail.
 *
 * The spots that one import (a video / link) dropped into the wishlist, so the
 * user can review what landed and prune the misses (or file them into a list)
 * instead of them vanishing into hundreds of saves.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useImportBatch, type ImportBatchItem } from '@/hooks/wishlist/useImportBatch';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useRepointWishlistItem } from '@/hooks/wishlist/useRepointWishlistItem';
import { useAddSpotToBatch } from '@/hooks/wishlist/useAddSpotToBatch';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';
import { useToast } from '@/providers/ToastProvider';
import { AddToListSheet } from '@/components/lists';
import { PlacePickerModal, type PlacePickerResult } from '@/components/wishlist/PlacePickerModal';
import { queryKeys } from '@/lib/queryKeys';
import { useExhaustedCompletenessItems } from '@/hooks/imports/useCompletenessRetries';
import { ImportChecks } from '@/components/wishlist/ImportChecks';
import {
    importSourceLabel,
    spotCountLabel,
    relativeTime,
} from '@/components/wishlist/importSourceLabel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ImportBatchScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const toast = useToast();

    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const { data, isLoading, isError, isRefetching, refetch } = useImportBatch(jobId);
    const checks = useExhaustedCompletenessItems(user?.id, { pollMs: 60_000 });
    const batchChecks = checks.data.filter((item) => item.job_id === jobId);
    const refreshPlaces = () => { void refetch(); void checks.refetch(); };

    const remove = useWishlistRemove(user?.id);
    const repoint = useRepointWishlistItem(user?.id, jobId);
    const addSpot = useAddSpotToBatch(user?.id, jobId);
    const { mutateAsync: persistPlace, isPending: persisting } = usePersistPlace();
    // Optimistically pruned restaurant_ids (instant row removal).
    const [removed, setRemoved] = useState<Set<string>>(() => new Set());
    const [addTarget, setAddTarget] = useState<{ id: string; name: string } | null>(null);
    // Amend (b48): fix a mis-resolved spot, or add a missed one.
    const [picker, setPicker] = useState<{ kind: 'fix'; item: ImportBatchItem } | { kind: 'add' } | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const pickInFlight = useRef(false);
    const pickerBusy = persisting || repoint.isPending || addSpot.isPending;

    const handlePick = useCallback(
        async (r: PlacePickerResult) => {
            const p = picker;
            if (!p || pickerBusy || pickInFlight.current) return;
            pickInFlight.current = true;
            setPickerError(null);
            try {
                const restaurantId = UUID_RE.test(r.id)
                    ? r.id
                    : await persistPlace(r.external_id ?? r.id);
                if (p.kind === 'fix') {
                    await repoint.mutateAsync({
                        item_id: p.item.id,
                        restaurant_id: restaurantId,
                    });
                } else {
                    await addSpot.mutateAsync({ restaurant_id: restaurantId });
                }
                setPicker(null);
                toast.show(p.kind === 'fix' ? `fixed → ${r.name}` : `added ${r.name}`);
            } catch {
                setPickerError(p.kind === 'fix'
                    ? "couldn't fix — try again"
                    : "couldn't add — try again");
            } finally {
                pickInFlight.current = false;
            }
        },
        [picker, pickerBusy, persistPlace, repoint, addSpot, toast],
    );

    const job = data?.job ?? null;
    const allItems = data?.items ?? [];
    const items = allItems.filter(
        (it) => it.restaurant != null && !removed.has(it.restaurant.id),
    );
    const checkingIds = new Set(batchChecks.map((item) => item.restaurant_id));
    const savedItems = items.filter((item) => !checkingIds.has(item.restaurant!.id));

    const handleRemove = useCallback(
        (it: ImportBatchItem) => {
            const r = it.restaurant;
            if (!r) return;
            setRemoved((prev) => new Set(prev).add(r.id));
            remove.mutate(r.id, {
                onSuccess: () => {
                    toast.show(`removed ${r.name}`);
                    if (jobId) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.detail(jobId) });
                    }
                    if (user?.id) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(user.id) });
                    }
                },
                onError: () => {
                    setRemoved((prev) => {
                        const next = new Set(prev);
                        next.delete(r.id);
                        return next;
                    });
                    toast.show("couldn't remove — try again");
                },
            });
        },
        [remove, toast, jobId, user?.id, queryClient],
    );

    const subtitle = job
        ? [job.source ? importSourceLabel(job.source) : null, spotCountLabel(items.length), relativeTime(job.created_at)].filter(Boolean).join(' · ')
        : '';

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={24} color={palette.textMuted} />
                    <Text style={[Type.body, { color: palette.textMuted }]}>back</Text>
                </Pressable>
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : isError ? (
                <View style={styles.center}>
                    <Text style={[Type.body, { color: palette.text }]}>Could not load this clip.</Text>
                    <Pressable onPress={() => void refetch()} style={styles.addRow} accessibilityRole="button">
                        <Text style={[Type.body, { color: palette.primary }]}>try again</Text>
                    </Pressable>
                </View>
            ) : !job ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyText, { color: palette.text }]}>This clip could not be found.</Text>
                </View>
            ) : (
                <FlatList
                    data={savedItems}
                    refreshing={isRefetching || checks.isRefetching}
                    onRefresh={refreshPlaces}
                    keyExtractor={(it) => it.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
                    ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
                    ListHeaderComponent={
                        <View style={styles.header}>
                            <Text style={[styles.title, { color: palette.text }]}>Review clip</Text>
                            <Text style={[styles.subtitle, { color: palette.textMuted }]}>{subtitle}</Text>
                            {user ? <ImportChecks key={`${user.id}:${jobId}`} userId={user.id}
                                items={batchChecks} savedRestaurantIds={new Set(items.map((item) => item.restaurant!.id))}
                                palette={palette} loading={checks.isLoading} error={checks.isError}
                                hasMore={!!checks.hasNextPage} loadingMore={checks.isFetchingNextPage}
                                onRetryLoad={() => void checks.refetch()}
                                onRefreshPlaces={refreshPlaces}
                                refreshingPlaces={isRefetching || checks.isRefetching}
                                onLoadMore={() => void checks.fetchNextPage()} /> : null}
                            {savedItems.length > 0 ? <Text style={[Type.sectionKicker, styles.savedHeading, { color: palette.textMuted }]}>saved places</Text> : null}
                        </View>
                    }
                    ListFooterComponent={
                        <View style={styles.footer}>
                            <Pressable
                                onPress={() => {
                                    setPickerError(null);
                                    setPicker({ kind: 'add' });
                                }}
                                hitSlop={8}
                                style={styles.addRow}
                                accessibilityLabel="add a missing place"
                                accessibilityRole="button"
                            >
                                <Ionicons name="add" size={18} color={palette.primary} />
                                <Text style={[styles.addLabel, { color: palette.primary }]}>add a missing place</Text>
                            </Pressable>
                        </View>
                    }
                    ListEmptyComponent={items.length === 0 && batchChecks.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                                No saved places in this clip.
                            </Text>
                        </View>
                    ) : null}
                    renderItem={({ item: it }) => {
                        const r = it.restaurant!;
                        const meta = [r.city, r.cuisine].filter(Boolean).join(' · ');
                        return (
                            <View style={[styles.row, { backgroundColor: palette.card }, Shadow.subtle]}>
                                <Pressable
                                    onPress={() => router.push(`/restaurant/${r.id}` as any)}
                                    style={({ pressed }) => [styles.rowBody, { opacity: pressed ? 0.75 : 1 }]}
                                    accessibilityLabel={`view place: ${r.name}`}
                                    accessibilityRole="button"
                                >
                                    <Text style={[styles.name, { color: palette.text }]}>
                                        {r.name}
                                    </Text>
                                    {meta ? (
                                        <Text style={[styles.meta, { color: palette.textMuted }]}>
                                            {meta}
                                        </Text>
                                    ) : null}
                                    <Text style={[Type.metadata, styles.viewLabel, { color: palette.primary }]}>view place →</Text>
                                </Pressable>

                                <View style={styles.actions}>
                                    <Pressable
                                        onPress={() => {
                                            setPickerError(null);
                                            setPicker({ kind: 'fix', item: it });
                                        }}
                                        accessibilityLabel={`change place for ${r.name}`}
                                        accessibilityRole="button"
                                        style={styles.textAction}
                                    >
                                        <Text style={[Type.metadata, { color: palette.primary }]}>change place</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => setAddTarget({ id: r.id, name: r.name })}
                                        accessibilityLabel={`add to list: ${r.name}`}
                                        accessibilityRole="button"
                                        style={styles.textAction}
                                    >
                                        <Text style={[Type.metadata, { color: palette.primary }]}>add to list</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => handleRemove(it)}
                                        accessibilityLabel={`remove pin for ${r.name}`}
                                        accessibilityRole="button"
                                        style={styles.textAction}
                                    >
                                        <Text style={[Type.metadata, { color: palette.textMuted }]}>remove pin</Text>
                                    </Pressable>
                                </View>
                            </View>
                        );
                    }}
                />
            )}

            {user ? (
                <AddToListSheet
                    visible={addTarget !== null}
                    onClose={() => setAddTarget(null)}
                    userId={user.id}
                    restaurantId={addTarget?.id}
                    restaurantName={addTarget?.name}
                />
            ) : null}

            <PlacePickerModal
                visible={picker !== null}
                title={picker?.kind === 'fix' ? 'Change saved place' : 'Add a missing place'}
                subtitle={
                    picker?.kind === 'fix'
                        ? `replace ${picker.item.restaurant?.name ?? 'this spot'}`
                        : 'search and add it to this import'
                }
                initialQuery={picker?.kind === 'fix' ? (picker.item.restaurant?.name ?? '') : ''}
                city={picker?.kind === 'fix' ? picker.item.restaurant?.city : undefined}
                busy={pickerBusy}
                errorText={pickerError}
                onSelect={handlePick}
                onDismiss={() => {
                    if (pickerBusy) return;
                    setPicker(null);
                    setPickerError(null);
                }}
                palette={palette}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
    backButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: Spacing.xs },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl },
    header: { paddingTop: Spacing.sm, paddingBottom: Spacing.md },
    title: { ...Type.screenTitle },
    subtitle: { ...Type.metadata, marginTop: Spacing.xs },
    addRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: Spacing.xs },
    addLabel: { ...Type.body },
    listContent: { paddingHorizontal: Spacing.lg },
    savedHeading: { marginTop: Spacing.lg },
    footer: { paddingTop: Spacing.md },
    row: {
        gap: Spacing.sm,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
    },
    rowBody: { gap: Spacing.xs },
    name: { ...Type.editorialTitle },
    meta: { ...Type.metadata },
    viewLabel: { marginTop: Spacing.xs },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'space-between' },
    textAction: { minHeight: 44, justifyContent: 'center' },
    empty: { paddingTop: Spacing.xxl, alignItems: 'center' },
    emptyText: { ...Type.body },
});
