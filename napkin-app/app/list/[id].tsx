import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useList,
    useToggleListSave,
    type ListEntry,
} from '@/hooks/lists';
import { useRemoveFromList } from '@/hooks/lists/useRemoveFromList';
import { useAddToList } from '@/hooks/lists/useAddToList';
import { useUpdateListEntryNote } from '@/hooks/lists/useUpdateListEntryNote';
import { useReorderListEntry } from '@/hooks/lists/useReorderListEntry';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useCreateHandoff } from '@/hooks/wishlist/useCreateHandoff';
import { useToast } from '@/providers/ToastProvider';
import {
    ImportToListSheet,
    ListDetailHeader,
    ListEntryRow,
    ListMapHero,
} from '@/components/lists';
import { derivePinnedIds } from '@/components/lists/pinnedLookupUtils';
import { HandoffSheet } from '@/components/wishlist';
import { PressableScale } from '@/components/ui/napkin/PressableScale';

export default function ListDetailScreen() {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { data: result, isLoading, isError, refetch } = useList(id);

    const removeFromList = useRemoveFromList(user?.id);
    const addToList = useAddToList(user?.id);
    const updateNote = useUpdateListEntryNote();
    const reorderEntry = useReorderListEntry(id ?? '');
    const wishlistAdd = useWishlistAdd(user?.id);
    const toggleListSave = useToggleListSave(user?.id);
    const createPublicShare = useCreateHandoff();
    const toast = useToast();

    const [dragDisabled, setDragDisabled] = useState(false);
    const [shareVisible, setShareVisible] = useState(false);
    const [importVisible, setImportVisible] = useState(false);
    const [locallyPinned, setLocallyPinned] = useState<Set<string>>(() => new Set());

    const detail = result?.data ?? null;
    const list = detail?.list ?? null;
    const entries = useMemo(() => detail?.entries ?? [], [detail?.entries]);
    const ownerProfile = detail?.owner_profile ?? null;
    const isNotFound = result?.isNotFound ?? false;
    const isOwner = !!user && !!list && list.owner_id === user.id;
    const canEditEntries = isOwner || (!!user && !!list?.table_id);
    const isSaved = detail?.viewer_has_saved ?? false;
    const saveCount = detail?.save_count ?? 0;
    const canSave = detail?.can_save
        ?? (!!user && !!list && !isOwner && !list.table_id && list.privacy === 'public');
    const existingRestaurantIds = useMemo(
        () => entries.map((entry) => entry.restaurant_id),
        [entries],
    );

    const { data: myWishlistPages } = useMyWishlist(user?.id);
    const pinnedIds = useMemo(() => {
        const ids = derivePinnedIds(myWishlistPages?.pages);
        for (const restaurantId of locallyPinned) ids.add(restaurantId);
        return ids;
    }, [myWishlistPages, locallyPinned]);

    const verifiedCount = useMemo(
        () => entries.filter((entry) => entry.restaurant?.verification === 'verified').length,
        [entries],
    );

    const handleRemove = useCallback((entry: ListEntry) => {
        removeFromList.mutate({ list_id: entry.list_id, restaurant_id: entry.restaurant_id });
        toast.show(`Removed ${entry.restaurant.name}`, {
            label: 'Undo',
            onPress: () => addToList.mutate({
                list_id: entry.list_id,
                restaurant_id: entry.restaurant_id,
                note: entry.note ?? undefined,
            }),
        });
    }, [removeFromList, addToList, toast]);

    const handleNoteChange = useCallback((entry: ListEntry, note: string | null) => {
        updateNote.mutate({ list_id: entry.list_id, entry_id: entry.id, note });
    }, [updateNote]);

    const handlePinToWishlist = useCallback((entry: ListEntry) => {
        setLocallyPinned((previous) => new Set(previous).add(entry.restaurant_id));
        wishlistAdd.mutate(
            { restaurant_id: entry.restaurant_id },
            {
                onSuccess: () => toast.show('Pinned to wishlist'),
                onError: () => {
                    setLocallyPinned((previous) => {
                        const next = new Set(previous);
                        next.delete(entry.restaurant_id);
                        return next;
                    });
                    toast.show('Could not pin that spot');
                },
            },
        );
    }, [wishlistAdd, toast]);

    const handleToggleSaved = useCallback(() => {
        if (!list) return;
        toggleListSave.mutate(
            { list_id: list.id, next_saved: !isSaved },
            { onError: () => toast.show('Could not update that list') },
        );
    }, [list, isSaved, toggleListSave, toast]);

    const handleShare = useCallback(() => {
        if (!list) return;
        if (isOwner) {
            setShareVisible(true);
            return;
        }
        if (createPublicShare.isPending) return;
        createPublicShare.mutate(
            { list_id: list.id },
            {
                onSuccess: async ({ share_url }) => {
                    try {
                        await Share.share({
                            message: `${list.title} on Napkin — ${share_url}`,
                        });
                    } catch {
                        toast.show('Could not open sharing');
                    }
                },
                onError: () => toast.show('Could not create that share link'),
            },
        );
    }, [list, isOwner, createPublicShare, toast]);

    const handleDragEnd = useCallback(
        ({ data: reordered, to }: { data: ListEntry[]; from: number; to: number }) => {
            if (!id) return;
            const movedEntry = reordered[to];
            if (!movedEntry) return;
            setDragDisabled(true);
            reorderEntry.mutate(
                { list_id: id, entry_id: movedEntry.id, new_index: to, currentEntries: entries },
                { onSettled: () => setDragDisabled(false) },
            );
        },
        [id, entries, reorderEntry],
    );

    const openRestaurant = useCallback((restaurantId: string) => {
        router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } });
    }, [router]);

    const renderEntry = useCallback(
        (entry: ListEntry, index: number, drag?: () => void) => (
            <ListEntryRow
                key={entry.id}
                entry={entry}
                rank={list?.ranked ? index + 1 : undefined}
                isOwner={canEditEntries}
                isRanked={list?.ranked ?? false}
                isDragDisabled={dragDisabled || reorderEntry.isPending}
                isPinned={pinnedIds.has(entry.restaurant_id)}
                onPress={() => openRestaurant(entry.restaurant_id)}
                onRemove={() => handleRemove(entry)}
                onNoteChange={(note) => handleNoteChange(entry, note)}
                onPinToWishlist={() => handlePinToWishlist(entry)}
                drag={drag}
            />
        ),
        [list, canEditEntries, dragDisabled, reorderEntry.isPending, pinnedIds, openRestaurant, handleRemove, handleNoteChange, handlePinToWishlist],
    );

    const header = list && ownerProfile ? (
        <>
            <ListMapHero
                entries={entries}
                ranked={list.ranked}
                topInset={insets.top}
                palette={palette}
                scheme={scheme}
                onBack={() => router.back()}
                onRestaurantPress={openRestaurant}
            />
            <ListDetailHeader
                list={list}
                entryCount={entries.length}
                saveCount={saveCount}
                ownerProfile={ownerProfile}
                isOwner={isOwner}
                canEditEntries={canEditEntries}
                isSaved={isSaved}
                canSave={canSave}
                isSavePending={toggleListSave.isPending}
                isSharePending={!isOwner && createPublicShare.isPending}
                onEdit={() => router.push({ pathname: '/list/[id]/edit', params: { id: list.id } })}
                onShare={
                    !list.table_id
                    && verifiedCount > 0
                    && (isOwner || list.privacy === 'public')
                        ? handleShare
                        : undefined
                }
                onAddSpots={canEditEntries ? () => setImportVisible(true) : undefined}
                onToggleSaved={canSave ? handleToggleSaved : undefined}
            />
        </>
    ) : null;

    const empty = (
        <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>A list waiting to happen.</Text>
            <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>— add the first place and the map will take shape</Text>
            {canEditEntries ? (
                <PressableScale
                    onPress={() => setImportVisible(true)}
                    haptic="medium"
                    style={[styles.emptyButton, { backgroundColor: palette.primaryMuted }]}
                >
                    <Text style={[styles.emptyButtonText, { color: palette.primary }]}>Add spots</Text>
                </PressableScale>
            ) : null}
        </View>
    );

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {isLoading ? (
                    <View style={styles.center}><ActivityIndicator color={palette.primary} /></View>
                ) : isError ? (
                    <View style={styles.center}>
                        <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>Couldn’t open this list</Text>
                        <Text style={[styles.errorCopy, { color: palette.textMuted }]}>Check your connection and try once more.</Text>
                        <PressableScale
                            onPress={() => void refetch()}
                            haptic="light"
                            style={[styles.retryButton, { backgroundColor: palette.primaryMuted }]}
                        >
                            <Text style={[styles.retryLabel, { color: palette.primary }]}>Try again</Text>
                        </PressableScale>
                    </View>
                ) : isNotFound ? (
                    <View style={styles.center}>
                        <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>Not found</Text>
                        <Text style={[styles.errorCopy, { color: palette.textMuted }]}>This list is private or no longer exists.</Text>
                        <PressableScale onPress={() => router.back()} style={styles.retryButton}>
                            <Text style={[styles.retryLabel, { color: palette.primary }]}>Go back</Text>
                        </PressableScale>
                    </View>
                ) : list && ownerProfile ? (
                    canEditEntries && list.ranked ? (
                        <DraggableFlatList
                            data={entries}
                            keyExtractor={(item) => item.id}
                            onDragEnd={handleDragEnd}
                            ListHeaderComponent={header}
                            renderItem={({ item, getIndex, drag }: RenderItemParams<ListEntry>) => renderEntry(item, getIndex() ?? 0, drag)}
                            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                            ListEmptyComponent={empty}
                            showsVerticalScrollIndicator={false}
                        />
                    ) : (
                        <FlatList
                            data={entries}
                            keyExtractor={(item) => item.id}
                            ListHeaderComponent={header}
                            renderItem={({ item, index }) => renderEntry(item, index)}
                            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                            ListEmptyComponent={empty}
                            showsVerticalScrollIndicator={false}
                        />
                    )
                ) : null}

                {list && isOwner && !list.table_id ? (
                    <HandoffSheet
                        visible={shareVisible}
                        onDismiss={() => setShareVisible(false)}
                        pinnedCount={verifiedCount}
                        listId={list.id}
                        listName={list.title}
                    />
                ) : null}

                {list && canEditEntries ? (
                    <ImportToListSheet
                        visible={importVisible}
                        onClose={() => setImportVisible(false)}
                        userId={user?.id}
                        listId={list.id}
                        listTitle={list.title}
                        existingRestaurantIds={existingRestaurantIds}
                    />
                ) : null}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
    },
    errorCopy: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        marginTop: Spacing.sm,
    },
    retryButton: {
        minWidth: 120,
        minHeight: 44,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
    },
    retryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    emptyState: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.xl,
        paddingBottom: Spacing.xxl,
    },
    emptyTitle: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 21,
    },
    emptyCopy: {
        ...Type.editorialBody,
        textAlign: 'center',
        marginTop: 6,
    },
    emptyButton: {
        minWidth: 132,
        minHeight: 44,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.md,
    },
    emptyButtonText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
});
