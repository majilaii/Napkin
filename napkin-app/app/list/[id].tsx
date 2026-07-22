import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
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
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useCreateHandoff } from '@/hooks/wishlist/useCreateHandoff';
import { useToast } from '@/providers/ToastProvider';
import {
    ImportToListSheet,
    ListDetailSheet,
    ScopedListMap,
    UnmappedListSpotsSheet,
    type ListDetailSheetHandle,
} from '@/components/lists';
import { ListEntryRow } from '@/components/lists/ListEntryRow';
import {
    deriveContextLine,
    deriveCover,
    deriveMetadataLine,
    listCoverPhotoFailureKey,
} from '@/components/lists/listHeaderUtils';
import { HALF, PEEK, resolveSheetMode, visibleHeight, type Snap } from '@/components/lists/listSheetMath';
import { mintFocusRequest, resolveSettleFocus, type FocusRequest } from '@/components/lists/focusRequest';
import { derivePinnedIds } from '@/components/lists/pinnedLookupUtils';
import {
    countUnmappableListEntries,
    hasValidCoordinates,
    listEntriesToWishlistMapItems,
} from '@/components/wishlist/listMapScope';
import { HandoffSheet } from '@/components/wishlist';
import { PressableScale } from '@/components/ui/napkin/PressableScale';

const NO_FILTERS = { city: null, cuisine: null, price: null } as const;
type Overlay = 'none' | 'share' | 'import' | 'repair';

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
    const wishlistRemove = useWishlistRemove(user?.id);
    const toggleListSave = useToggleListSave(user?.id);
    const createPublicShare = useCreateHandoff();
    const toast = useToast();

    // A11: silent, granted-only location — NEVER prompt from list detail.
    const { coords, status: locationStatus, requestIfGranted } = useNearbyLocation();
    useEffect(() => { void requestIfGranted(); }, [requestIfGranted]);

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

    const [containerH, setContainerH] = useState(0);
    const H = Math.max(0, containerH - insets.top);

    // ── Sheet ↔ map coordination ────────────────────────────────────────────────
    const sheetRef = useRef<ListDetailSheetHandle>(null);
    const reframeRef = useRef<() => void>(() => {});
    const pendingFocusRef = useRef<string | null>(null);
    // F4: the seq counter lives for the whole screen and NEVER resets — the
    // map's handled marker persists across restaurant round-trips.
    const focusSeqRef = useRef(0);
    // True when the latest settle consumed a pendingFocus (owns its own camera).
    const focusDrivenSettleRef = useRef(false);
    const [settledSnap, setSettledSnap] = useState<Snap>(HALF);
    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
    const [isEditingPlaces, setIsEditingPlaces] = useState(false);
    // F3: the edit lock ignores `ranked`; ranked only picks the reorder list.
    const sheetMode = resolveSheetMode(isEditingPlaces, canEditEntries, !!list?.ranked);

    // ── Overlays (one discriminated state + a present lock; Codex #10) ────────────
    const [overlay, setOverlay] = useState<Overlay>('none');
    const presentLockRef = useRef(0);
    const canPresent = useCallback(() => {
        const now = Date.now();
        if (now - presentLockRef.current < 350) return false;
        presentLockRef.current = now;
        return true;
    }, []);
    const openOverlay = useCallback((kind: Exclude<Overlay, 'none'>) => {
        if (overlay !== 'none' || !canPresent()) return;
        setOverlay(kind);
    }, [overlay, canPresent]);

    const [dragDisabled, setDragDisabled] = useState(false);
    const [wishlistOverrides, setWishlistOverrides] = useState<Map<string, boolean>>(() => new Map());
    const wishlistPendingRef = useRef<Set<string>>(new Set());
    const [wishlistPendingIds, setWishlistPendingIds] = useState<Set<string>>(() => new Set());
    const [failedListPhotoKeys, setFailedListPhotoKeys] = useState<Set<string>>(() => new Set());
    const handleListPhotoError = useCallback((failureKey: string) => {
        setFailedListPhotoKeys((current) => new Set(current).add(failureKey));
    }, []);

    const existingRestaurantIds = useMemo(
        () => entries.map((entry) => entry.restaurant_id),
        [entries],
    );
    const { data: myWishlistPages } = useMyWishlist(user?.id);
    const pinnedIds = useMemo(() => {
        const ids = derivePinnedIds(myWishlistPages?.pages);
        for (const [restaurantId, isWishlisted] of wishlistOverrides) {
            if (isWishlisted) ids.add(restaurantId);
            else ids.delete(restaurantId);
        }
        return ids;
    }, [myWishlistPages, wishlistOverrides]);

    const verifiedCount = useMemo(
        () => entries.filter((entry) => entry.restaurant?.verification === 'verified').length,
        [entries],
    );

    // ── Map inputs ────────────────────────────────────────────────────────────────
    const mapItems = useMemo(
        () => (list
            ? listEntriesToWishlistMapItems(entries, { ...NO_FILTERS, emoji: list.emoji, ranked: list.ranked })
            : []),
        [entries, list],
    );
    const unmappableCount = useMemo(
        () => countUnmappableListEntries(entries, NO_FILTERS),
        [entries],
    );
    const repairableUnmappableEntries = useMemo(
        () =>
            entries.filter(
                (entry) =>
                    !hasValidCoordinates(entry) &&
                    entry.restaurant.verification !== 'verified' &&
                    entry.restaurant.created_by === user?.id &&
                    entry.restaurant.merged_into == null &&
                    Number.isSafeInteger(entry.restaurant.completeness_version),
            ),
        [entries, user?.id],
    );
    const sheetVisibleHeight = H > 0 ? visibleHeight(H, settledSnap) : 0;

    // ── Header derivations ──────────────────────────────────────────────────────────
    const cover = useMemo(() => deriveCover(entries), [entries]);
    const coverFailureKey = useMemo(() => listCoverPhotoFailureKey(entries), [entries]);
    const visibleCoverUrl = coverFailureKey && failedListPhotoKeys.has(coverFailureKey)
        ? null
        : cover?.photoUrl ?? null;
    const metadata = list ? deriveMetadataLine(entries.length, saveCount, list.privacy, list.table_id) : '';
    const contextLine = useMemo(
        () => (list ? deriveContextLine(list, isOwner, ownerProfile) : null),
        [list, ownerProfile, isOwner],
    );

    // ── Handlers ────────────────────────────────────────────────────────────────────
    const handleBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/lists');
    }, [router]);

    const openRestaurant = useCallback((restaurantId: string) => {
        pendingFocusRef.current = null;
        setFocusRequest(null);
        router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } });
    }, [router]);

    // Row-locate / pin-tap → snap to peek, then fire the focus from the settle.
    // G1: rejected outright while the edit lock holds (the locate icons are
    // also disabled then; the sheet's snapTo clamps to FULL as a backstop).
    const focusPin = useCallback((restaurantId: string) => {
        if (sheetMode.locked) return;
        pendingFocusRef.current = restaurantId;
        sheetRef.current?.snapTo(PEEK);
    }, [sheetMode.locked]);

    // G1: a real drag supersedes an in-flight focus transition — including one
    // already emitted but not yet handled (map not ready), which would
    // otherwise fire a late camera jump after the user changed modes.
    const handlePanStart = useCallback(() => {
        pendingFocusRef.current = null;
        setFocusRequest(null);
    }, []);

    // Entering the edit lock supersedes any in-flight or emitted focus too.
    useEffect(() => {
        if (!sheetMode.locked) return;
        pendingFocusRef.current = null;
        setFocusRequest(null);
    }, [sheetMode.locked]);

    const handleSnapSettle = useCallback((snap: Snap) => {
        // G1: every settle consumes the pending focus — fired only at PEEK,
        // discarded on any other snap (superseded transition).
        const { fire } = resolveSettleFocus(pendingFocusRef.current, snap, PEEK);
        pendingFocusRef.current = null;
        focusDrivenSettleRef.current = fire != null;
        if (fire) setFocusRequest(mintFocusRequest(focusSeqRef, fire));
        setSettledSnap(snap);
    }, []);

    // F1: re-frame only AFTER the settle's mapPadding has committed —
    // settledSnap drives sheetVisibleHeight, which is the map's padding prop,
    // so a synchronous reframe inside the settle callback would fit against
    // stale occlusion. Focus-driven settles own their camera via focusRequest.
    useEffect(() => {
        if (focusDrivenSettleRef.current) return;
        if (settledSnap > HALF || sheetMode.locked) return;
        reframeRef.current?.();
    }, [settledSnap, sheetMode.locked]);

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

    const handleToggleWishlist = useCallback(async (entry: ListEntry, isCurrentlyWishlisted: boolean) => {
        if (wishlistPendingRef.current.has(entry.restaurant_id)) return;
        wishlistPendingRef.current.add(entry.restaurant_id);
        setWishlistPendingIds(new Set(wishlistPendingRef.current));
        const nextWishlisted = !isCurrentlyWishlisted;
        setWishlistOverrides((previous) => new Map(previous).set(entry.restaurant_id, nextWishlisted));

        try {
            if (nextWishlisted) {
                await wishlistAdd.mutateAsync({ restaurant_id: entry.restaurant_id });
                toast.show('Saved to Wishlist');
            } else {
                await wishlistRemove.mutateAsync(entry.restaurant_id);
                toast.show('Removed from Wishlist');
            }
        } catch {
            setWishlistOverrides((previous) => {
                const next = new Map(previous);
                next.delete(entry.restaurant_id);
                return next;
            });
            toast.show(nextWishlisted
                ? 'Could not save that spot to Wishlist'
                : 'Could not remove that spot from Wishlist');
        } finally {
            wishlistPendingRef.current.delete(entry.restaurant_id);
            setWishlistPendingIds(new Set(wishlistPendingRef.current));
        }
    }, [wishlistAdd, wishlistRemove, toast]);

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
            openOverlay('share');
            return;
        }
        if (createPublicShare.isPending) return;
        createPublicShare.mutate(
            { list_id: list.id },
            {
                onSuccess: async ({ share_url }) => {
                    try {
                        await Share.share({ message: `${list.title} on Napkin — ${share_url}` });
                    } catch {
                        toast.show('Could not open sharing');
                    }
                },
                onError: () => toast.show('Could not create that share link'),
            },
        );
    }, [list, isOwner, openOverlay, createPublicShare, toast]);

    const handleEditSettings = useCallback(() => {
        if (!list || overlay !== 'none' || !canPresent()) return;
        router.push({ pathname: '/list/[id]/edit', params: { id: list.id } });
    }, [list, overlay, canPresent, router]);

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

    const renderRow = useCallback(
        (entry: ListEntry, index: number, drag?: () => void) => (
            <ListEntryRow
                key={entry.id}
                entry={entry}
                rank={list?.ranked ? index + 1 : undefined}
                isOwner={canEditEntries}
                isEditing={isEditingPlaces}
                isRanked={list?.ranked ?? false}
                isDragDisabled={dragDisabled || reorderEntry.isPending}
                isWishlisted={pinnedIds.has(entry.restaurant_id)}
                isWishlistPending={wishlistPendingIds.has(entry.restaurant_id)}
                // G1: locate is quiet-disabled while the edit lock holds.
                canShowOnMap={hasValidCoordinates(entry) && !sheetMode.locked}
                onPress={() => openRestaurant(entry.restaurant_id)}
                onShowOnMap={() => focusPin(entry.restaurant_id)}
                onRemove={() => handleRemove(entry)}
                onNoteChange={(note) => handleNoteChange(entry, note)}
                onToggleWishlist={user
                    ? () => handleToggleWishlist(entry, pinnedIds.has(entry.restaurant_id))
                    : undefined}
                drag={drag}
                failedPhotoKeys={failedListPhotoKeys}
                onPhotoError={handleListPhotoError}
            />
        ),
        [list, canEditEntries, isEditingPlaces, sheetMode.locked, dragDisabled, reorderEntry.isPending, pinnedIds, wishlistPendingIds, user, openRestaurant, focusPin, handleRemove, handleNoteChange, handleToggleWishlist, failedListPhotoKeys, handleListPhotoError],
    );

    const canShareList = !!list && !list.table_id && verifiedCount > 0 && (isOwner || list.privacy === 'public');

    const empty = (
        <View style={styles.emptyState}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No places yet</Text>
            {canEditEntries ? (
                <PressableScale
                    onPress={() => openOverlay('import')}
                    haptic="medium"
                    style={[styles.emptyButton, { backgroundColor: palette.primaryMuted }]}
                >
                    <Text style={[styles.emptyButtonText, { color: palette.primary }]}>Add spots</Text>
                </PressableScale>
            ) : null}
        </View>
    );

    return (
        <View
            style={[styles.container, { backgroundColor: palette.background }]}
            onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}
        >
            <Stack.Screen options={{ headerShown: false }} />

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
                    <PressableScale onPress={handleBack} style={styles.retryButton}>
                        <Text style={[styles.retryLabel, { color: palette.primary }]}>Go back</Text>
                    </PressableScale>
                </View>
            ) : list ? (
                <>
                    <View style={StyleSheet.absoluteFill}>
                        <ScopedListMap
                            items={mapItems}
                            unmappableCount={unmappableCount}
                            onOpenUnmapped={
                                canEditEntries && repairableUnmappableEntries.length > 0
                                    ? () => openOverlay('repair')
                                    : undefined
                            }
                            userCoords={coords}
                            locationStatus={locationStatus}
                            focusRequest={focusRequest}
                            collectionScopeKey={`list:${list.id}`}
                            sheetVisibleHeight={sheetVisibleHeight}
                            settledSnap={settledSnap}
                            reframeRef={reframeRef}
                            onPinFocus={focusPin}
                            onOpenRestaurant={openRestaurant}
                            palette={palette}
                        />
                    </View>

                    {H > 0 ? (
                        <ListDetailSheet
                            sheetRef={sheetRef}
                            H={H}
                            headerProps={{
                                list,
                                ownerProfile,
                                cover: visibleCoverUrl,
                                onCoverError: () => {
                                    if (coverFailureKey) handleListPhotoError(coverFailureKey);
                                },
                                metadata,
                                contextLine,
                                isOwner,
                                canEditEntries,
                                isEditingPlaces,
                                isSaved,
                                canSave,
                                isSavePending: toggleListSave.isPending,
                                isSharePending: !isOwner && createPublicShare.isPending,
                                onToggleEditingPlaces: () => setIsEditingPlaces((current) => !current),
                                onEditSettings: handleEditSettings,
                                onShare: canShareList ? handleShare : undefined,
                                onAddSpots: canEditEntries ? () => openOverlay('import') : undefined,
                                onToggleSaved: canSave ? handleToggleSaved : undefined,
                            }}
                            description={list.description}
                            entries={entries}
                            renderRow={renderRow}
                            editing={sheetMode.locked}
                            reorder={sheetMode.reorder}
                            onDragEnd={handleDragEnd}
                            onSnapSettle={handleSnapSettle}
                            onPanStart={handlePanStart}
                            emptyComponent={entries.length === 0 ? empty : null}
                        />
                    ) : null}

                    <PressableScale
                        onPress={handleBack}
                        haptic="selection"
                        style={[styles.backChevron, { top: insets.top + 8, backgroundColor: palette.scrimFrost }]}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                    >
                        <Ionicons name="chevron-back" size={20} color={palette.text} />
                    </PressableScale>

                    {isOwner && !list.table_id ? (
                        <HandoffSheet
                            visible={overlay === 'share'}
                            onDismiss={() => setOverlay('none')}
                            pinnedCount={verifiedCount}
                            listId={list.id}
                            listName={list.title}
                        />
                    ) : null}

                    {canEditEntries ? (
                        <ImportToListSheet
                            visible={overlay === 'import'}
                            onClose={() => setOverlay('none')}
                            userId={user?.id}
                            listId={list.id}
                            listTitle={list.title}
                            existingRestaurantIds={existingRestaurantIds}
                        />
                    ) : null}

                    {canEditEntries && repairableUnmappableEntries.length > 0 ? (
                        <UnmappedListSpotsSheet
                            visible={overlay === 'repair'}
                            onClose={() => setOverlay('none')}
                            listId={list.id}
                            entries={repairableUnmappableEntries}
                            palette={palette}
                        />
                    ) : null}
                </>
            ) : null}
        </View>
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
    backChevron: {
        position: 'absolute',
        left: 14,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
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
