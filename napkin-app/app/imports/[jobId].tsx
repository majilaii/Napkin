/**
 * /imports/[jobId] — import batch detail.
 *
 * The spots that one import (a video / link) dropped into the wishlist, so the
 * user can review what landed and prune the misses (or file them into a list)
 * instead of them vanishing into hundreds of saves.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useImportBatch, type ImportBatchItem } from '@/hooks/wishlist/useImportBatch';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useRepointWishlistItem } from '@/hooks/wishlist/useRepointWishlistItem';
import { useAddSpotToBatch } from '@/hooks/wishlist/useAddSpotToBatch';
import { useToast } from '@/providers/ToastProvider';
import { AddToListSheet } from '@/components/lists';
import { PlacePickerModal, type PlacePickerResult } from '@/components/wishlist/PlacePickerModal';
import { queryKeys } from '@/lib/queryKeys';
import {
    importSourceLabel,
    spotCountLabel,
    relativeTime,
} from '@/components/wishlist/importSourceLabel';

export default function ImportBatchScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const toast = useToast();

    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const { data, isLoading } = useImportBatch(jobId);

    const remove = useWishlistRemove(user?.id);
    const repoint = useRepointWishlistItem(user?.id, jobId);
    const addSpot = useAddSpotToBatch(user?.id, jobId);
    // Optimistically pruned restaurant_ids (instant row removal).
    const [removed, setRemoved] = useState<Set<string>>(() => new Set());
    const [addTarget, setAddTarget] = useState<{ id: string; name: string } | null>(null);
    // Amend (b48): fix a mis-resolved spot, or add a missed one.
    const [picker, setPicker] = useState<{ kind: 'fix'; item: ImportBatchItem } | { kind: 'add' } | null>(null);

    const handlePick = useCallback(
        (r: PlacePickerResult) => {
            const p = picker;
            setPicker(null);
            if (!p) return;
            if (p.kind === 'fix') {
                repoint.mutate(
                    { item_id: p.item.id, restaurant_id: r.id },
                    {
                        onSuccess: () => toast.show(`fixed → ${r.name}`),
                        onError: () => toast.show("couldn't fix — try again"),
                    },
                );
            } else {
                addSpot.mutate(
                    { restaurant_id: r.id },
                    {
                        onSuccess: () => toast.show(`added ${r.name}`),
                        onError: () => toast.show("couldn't add — try again"),
                    },
                );
            }
        },
        [picker, repoint, addSpot, toast],
    );

    const job = data?.job ?? null;
    const allItems = data?.items ?? [];
    const items = allItems.filter(
        (it) => it.restaurant != null && !removed.has(it.restaurant.id),
    );

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
        ? `${importSourceLabel(job.source)} · ${spotCountLabel(items.length)} · ${relativeTime(job.created_at)}`
        : '';

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                </Pressable>
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : !job ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyText, { color: palette.text }]}>not found</Text>
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(it) => it.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
                    ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
                    ListHeaderComponent={
                        <View style={styles.header}>
                            <Text style={[styles.title, { color: palette.text }]}>this import</Text>
                            <Text style={[styles.subtitle, { color: palette.textMuted }]}>{subtitle}</Text>
                            <Pressable
                                onPress={() => setPicker({ kind: 'add' })}
                                hitSlop={8}
                                style={styles.addRow}
                                accessibilityLabel="add a missing spot"
                            >
                                <Ionicons name="add" size={18} color={palette.primary} />
                                <Text style={[styles.addLabel, { color: palette.primary }]}>add a spot</Text>
                            </Pressable>
                        </View>
                    }
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                                — no spots left in this import
                            </Text>
                        </View>
                    }
                    renderItem={({ item: it }) => {
                        const r = it.restaurant!;
                        const meta = [r.city, r.cuisine].filter(Boolean).join(' · ');
                        return (
                            <View style={[styles.row, { backgroundColor: palette.card }, Shadow.subtle]}>
                                <Pressable
                                    onPress={() => router.push(`/restaurant/${r.id}` as any)}
                                    style={({ pressed }) => [styles.rowBody, { opacity: pressed ? 0.75 : 1 }]}
                                    accessibilityLabel={`open ${r.name}`}
                                >
                                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                        {r.name}
                                    </Text>
                                    {meta ? (
                                        <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                            {meta}
                                        </Text>
                                    ) : null}
                                </Pressable>

                                <View style={styles.actions}>
                                    <Pressable
                                        onPress={() => setPicker({ kind: 'fix', item: it })}
                                        hitSlop={8}
                                        accessibilityLabel={`fix ${r.name}`}
                                    >
                                        <Ionicons name="swap-horizontal-outline" size={20} color={palette.textMuted} />
                                    </Pressable>
                                    <Pressable
                                        onPress={() => setAddTarget({ id: r.id, name: r.name })}
                                        hitSlop={8}
                                        accessibilityLabel={`add ${r.name} to a list`}
                                    >
                                        <Ionicons name="list-outline" size={20} color={palette.textMuted} />
                                    </Pressable>
                                    <Pressable
                                        onPress={() => handleRemove(it)}
                                        hitSlop={8}
                                        accessibilityLabel={`remove ${r.name} from wishlist`}
                                    >
                                        <Ionicons name="close-circle-outline" size={20} color={palette.textMuted} />
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
                title={picker?.kind === 'fix' ? 'fix this spot' : 'add a spot'}
                subtitle={
                    picker?.kind === 'fix'
                        ? `replace ${picker.item.restaurant?.name ?? 'this spot'}`
                        : 'search and add it to this import'
                }
                initialQuery={picker?.kind === 'fix' ? (picker.item.restaurant?.name ?? '') : ''}
                busy={repoint.isPending || addSpot.isPending}
                onSelect={handlePick}
                onDismiss={() => setPicker(null)}
                palette={palette}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: { paddingHorizontal: 22, paddingBottom: Spacing.xs },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl },
    header: { paddingTop: Spacing.sm, paddingBottom: Spacing.md },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 26, lineHeight: 30 },
    subtitle: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginTop: 6 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.md },
    addLabel: { fontFamily: 'Manrope_700Bold', fontSize: 13, letterSpacing: 0.3 },
    listContent: { paddingHorizontal: 22 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
    },
    rowBody: { flex: 1, gap: 2 },
    name: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, lineHeight: 21 },
    meta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexShrink: 0 },
    empty: { paddingTop: Spacing.xxl, alignItems: 'center' },
    emptyText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18, lineHeight: 24 },
});
