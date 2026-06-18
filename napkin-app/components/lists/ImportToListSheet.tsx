/**
 * ImportToListSheet — the fast "add spots" path for a list.
 *
 * Multi-select your already-saved spots and add them all to a list in one tap,
 * instead of adding one-at-a-time from each restaurant page.
 *
 * Source-switched by design: v1 ships the WISHLIST source; `your logs` and
 * `search` are reserved (shown muted) and drop in as additional adapters later —
 * the picker body is source-agnostic (it renders an ImportRow[] regardless of
 * where the rows came from).
 *
 * Bottom-sheet Modal pattern mirrors AddToListSheet. Selection is local; the
 * commit is a single bulk `lists.add_entries` call (idempotent — dupes skipped).
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    FlatList,
    TextInput,
    StyleSheet,
    TouchableWithoutFeedback,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useAddEntriesToList } from '@/hooks/lists/useAddEntriesToList';
import { useToast } from '@/providers/ToastProvider';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    listId: string;
    listTitle: string;
    /** restaurant_ids already in the list — rendered as `added`, non-selectable. */
    existingRestaurantIds: string[];
}

type SourceKey = 'wishlist' | 'logs' | 'search';

/** A source-agnostic pickable row (today only ever built from the wishlist). */
interface ImportRow {
    restaurantId: string;
    name: string;
    meta: string;
}

export function ImportToListSheet({
    visible,
    onClose,
    userId,
    listId,
    listTitle,
    existingRestaurantIds,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const toast = useToast();

    const [source] = useState<SourceKey>('wishlist');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Set<string>>(() => new Set());

    const {
        data: wishlistPages,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useMyWishlist(userId);

    const addEntries = useAddEntriesToList(userId);

    const existingSet = useMemo(
        () => new Set(existingRestaurantIds),
        [existingRestaurantIds],
    );

    // Build source rows. Only resolved wishlist items with a real restaurant.
    const rows = useMemo<ImportRow[]>(() => {
        const items: PersonalWishlistItem[] = (wishlistPages?.pages ?? []).flatMap(
            (p) => p.data ?? [],
        );
        return items
            .filter(
                (i) =>
                    i.restaurant != null &&
                    i.extraction_status !== 'pending' &&
                    i.extraction_status !== 'needs_confirm',
            )
            .map((i) => {
                const r = i.restaurant!;
                const meta = [r.city, r.cuisine].filter(Boolean).join(' · ');
                return { restaurantId: r.id, name: r.name, meta };
            });
    }, [wishlistPages]);

    const filteredRows = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (row) =>
                row.name.toLowerCase().includes(q) ||
                row.meta.toLowerCase().includes(q),
        );
    }, [rows, query]);

    const toggle = useCallback((restaurantId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(restaurantId)) next.delete(restaurantId);
            else next.add(restaurantId);
            return next;
        });
    }, []);

    const handleClose = useCallback(() => {
        setQuery('');
        setSelected(new Set());
        onClose();
    }, [onClose]);

    const handleAdd = useCallback(() => {
        const ids = [...selected];
        if (ids.length === 0) return;
        addEntries.mutate(
            { list_id: listId, restaurant_ids: ids },
            {
                onSuccess: (res) => {
                    const n = res.added_count;
                    toast.show(
                        n === 0
                            ? 'already in the list'
                            : `added ${n} ${n === 1 ? 'spot' : 'spots'}`,
                    );
                },
                onError: () => toast.show("couldn't add spots — try again"),
            },
        );
        handleClose();
    }, [selected, addEntries, listId, toast, handleClose]);

    const selectedCount = selected.size;

    const renderRow = useCallback(
        ({ item }: { item: ImportRow }) => {
            const isAdded = existingSet.has(item.restaurantId);
            const isSelected = selected.has(item.restaurantId);

            return (
                <Pressable
                    onPress={() => (isAdded ? undefined : toggle(item.restaurantId))}
                    disabled={isAdded}
                    style={({ pressed }) => [
                        styles.row,
                        { opacity: isAdded ? 0.45 : pressed ? 0.7 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: isAdded }}
                    accessibilityLabel={`${isSelected ? 'deselect' : 'select'} ${item.name}`}
                >
                    <View style={styles.rowBody}>
                        <Text
                            style={[styles.rowName, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {item.name}
                        </Text>
                        {item.meta ? (
                            <Text
                                style={[styles.rowMeta, { color: palette.textMuted }]}
                                numberOfLines={1}
                            >
                                {item.meta}
                            </Text>
                        ) : null}
                    </View>

                    {isAdded ? (
                        <Text style={[styles.addedTag, { color: palette.textMuted }]}>
                            added
                        </Text>
                    ) : (
                        <View
                            style={[
                                styles.checkbox,
                                isSelected
                                    ? { backgroundColor: palette.primary, borderColor: palette.primary }
                                    : { borderColor: palette.outlineVariant },
                            ]}
                        >
                            {isSelected ? (
                                <Ionicons name="checkmark" size={15} color="#fffdf8" />
                            ) : null}
                        </View>
                    )}
                </Pressable>
            );
        },
        [existingSet, selected, toggle, palette],
    );

    const sources: { key: SourceKey; label: string; ready: boolean }[] = [
        { key: 'wishlist', label: 'wishlist', ready: true },
        { key: 'logs', label: 'your logs', ready: false },
        { key: 'search', label: 'search', ready: false },
    ];

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    { backgroundColor: palette.background, paddingBottom: insets.bottom + Spacing.sm },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                {/* Title */}
                <View style={styles.titleBlock}>
                    <Text style={[Type.headlineMedium, { color: palette.text }]}>add spots</Text>
                    <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                        to {listTitle}
                    </Text>
                </View>

                {/* Source switcher — underline-segmented (wishlist now; logs/search
                    reserved, shown muted with a quiet "soon"). No pill chips. */}
                <View style={styles.sourceRow}>
                    {sources.map((s) => {
                        const active = s.key === source;
                        return (
                            <View key={s.key} style={styles.sourceItem}>
                                <View style={styles.sourceLabelRow}>
                                    <Text
                                        style={[
                                            styles.sourceLabel,
                                            { color: active ? palette.text : palette.textMuted },
                                        ]}
                                    >
                                        {s.label}
                                    </Text>
                                    {!s.ready ? (
                                        <Text style={[styles.soon, { color: palette.textMuted }]}>soon</Text>
                                    ) : null}
                                </View>
                                <View
                                    style={[
                                        styles.sourceUnderline,
                                        { backgroundColor: active ? palette.primary : 'transparent' },
                                    ]}
                                />
                            </View>
                        );
                    })}
                </View>

                {/* Search */}
                <View style={[styles.searchRow, { backgroundColor: palette.card }, Shadow.subtle]}>
                    <Ionicons name="search" size={16} color={palette.textMuted} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="search your saves"
                        placeholderTextColor={palette.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.searchInput, { color: palette.text }]}
                    />
                </View>

                {/* List */}
                {isLoading && rows.length === 0 ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (
                    <FlatList
                        data={filteredRows}
                        keyExtractor={(item) => item.restaurantId}
                        renderItem={renderRow}
                        style={styles.list}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <Text style={[styles.empty, { color: palette.textMuted }]}>
                                {query.trim()
                                    ? hasNextPage
                                        ? 'no matches yet — load more to search older saves.'
                                        : 'no saves match.'
                                    : 'nothing saved yet — pin spots to your wishlist first.'}
                            </Text>
                        }
                        ListFooterComponent={
                            hasNextPage ? (
                                isFetchingNextPage ? (
                                    <ActivityIndicator
                                        color={palette.primary}
                                        size="small"
                                        style={styles.loadMore}
                                    />
                                ) : (
                                    <Pressable onPress={() => fetchNextPage()} style={styles.loadMore}>
                                        <Text style={[styles.loadMoreLabel, { color: palette.textMuted }]}>
                                            more
                                        </Text>
                                    </Pressable>
                                )
                            ) : null
                        }
                    />
                )}

                {/* Sticky add button */}
                <Pressable
                    onPress={handleAdd}
                    disabled={selectedCount === 0 || addEntries.isPending}
                    style={({ pressed }) => [
                        styles.addButton,
                        {
                            backgroundColor:
                                selectedCount === 0 ? palette.surfaceContainerHigh : palette.primary,
                            opacity: pressed ? 0.85 : 1,
                        },
                    ]}
                    accessibilityRole="button"
                >
                    {addEntries.isPending ? (
                        <ActivityIndicator color="#fffdf8" size="small" />
                    ) : (
                        <Text
                            style={[
                                Type.titleMedium,
                                { color: selectedCount === 0 ? palette.textMuted : '#fffdf8' },
                            ]}
                        >
                            {selectedCount === 0
                                ? 'select spots to add'
                                : `add ${selectedCount} ${selectedCount === 1 ? 'spot' : 'spots'}`}
                        </Text>
                    )}
                </Pressable>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
        maxHeight: '88%',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    titleBlock: {
        paddingHorizontal: 22,
        marginBottom: Spacing.md,
    },
    subtitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        marginTop: 2,
    },
    sourceRow: {
        flexDirection: 'row',
        gap: 18,
        paddingHorizontal: 22,
        marginBottom: Spacing.md,
    },
    sourceItem: {
        alignItems: 'center',
    },
    sourceLabelRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 4,
    },
    sourceLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
    },
    soon: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    sourceUnderline: {
        height: 2,
        alignSelf: 'stretch',
        borderRadius: 1,
        marginTop: 5,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 22,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
    },
    searchInput: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        padding: 0,
    },
    list: {
        flexGrow: 0,
        paddingHorizontal: 22,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
    },
    rowBody: {
        flex: 1,
        gap: 2,
    },
    rowName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 20,
    },
    rowMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: Radius.full,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    addedTag: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'lowercase',
        flexShrink: 0,
    },
    empty: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
        textAlign: 'center',
        paddingVertical: Spacing.xl,
        paddingHorizontal: 22,
    },
    loadMore: {
        paddingVertical: 14,
        alignItems: 'center',
    },
    loadMoreLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    addButton: {
        marginHorizontal: 22,
        marginTop: Spacing.sm,
        paddingVertical: 15,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
