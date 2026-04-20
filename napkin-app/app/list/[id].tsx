/**
 * List detail screen — /list/[id]
 *
 * Shows the list's header (title, author, badges, share/edit buttons) and entries.
 * - Ranked lists use DraggableFlatList for drag-and-drop reordering (owner only).
 * - Unranked lists use a plain FlatList.
 * - 404 state (private list not owned by caller) shows a "not found" UI.
 *
 * Deep-link: diningjournalapp://list/{id}
 */
import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    ActivityIndicator,
    Pressable,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useList } from '@/hooks/lists/useList';
import { useRemoveFromList } from '@/hooks/lists/useRemoveFromList';
import { useAddToList } from '@/hooks/lists/useAddToList';
import { useUpdateListEntryNote } from '@/hooks/lists/useUpdateListEntryNote';
import { useReorderListEntry } from '@/hooks/lists/useReorderListEntry';
import { useToast } from '@/providers/ToastProvider';
import { ListDetailHeader, ListEntryRow } from '@/components/lists';
import type { ListEntry } from '@/hooks/lists/useList';

export default function ListDetailScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { id } = useLocalSearchParams<{ id: string }>();
    const { data: result, isLoading } = useList(id);

    const removeFromList = useRemoveFromList(user?.id);
    const addToList = useAddToList(user?.id);
    const updateNote = useUpdateListEntryNote();
    const reorderEntry = useReorderListEntry(id ?? '');
    const toast = useToast();

    const [dragDisabled, setDragDisabled] = useState(false);

    const list = result?.data?.list ?? null;
    const rawEntries = result?.data?.entries ?? [];
    const entries = React.useMemo(() => rawEntries, [result?.data?.entries]);
    const ownerProfile = result?.data?.owner_profile ?? null;
    const isNotFound = result?.isNotFound ?? false;
    const isOwner = !!user && !!list && list.owner_id === user.id;

    const handleRemove = useCallback(
        (entry: ListEntry) => {
            removeFromList.mutate(
                { list_id: entry.list_id, restaurant_id: entry.restaurant_id },
            );
            toast.show(`Removed ${entry.restaurant.name}`, {
                label: 'Undo',
                onPress: () => {
                    addToList.mutate({
                        list_id: entry.list_id,
                        restaurant_id: entry.restaurant_id,
                        note: entry.note ?? undefined,
                    });
                },
            });
        },
        [removeFromList, addToList, toast],
    );

    const handleNoteChange = useCallback(
        (entry: ListEntry, note: string | null) => {
            updateNote.mutate({
                list_id: entry.list_id,
                entry_id: entry.id,
                note,
            });
        },
        [updateNote],
    );

    const handleDragEnd = useCallback(
        ({ data: reordered, to }: { data: ListEntry[]; from: number; to: number }) => {
            if (!id) return;
            const movedEntry = reordered[to];
            if (!movedEntry) return;

            setDragDisabled(true);
            reorderEntry.mutate(
                {
                    list_id: id,
                    entry_id: movedEntry.id,
                    new_index: to,
                    currentEntries: entries,
                },
                {
                    onSettled: () => setDragDisabled(false),
                },
            );
        },
        [id, entries, reorderEntry],
    );

    const renderEntry = useCallback(
        (entry: ListEntry, index: number, drag?: () => void) => (
            <ListEntryRow
                key={entry.id}
                entry={entry}
                rank={list?.ranked ? index + 1 : undefined}
                isOwner={isOwner}
                isRanked={list?.ranked ?? false}
                isDragDisabled={dragDisabled || reorderEntry.isPending}
                onPress={() =>
                    router.push({
                        pathname: '/restaurant/[id]',
                        params: { id: entry.restaurant_id },
                    })
                }
                onRemove={() => handleRemove(entry)}
                onNoteChange={(note) => handleNoteChange(entry, note)}
                drag={drag}
            />
        ),
        [list, isOwner, dragDisabled, reorderEntry.isPending, router, handleRemove, handleNoteChange],
    );

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                </View>

                {/* Loading */}
                {isLoading && (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                )}

                {/* Not found */}
                {!isLoading && isNotFound && (
                    <View style={styles.center}>
                        <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                            Not found
                        </Text>
                        <Text style={[Type.body, { color: palette.textMuted, marginTop: Spacing.sm, textAlign: 'center' }]}>
                            This list is private or does not exist.
                        </Text>
                    </View>
                )}

                {/* Content */}
                {!isLoading && list && ownerProfile && (
                    <>
                        {isOwner && list.ranked ? (
                            <DraggableFlatList
                                data={entries}
                                keyExtractor={(item) => item.id}
                                onDragEnd={handleDragEnd}
                                ListHeaderComponent={
                                    <ListDetailHeader
                                        list={list}
                                        entryCount={entries.length}
                                        ownerProfile={ownerProfile}
                                        isOwner={isOwner}
                                        onEdit={() =>
                                            router.push({
                                                pathname: '/list/[id]/edit',
                                                params: { id: list.id },
                                            })
                                        }
                                    />
                                }
                                renderItem={({ item, getIndex, drag }: RenderItemParams<ListEntry>) =>
                                    renderEntry(item, getIndex() ?? 0, drag)
                                }
                                contentContainerStyle={[
                                    styles.listContent,
                                    { paddingBottom: insets.bottom + Spacing.xxl },
                                ]}
                                ItemSeparatorComponent={() => <View style={{ height: Spacing.xs }} />}
                            />
                        ) : (
                            <FlatList
                                data={entries}
                                keyExtractor={(item) => item.id}
                                ListHeaderComponent={
                                    <ListDetailHeader
                                        list={list}
                                        entryCount={entries.length}
                                        ownerProfile={ownerProfile}
                                        isOwner={isOwner}
                                        onEdit={() =>
                                            router.push({
                                                pathname: '/list/[id]/edit',
                                                params: { id: list.id },
                                            })
                                        }
                                    />
                                }
                                renderItem={({ item, index }) => renderEntry(item, index)}
                                contentContainerStyle={[
                                    styles.listContent,
                                    { paddingBottom: insets.bottom + Spacing.xxl },
                                ]}
                                ItemSeparatorComponent={() => <View style={{ height: Spacing.xs }} />}
                            />
                        )}
                    </>
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
    listContent: {
        paddingHorizontal: Spacing.lg,
    },
});
