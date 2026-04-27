/**
 * EditTop4Sheet — full-screen modal for editing the Table's Top 4.
 *
 * Spec (TICKET-046):
 *   - Header: Cancel / "Edit Top 4" (Newsreader italic) / Save (disabled when no diff)
 *   - Subtitle: italic "Anyone at the Table can edit this. Don't be annoying."
 *   - 4-slot grid: filled slots show × overlay; empty slots = dashed terracotta +
 *   - SearchInput + results from useRestaurantSearch
 *   - "SUGGESTED · FROM THE TABLE" list (wishlist overlap) when query is empty
 *   - Cancel with unsaved diff → confirm "Discard changes?"
 *   - Save → calls useSetTableTopFour, dismisses on success
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    ScrollView,
    Alert,
    Image,
    ActivityIndicator,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { SearchInput } from '@/components/search/SearchInput';
import { useRestaurantSearch } from '@/hooks/search/useRestaurantSearch';
import { useSetTableTopFour } from '@/hooks/tables/useSetTableTopFour';
import type { TopFourPlacePayload } from '@/hooks/tables/useSetTableTopFour';
import { resolveTilePhoto } from '@/lib/restaurantPhoto';
import type { TopFourSlot, TopFourSuggested } from '@/hooks/tables/useTableTopFour';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';

type Palette = typeof Colors.light;

// ── Draft slot type ────────────────────────────────────────────────────────────

interface DraftSlot {
    position: 1 | 2 | 3 | 4;
    /** Persisted Napkin UUID, or Places external_id used as a temporary key for ghost rows. */
    restaurant_id: string;
    restaurant_name: string;
    photo_url: string | null;
    city: string | null;
    /** Set for ghost Places-only results; cleared once server reconciles the real UUID. */
    place?: TopFourPlacePayload;
}

// ── Draft grid tile ────────────────────────────────────────────────────────────

interface DraftTileProps {
    position: 1 | 2 | 3 | 4;
    slot: DraftSlot | undefined;
    tileWidth: number;
    isFocused: boolean;
    palette: Palette;
    onClear: (position: 1 | 2 | 3 | 4) => void;
    onFocus: (position: 1 | 2 | 3 | 4) => void;
}

function DraftTile({ position, slot, tileWidth, isFocused, palette, onClear, onFocus }: DraftTileProps) {
    const [imgError, setImgError] = useState(false);
    const tileHeight = (tileWidth * 4) / 3;

    if (slot) {
        const photo = resolveTilePhoto({
            primary_photo_url: slot.photo_url,
            restaurant_name: slot.restaurant_name,
        });
        const showGhost = photo.kind === 'ghost' || imgError;

        return (
            <View style={{ position: 'relative' }}>
                <Pressable
                    onPress={() => onFocus(position)}
                    style={[
                        styles.tile,
                        {
                            width: tileWidth,
                            height: tileHeight,
                            backgroundColor: palette.surfaceContainerHigh,
                            borderRadius: Radius.sm,
                            overflow: 'hidden',
                            borderWidth: isFocused ? 2 : 0,
                            borderColor: isFocused ? palette.primary : 'transparent',
                        },
                    ]}
                >
                    {showGhost ? (
                        <View style={[styles.ghostTile, { backgroundColor: palette.surfaceJournalHi }]}>
                            <Text style={[styles.ghostInitial, { color: palette.textMuted }]}>
                                {photo.kind === 'ghost' ? photo.initial : '?'}
                            </Text>
                        </View>
                    ) : (
                        <Image
                            source={{ uri: (photo as any).url }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                            onError={() => setImgError(true)}
                        />
                    )}
                    <View style={[styles.tileOverlay, { backgroundColor: palette.scrimDark }]}>
                        <Text style={[styles.tileName, { color: palette.textOnImage }]} numberOfLines={2}>
                            {slot.restaurant_name}
                        </Text>
                    </View>
                </Pressable>

                {/* × clear button */}
                <Pressable
                    onPress={() => onClear(position)}
                    hitSlop={6}
                    accessibilityLabel={`Remove ${slot.restaurant_name} from slot ${position}`}
                    style={[
                        styles.clearChip,
                        { backgroundColor: palette.scrimCream },
                    ]}
                >
                    <Ionicons name="close" size={14} color={palette.text} />
                </Pressable>
            </View>
        );
    }

    // Empty / dashed slot
    return (
        <Pressable
            onPress={() => onFocus(position)}
            style={({ pressed }) => [
                styles.tile,
                styles.emptySlot,
                {
                    width: tileWidth,
                    height: tileHeight,
                    backgroundColor: palette.terracottaScrim,
                    borderColor: isFocused ? palette.primary : palette.terracottaBorder,
                    borderWidth: isFocused ? 2 : 1,
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
            accessibilityLabel={`Add restaurant to slot ${position}`}
        >
            <Text style={[styles.emptyPlus, { color: palette.primary }]}>+</Text>
        </Pressable>
    );
}

// ── Suggested item row ─────────────────────────────────────────────────────────

interface SuggestedRowProps {
    item: TopFourSuggested;
    palette: Palette;
    onAdd: (item: TopFourSuggested) => void;
}

function SuggestedRow({ item, palette, onAdd }: SuggestedRowProps) {
    return (
        <Pressable
            onPress={() => onAdd(item)}
            style={({ pressed }) => [
                styles.suggestedRow,
                { opacity: pressed ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.restaurant.name}`}
        >
            <View style={[styles.suggestedThumb, { backgroundColor: palette.surfaceContainerHigh }]}>
                {item.restaurant.photo_url ? (
                    <Image source={{ uri: item.restaurant.photo_url }} style={styles.thumbImg} />
                ) : (
                    <Ionicons name="restaurant-outline" size={18} color={palette.textMuted} />
                )}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[styles.suggestedName, { color: palette.text }]} numberOfLines={1}>
                    {item.restaurant.name}
                </Text>
                <Text style={[styles.suggestedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {[item.restaurant.city, `${item.saved_by_n_members} of you saved`]
                        .filter(Boolean)
                        .join(' · ')}
                </Text>
            </View>
            <Text style={[styles.addCta, { color: palette.primary }]}>+</Text>
        </Pressable>
    );
}

// ── Search result row (simplified, for edit sheet) ────────────────────────────

interface SearchRowProps {
    item: SearchResultRow;
    palette: Palette;
    onAdd: (item: SearchResultRow) => void;
}

function SearchRow({ item, palette, onAdd }: SearchRowProps) {
    return (
        <Pressable
            onPress={() => onAdd(item)}
            style={({ pressed }) => [
                styles.suggestedRow,
                { opacity: pressed ? 0.75 : 1, borderBottomColor: palette.divider },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.name}`}
        >
            <View style={[styles.suggestedThumb, { backgroundColor: palette.surfaceContainerHigh }]}>
                {item.photoUrl ? (
                    <Image source={{ uri: item.photoUrl }} style={styles.thumbImg} />
                ) : (
                    <Ionicons name="restaurant-outline" size={18} color={palette.textMuted} />
                )}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[styles.suggestedName, { color: palette.text }]} numberOfLines={1}>
                    {item.name}
                </Text>
                {item.city ? (
                    <Text style={[styles.suggestedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {item.city}
                    </Text>
                ) : null}
            </View>
            <Text style={[styles.addCta, { color: palette.primary }]}>+</Text>
        </Pressable>
    );
}

// ── EditTop4Sheet ──────────────────────────────────────────────────────────────

interface EditTop4SheetProps {
    visible: boolean;
    onClose: () => void;
    tableId: string;
    currentSlots: TopFourSlot[];
    suggested: TopFourSuggested[];
    initialFocusPosition?: 1 | 2 | 3 | 4;
    palette: Palette;
    userId: string | null | undefined;
}

export function EditTop4Sheet({
    visible,
    onClose,
    tableId,
    currentSlots,
    suggested,
    initialFocusPosition,
    palette,
    userId,
}: EditTop4SheetProps) {
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const setTopFour = useSetTableTopFour();

    // Initialize draft from current slots
    const [draft, setDraft] = useState<DraftSlot[]>(() =>
        currentSlots.map((s) => ({
            position: s.position,
            restaurant_id: s.restaurant_id,
            restaurant_name: s.restaurant?.name ?? '',
            photo_url: s.restaurant?.photo_url ?? null,
            city: s.restaurant?.city ?? null,
        })),
    );

    // Reset draft when sheet opens
    React.useEffect(() => {
        if (visible) {
            setDraft(
                currentSlots.map((s) => ({
                    position: s.position,
                    restaurant_id: s.restaurant_id,
                    restaurant_name: s.restaurant?.name ?? '',
                    photo_url: s.restaurant?.photo_url ?? null,
                    city: s.restaurant?.city ?? null,
                })),
            );
            setFocusedPosition(
                initialFocusPosition ??
                    (([1, 2, 3, 4] as const).find(
                        (p) => !currentSlots.some((s) => s.position === p),
                    ) ?? 1),
            );
            setSearchValue('');
            setDebouncedSearch('');
        }
        // Re-run when visible opens, or when currentSlots/initialFocusPosition change
        // while the sheet is open (e.g. caller updates position before opening).
    }, [visible, currentSlots, initialFocusPosition]);

    const [focusedPosition, setFocusedPosition] = useState<1 | 2 | 3 | 4>(
        initialFocusPosition ?? 1,
    );
    const [searchValue, setSearchValue] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const { results: searchResults, isLoading: searchLoading } = useRestaurantSearch(
        debouncedSearch,
        userId,
    );

    const hasSearchQuery = debouncedSearch.trim().length >= 2;

    // Compute diff from current
    const hasDiff = useMemo(() => {
        const currentMap = new Map(currentSlots.map((s) => [s.position, s.restaurant_id]));
        const draftMap = new Map(draft.map((s) => [s.position, s.restaurant_id]));
        for (const pos of [1, 2, 3, 4] as const) {
            if (currentMap.get(pos) !== draftMap.get(pos)) return true;
        }
        return false;
    }, [draft, currentSlots]);

    const tileWidth = Math.floor((screenWidth - 44 - 8 * 3) / 4);
    const draftMap = new Map(draft.map((s) => [s.position, s]));

    const handleClear = useCallback((position: 1 | 2 | 3 | 4) => {
        setDraft((prev) => prev.filter((s) => s.position !== position));
        setFocusedPosition(position);
    }, []);

    const handleFocus = useCallback((position: 1 | 2 | 3 | 4) => {
        setFocusedPosition(position);
    }, []);

    const addRestaurant = useCallback(
        (
            id: string,
            name: string,
            photoUrl: string | null,
            city: string | null,
            place?: TopFourPlacePayload,
        ) => {
            setDraft((prev) => {
                const existingSlot = prev.find((s) => s.position === focusedPosition);
                if (existingSlot) {
                    // Replace
                    return prev.map((s) =>
                        s.position === focusedPosition
                            ? { ...s, restaurant_id: id, restaurant_name: name, photo_url: photoUrl, city, place }
                            : s,
                    );
                }
                // Fill empty slot
                const newSlot: DraftSlot = {
                    position: focusedPosition,
                    restaurant_id: id,
                    restaurant_name: name,
                    photo_url: photoUrl,
                    city,
                    place,
                };
                return [...prev, newSlot].sort((a, b) => a.position - b.position);
            });

            // Advance focus to next empty slot
            const nextEmpty = ([1, 2, 3, 4] as const).find(
                (p) => p !== focusedPosition && !draft.some((s) => s.position === p),
            );
            if (nextEmpty) setFocusedPosition(nextEmpty);

            // Clear search
            setSearchValue('');
            setDebouncedSearch('');
        },
        [focusedPosition, draft],
    );

    const handleAddSearchResult = useCallback(
        (item: SearchResultRow) => {
            if (item.id) {
                // Persisted restaurant — add directly with DB id
                addRestaurant(item.id, item.name, item.photoUrl, item.city);
            } else if (item.placeId) {
                // Ghost Places-only result — build a place payload for server-side upsert
                const place: TopFourPlacePayload = {
                    external_id: item.placeId,
                    name: item.name,
                    location: item.city ? { locality: item.city } : undefined,
                    photoReference: item.photoReference ?? undefined,
                    photoAttributionHtml: item.photoAttributionHtml ?? undefined,
                    cuisine: item.cuisine ?? undefined,
                };
                // Use placeId as a temporary key in draft (server reconciles to real UUID)
                addRestaurant(item.placeId, item.name, item.photoUrl, item.city, place);
            }
            // else: no id or placeId — should not happen, but silently ignore
        },
        [addRestaurant],
    );

    const handleAddSuggested = useCallback(
        (item: TopFourSuggested) => {
            addRestaurant(
                item.restaurant.id,
                item.restaurant.name,
                item.restaurant.photo_url,
                item.restaurant.city,
            );
        },
        [addRestaurant],
    );

    const handleSave = useCallback(async () => {
        if (!hasDiff) return;

        // Compute changed slots (diff against current)
        const currentMap = new Map(currentSlots.map((s) => [s.position, s.restaurant_id]));
        const draftMapForSave = new Map(draft.map((s) => [s.position, s.restaurant_id]));

        const draftSlotMap = new Map(draft.map((s) => [s.position, s]));
        const changedSlots: Array<{
            position: 1 | 2 | 3 | 4;
            restaurant_id?: string | null;
            place?: TopFourPlacePayload;
        }> = [];
        for (const pos of [1, 2, 3, 4] as const) {
            const prev = currentMap.get(pos) ?? null;
            const draftSlot = draftSlotMap.get(pos);
            const next = draftMapForSave.get(pos) ?? null;
            if (prev !== next) {
                if (draftSlot?.place) {
                    // Ghost restaurant — send place payload; server upserts and fills restaurant_id
                    changedSlots.push({ position: pos, place: draftSlot.place });
                } else {
                    changedSlots.push({ position: pos, restaurant_id: next });
                }
            }
        }

        if (changedSlots.length === 0) {
            onClose();
            return;
        }

        try {
            await setTopFour.mutateAsync({ table_id: tableId, slots: changedSlots });
            onClose();
        } catch {
            Alert.alert('Could not save', 'Please try again.');
        }
    }, [hasDiff, draft, currentSlots, tableId, setTopFour, onClose]);

    const handleCancel = useCallback(() => {
        if (hasDiff) {
            Alert.alert(
                'Discard changes?',
                'Your edits to the Top 4 will be lost.',
                [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: onClose },
                ],
            );
        } else {
            onClose();
        }
    }, [hasDiff, onClose]);

    const allSearchResults = [
        ...searchResults.visited,
        ...searchResults.onNapkin,
        ...searchResults.morePlaces,
    ].filter((r) => r.id || r.placeId); // persisted rows have a DB id; ghost rows have a placeId

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={handleCancel}
        >
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={handleCancel} hitSlop={8} accessibilityLabel="Cancel">
                        <Text style={[styles.headerBtn, { color: palette.textMuted }]}>Cancel</Text>
                    </Pressable>
                    <Text style={[styles.headerTitle, { color: palette.text }]}>Edit Top 4</Text>
                    <Pressable
                        onPress={handleSave}
                        hitSlop={8}
                        disabled={!hasDiff || setTopFour.isPending}
                        accessibilityLabel="Save"
                    >
                        <Text
                            style={[
                                styles.headerBtn,
                                styles.headerSave,
                                {
                                    color: hasDiff && !setTopFour.isPending
                                        ? palette.primary
                                        : palette.textMuted,
                                },
                            ]}
                        >
                            Save
                        </Text>
                    </Pressable>
                </View>

                {/* Italic subtitle */}
                <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                    Anyone at the Table can edit this. Don&rsquo;t be annoying.
                </Text>

                {/* Draft grid */}
                <View style={styles.grid}>
                    {([1, 2, 3, 4] as const).map((pos) => (
                        <DraftTile
                            key={pos}
                            position={pos}
                            slot={draftMap.get(pos)}
                            tileWidth={tileWidth}
                            isFocused={focusedPosition === pos}
                            palette={palette}
                            onClear={handleClear}
                            onFocus={handleFocus}
                        />
                    ))}
                </View>

                {/* Search bar */}
                <SearchInput
                    value={searchValue}
                    onChangeImmediate={setSearchValue}
                    onChangeDebounced={setDebouncedSearch}
                    onClear={() => { setSearchValue(''); setDebouncedSearch(''); }}
                    placeholder="Search restaurants…"
                />

                {/* Results / Suggested list */}
                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
                >
                    {hasSearchQuery ? (
                        searchLoading ? (
                            <ActivityIndicator
                                color={palette.primary}
                                style={{ marginTop: Spacing.xl }}
                            />
                        ) : allSearchResults.length === 0 ? (
                            <Text
                                style={[styles.emptyHint, { color: palette.textMuted }]}
                            >
                                No results for &ldquo;{debouncedSearch}&rdquo;
                            </Text>
                        ) : (
                            allSearchResults.map((item) => (
                                <SearchRow
                                    key={item.id ?? item.placeId ?? item.name}
                                    item={item}
                                    palette={palette}
                                    onAdd={handleAddSearchResult}
                                />
                            ))
                        )
                    ) : suggested.length > 0 ? (
                        <>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>
                                SUGGESTED · FROM THE TABLE
                            </Text>
                            {suggested.map((item) => (
                                <SuggestedRow
                                    key={item.restaurant.id}
                                    item={item}
                                    palette={palette}
                                    onAdd={handleAddSuggested}
                                />
                            ))}
                        </>
                    ) : (
                        <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                            Search for a restaurant to add to your Top 4.
                        </Text>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    headerBtn: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 15,
    },
    headerSave: {
        fontFamily: 'Manrope_700Bold',
    },
    headerTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 18,
        letterSpacing: -0.2,
    },
    subtitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 13,
        lineHeight: 18,
        marginHorizontal: 22,
        marginBottom: Spacing.md,
    },
    grid: {
        flexDirection: 'row',
        marginHorizontal: 22,
        gap: 8,
        marginBottom: Spacing.md,
    },
    tile: {
        borderRadius: Radius.sm,
        overflow: 'hidden',
    },
    emptySlot: {
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyPlus: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 24,
        lineHeight: 26,
        textAlign: 'center',
    },
    ghostTile: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ghostInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 20,
    },
    tileOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 5,
        paddingTop: 8,
        paddingBottom: 5,
    },
    tileName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 10,
        lineHeight: 13,
    },
    clearChip: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        marginHorizontal: Spacing.md,
        marginTop: Spacing.md,
        marginBottom: Spacing.xs,
    },
    suggestedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: 10,
        gap: Spacing.sm,
    },
    suggestedThumb: {
        width: 40,
        height: 40,
        borderRadius: Radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
    },
    thumbImg: {
        width: 40,
        height: 40,
    },
    suggestedName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 14,
    },
    suggestedMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
    },
    addCta: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 20,
        lineHeight: 22,
    },
    emptyHint: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.xl,
    },
});
