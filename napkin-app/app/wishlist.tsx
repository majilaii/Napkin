/**
 * /wishlist — personal wishlist + lists area (TICKET-069 canvas restyle, TICKET-074).
 *
 * Canvas anatomy:
 *   Header: italic serif 26 "Wishlist" + quiet "share · import" affordances
 *           (+ back ‹ when pushed). Share promoted from the kicker murmur (074).
 *   Imports section: PendingSaveCard rows (pending / needs_confirm captures)
 *   "PINNED · {N}" kicker + flat rows: 52px r12 initial-tile · italic serif 17 name
 *                                        muted 12 meta (city · cuisine) · pin icon
 *   E· empty slab when no pinned items
 *   "YOUR LISTS" kicker + rows (italic serif 17 name · muted "{N} spots" · quiet
 *   terracotta `share`) + "+ new list" murmur → /list/new (TICKET-074)
 *
 * TICKET-060 corrections: pending/needs_confirm → CorrectModal flow preserved.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Modal,
    TextInput,
    FlatList,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ImportLinkSheet, PendingSaveCard, HandoffSheet, ListsRail, RecentlyImportedBand, WishlistMapView, type WishlistMapItem, CuisineFilterSheet } from '@/components/wishlist';
import { buildListsSectionRows } from '@/components/wishlist/listsSectionUtils';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useCorrectImport } from '@/hooks/wishlist/useCorrectImport';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useImportHistory } from '@/hooks/wishlist/useImportHistory';
import { useActiveImports } from '@/hooks/wishlist/useActiveImports';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { haversineMiles, formatDistance } from '@/lib/geo';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { WishlistSourceHandoff } from '@/lib/types/wishlistSource';

// ── Inline Places search for correction ────────────────────────────────────────

interface SearchResult {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
}

function usePlacesSearch(query: string) {
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);

    React.useEffect(() => {
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        callEdgeFn<{ data?: SearchResult[] } | SearchResult[]>('places-search', {
            body: { query: query.trim(), limit: 8 },
        })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res) ? res : ((res as any)?.data ?? []);
                setResults(list.slice(0, 8));
            })
            .catch(() => { if (!cancelled) setResults([]); })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [query]);

    return { results, isLoading };
}

// ── Correction modal ───────────────────────────────────────────────────────────

interface CorrectModalProps {
    visible: boolean;
    item: PersonalWishlistItem | null;
    userId: string;
    onDone: () => void;
    palette: typeof Colors.light;
}

function CorrectModal({ visible, item, userId, onDone, palette }: CorrectModalProps) {
    const [query, setQuery] = useState('');
    const { results, isLoading } = usePlacesSearch(query);
    const { mutate: correct, isPending } = useCorrectImport(userId);

    const handleSelect = useCallback((r: SearchResult) => {
        if (!item?.job_id) return;
        correct(
            { job_id: item.job_id, restaurant_id: r.id, restaurantName: r.name ?? undefined },
            { onSettled: () => { setQuery(''); onDone(); } },
        );
    }, [correct, item, onDone]);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onDone}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1, backgroundColor: palette.background }}
            >
                <View style={[correctStyles.header, { borderBottomColor: palette.dividerSoft }]}>
                    <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 17 }]}>
                        find the right one
                    </Text>
                    <Pressable onPress={onDone} hitSlop={12}>
                        <Ionicons name="close" size={22} color={palette.textMuted} />
                    </Pressable>
                </View>
                <View style={correctStyles.inputRow}>
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="search by name or city"
                        placeholderTextColor={palette.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        style={[
                            correctStyles.input,
                            { color: palette.text, borderBottomColor: palette.ruleInkSoft },
                        ]}
                    />
                </View>
                {isPending || isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.lg }} />
                ) : (
                    <FlatList
                        data={results}
                        keyExtractor={(r) => r.id}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: Spacing.sm }}
                        renderItem={({ item: r }) => (
                            <Pressable
                                onPress={() => handleSelect(r)}
                                style={[correctStyles.resultRow, { borderBottomColor: palette.dividerSoft }]}
                            >
                                <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 15 }]}>
                                    {r.name}
                                </Text>
                                {r.city || r.cuisine ? (
                                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                        {[r.city, r.cuisine].filter(Boolean).join(' · ')}
                                    </Text>
                                ) : null}
                            </Pressable>
                        )}
                    />
                )}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const correctStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    inputRow: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    input: {
        fontSize: 15,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    resultRow: {
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});

// ── Pinned row ─────────────────────────────────────────────────────────────────

interface PinnedRowProps {
    item: PersonalWishlistItem;
    palette: typeof Colors.light;
    /** "0.3 mi" when sorting by distance; null otherwise. */
    distanceLabel?: string | null;
    onPress: () => void;
}

function PinnedRow({ item, palette, distanceLabel, onPress }: PinnedRowProps) {
    const r = item.restaurant!;
    // TICKET-072 ARCH-2 #8: append provenance murmur for handoff-sourced spots
    const provenance = item.source?.type === 'handoff'
        ? `via ${(item.source as WishlistSourceHandoff).sharer_name}'s napkin`
        : null;
    // Distance leads the meta when "near me" is active — it's the deciding signal.
    const meta = [distanceLabel, r.city, r.cuisine, provenance].filter(Boolean).join(' · ');

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.pinnedRow, { opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Open ${r.name}`}
        >
            {/* Name-forward — no thumbnails. Meta (distance · city · cuisine) is text. */}
            <View style={styles.pinnedTextBlock}>
                <Text style={[styles.pinnedName, { color: palette.text }]} numberOfLines={1}>
                    {r.name}
                </Text>
                {meta ? (
                    <Text style={[styles.pinnedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [importSheetVisible, setImportSheetVisible] = useState(false);
    const [correctItem, setCorrectItem] = useState<PersonalWishlistItem | null>(null);
    // One HandoffSheet target for both modes: wishlist share (no listId) or a
    // per-list share (listId + frozen listName) — TICKET-074.
    const [shareTarget, setShareTarget] = useState<{
        listId?: string;
        listName?: string;
        count: number;
    } | null>(null);

    const { data: wishlistPages, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMyWishlist(user?.id);

    // YOUR LISTS — TICKET-074 lists area. FRIEND_TEST.hideLists is deliberately
    // bypassed at THIS call-site only — the flag still curtains the old standalone
    // entry points (settings row, ProfileScreenBody palate section). Same pattern
    // as TopFour on the profile tab.
    const { data: myLists } = useMyLists(user?.id);
    const listRows = useMemo(() => buildListsSectionRows(myLists), [myLists]);

    // Recently-imported batches (async import history) — conditional band.
    const { data: importBatches = [] } = useImportHistory(user?.id);

    // In-flight imports (reading / saving / review / failed) → the progress band.
    const activeImports = useActiveImports();
    const importBand = useMemo(() => {
        if (activeImports.length === 0) return null;
        const review = activeImports.filter((m) => m.phase === 'review');
        const failed = activeImports.filter((m) => m.phase === 'failed');
        const working = activeImports.filter((m) => m.phase === 'reading' || m.phase === 'saving');
        if (review.length > 0) {
            const n = review.reduce((sum, m) => sum + m.spotCount, 0);
            return { icon: 'sparkles-outline' as const, text: `${n} ${n === 1 ? 'spot' : 'spots'} ready to review` };
        }
        if (working.length > 0) {
            return { icon: 'sync-outline' as const, text: working.length === 1 ? 'importing…' : `importing ${working.length}…` };
        }
        if (failed.length > 0) {
            return { icon: 'alert-circle-outline' as const, text: 'an import needs attention' };
        }
        return null;
    }, [activeImports]);

    const allItems = useMemo(
        () => (wishlistPages?.pages ?? []).flatMap((p) => p.data ?? []),
        [wishlistPages],
    );

    // Pending/needs_confirm captures at the top
    const pendingRows = useMemo(
        () => allItems.filter((i) =>
            i.extraction_status === 'pending' || i.extraction_status === 'needs_confirm',
        ),
        [allItems],
    );

    // Pinned = resolved items with a restaurant
    const pinnedRows = useMemo(
        () => allItems.filter((i) =>
            i.restaurant != null &&
            i.extraction_status !== 'pending' &&
            i.extraction_status !== 'needs_confirm',
        ),
        [allItems],
    );

    // ── "where do I go" — near-me sort + cuisine filter + list/map (TICKET-08x) ──
    const [sortMode, setSortMode] = useState<'recent' | 'near'>('recent');
    const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
    const { coords, status: locationStatus, request: requestLocation } = useNearbyLocation();

    // Cuisine chips, frequency-ranked: most-saved cuisines lead. The inline row
    // caps to the top few (below) — the rest live in the overflow sheet so the
    // chip strip never becomes an endless horizontal scroll.
    const cuisineCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const i of pinnedRows) {
            const c = i.restaurant?.cuisine?.trim();
            if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([cuisine, count]) => ({ cuisine, count }))
            .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.cuisine.localeCompare(b.cuisine)));
    }, [pinnedRows]);

    // Max cuisine chips shown inline before the "more" affordance takes over.
    const MAX_INLINE_CUISINES = 4;
    const [cuisineSheetVisible, setCuisineSheetVisible] = useState(false);

    // Inline set = top-N by frequency, plus the active filter if it fell outside
    // the top-N (so the current selection is always visible in the row).
    const inlineCuisines = useMemo(() => {
        const top = cuisineCounts.slice(0, MAX_INLINE_CUISINES).map((c) => c.cuisine);
        if (cuisineFilter && !top.includes(cuisineFilter)) top.push(cuisineFilter);
        return top;
    }, [cuisineCounts, cuisineFilter]);

    const overflowCount = Math.max(0, cuisineCounts.length - MAX_INLINE_CUISINES);

    const toggleNearMe = useCallback(() => {
        setSortMode((m) => {
            if (m === 'near') return 'recent';
            requestLocation();
            return 'near';
        });
    }, [requestLocation]);

    // Filter → (optional) distance-decorate → sort. Distance label rides along so
    // the row can show it without recomputing.
    const displayedRows = useMemo(() => {
        let rows = pinnedRows;
        if (cuisineFilter) {
            rows = rows.filter((i) => i.restaurant?.cuisine?.trim() === cuisineFilter);
        }
        const nearActive = sortMode === 'near' && !!coords;
        const decorated = rows.map((item) => {
            const r = item.restaurant;
            const hasCoords = nearActive && r?.lat != null && r?.lng != null;
            const dist = hasCoords
                ? haversineMiles(coords!, { latitude: r!.lat as number, longitude: r!.lng as number })
                : Infinity;
            return { item, dist, distanceLabel: hasCoords ? formatDistance(dist) : null };
        });
        if (nearActive) {
            decorated.sort((a, b) => a.dist - b.dist); // nearest first; no-coord items (Infinity) sink
        }
        return decorated;
    }, [pinnedRows, cuisineFilter, sortMode, coords]);

    // Map view: cuisine-filtered saved spots, split by whether they carry coords.
    // Sort is irrelevant on a map (position is the signal), so this reads from
    // pinnedRows directly rather than the distance-decorated displayedRows.
    const { mapItems, unmappableCount } = useMemo(() => {
        let rows = pinnedRows;
        if (cuisineFilter) {
            rows = rows.filter((i) => i.restaurant?.cuisine?.trim() === cuisineFilter);
        }
        const mappable: WishlistMapItem[] = [];
        let missing = 0;
        for (const i of rows) {
            const r = i.restaurant;
            if (r && r.lat != null && r.lng != null) {
                mappable.push({ id: r.id, name: r.name, city: r.city, cuisine: r.cuisine, lat: r.lat, lng: r.lng });
            } else {
                missing += 1;
            }
        }
        return { mapItems: mappable, unmappableCount: missing };
    }, [pinnedRows, cuisineFilter]);

    // Switching to map opts into location lazily (same idiom as near-me sort).
    const handleSelectView = useCallback((mode: 'list' | 'map') => {
        setViewMode(mode);
        if (mode === 'map') requestLocation();
    }, [requestLocation]);

    // Cuisine chips are shared between list + map modes (near-me chip is list-only).
    // Capped to the top few; everything else is one tap away in the overflow sheet.
    const renderCuisineChips = useCallback(() => (
        <>
            {inlineCuisines.map((c) => {
                const active = cuisineFilter === c;
                return (
                    <Pressable
                        key={c}
                        onPress={() => setCuisineFilter(active ? null : c)}
                        style={[
                            styles.chip,
                            active
                                ? { backgroundColor: palette.primary }
                                : { backgroundColor: palette.surfaceJournalLow },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                    >
                        <Text style={[styles.chipLabel, { color: active ? '#fffdf8' : palette.textMuted }]}>
                            {c.toLowerCase()}
                        </Text>
                    </Pressable>
                );
            })}
            {overflowCount > 0 ? (
                <Pressable
                    onPress={() => setCuisineSheetVisible(true)}
                    style={[styles.chip, { backgroundColor: palette.surfaceJournalLow }]}
                    accessibilityRole="button"
                    accessibilityLabel="more cuisines"
                >
                    <Text style={[styles.chipLabel, { color: palette.textMuted }]}>
                        {`more · ${overflowCount}`}
                    </Text>
                    <Ionicons name="chevron-down" size={11} color={palette.textMuted} />
                </Pressable>
            ) : null}
        </>
    ), [inlineCuisines, overflowCount, cuisineFilter, palette]);

    const handleConfirm = useCallback((item: PersonalWishlistItem) => {
        setCorrectItem(item);
    }, []);

    const handlePinnedRowPress = useCallback((item: PersonalWishlistItem) => {
        if (item.restaurant?.id) {
            router.push(('/restaurant/' + item.restaurant.id) as any);
        }
    }, [router]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Header */}
            <View
                style={[
                    styles.header,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top + Spacing.sm,
                    },
                ]}
            >
                {/* Left slot — flex:1 so the title centres against the SCREEN,
                    not the leftover space. (Was off-centre because the title used
                    flex:1 between a 32px back slot and a wider actions cluster.) */}
                <View style={styles.headerSide}>
                    {/* Back button — only when actually pushed onto a stack.
                        Wishlist is a TAB root (TICKET-070); from the tab there is
                        nothing to pop, so no chevron. */}
                    {router.canGoBack() ? (
                        <Pressable
                            onPress={() => router.back()}
                            hitSlop={12}
                            style={styles.headerBack}
                            accessibilityLabel="back"
                        >
                            <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                        </Pressable>
                    ) : (
                        <View style={styles.headerBack} />
                    )}
                </View>

                <Text style={[styles.headerTitle, { color: palette.text }]}>
                    Wishlist
                </Text>

                {/* TICKET-074: share promoted from the kicker murmur to the header,
                    beside import — "share · import", both quiet text affordances.
                    Equal-flex side slots keep the title optically centred. */}
                <View style={[styles.headerSide, styles.headerSideRight]}>
                    {pinnedRows.length > 0 ? (
                        <>
                            <Pressable
                                onPress={() => setShareTarget({ count: pinnedRows.length })}
                                hitSlop={12}
                                accessibilityLabel="share wishlist"
                            >
                                <Text style={[styles.headerActionLabel, { color: palette.primary }]}>
                                    share
                                </Text>
                            </Pressable>
                            <Text style={[styles.headerActionDot, { color: palette.textMuted }]}>
                                ·
                            </Text>
                        </>
                    ) : null}
                    <Pressable
                        onPress={() => setImportSheetVisible(true)}
                        hitSlop={12}
                        accessibilityLabel="import from link"
                    >
                        <Text style={[styles.headerActionLabel, { color: palette.primary }]}>
                            import
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* List / map view toggle — only when there are saved spots to show.
                Map mode is a focused "where are my saves" surface (lists/imports
                hidden); flip back to list for the full shelf. */}
            {pinnedRows.length > 0 ? (
                <View style={styles.viewToggleBar}>
                    <View style={[styles.viewToggle, { backgroundColor: palette.surfaceJournalLow }]}>
                        {(['list', 'map'] as const).map((mode) => {
                            const active = viewMode === mode;
                            return (
                                <Pressable
                                    key={mode}
                                    onPress={() => handleSelectView(mode)}
                                    style={[
                                        styles.viewBtn,
                                        active && [styles.viewBtnActive, { backgroundColor: palette.background }],
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={mode === 'list' ? 'list view' : 'map view'}
                                >
                                    <Ionicons
                                        name={mode === 'list' ? 'list-outline' : 'map-outline'}
                                        size={18}
                                        color={active ? palette.primary : palette.textMuted}
                                    />
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            ) : null}

            {viewMode === 'map' && pinnedRows.length > 0 ? (
                <View style={styles.mapMode}>
                    {cuisineCounts.length > 0 ? (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.mapFilterBar}
                            keyboardShouldPersistTaps="handled"
                            style={styles.mapChipScroll}
                        >
                            {renderCuisineChips()}
                        </ScrollView>
                    ) : null}
                    <WishlistMapView
                        items={mapItems}
                        unmappableCount={unmappableCount}
                        userCoords={coords}
                        locationStatus={locationStatus}
                        onRequestLocation={requestLocation}
                        onOpenRestaurant={(id) => router.push(('/restaurant/' + id) as any)}
                        palette={palette}
                    />
                </View>
            ) : (
            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Imports-in-progress band — reading / saving / review / failed.
                    Taps into the progress hub to see how it's going + what's saving. */}
                {importBand ? (
                    <Pressable
                        onPress={() => router.push('/import-progress' as any)}
                        style={[styles.reviewBand, { backgroundColor: palette.surfaceJournalLow }]}
                        accessibilityRole="button"
                    >
                        <Ionicons name={importBand.icon} size={16} color={palette.primary} />
                        <Text style={[styles.reviewBandText, { color: palette.text }]} numberOfLines={1}>
                            {importBand.text}
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                    </Pressable>
                ) : null}

                {/* Imports / pending section */}
                {pendingRows.length > 0 ? (
                    <View style={styles.pendingSection}>
                        {pendingRows.map((item) => (
                            <PendingSaveCard
                                key={item.id}
                                status={item.extraction_status as 'pending' | 'needs_confirm'}
                                restaurantName={item.restaurant?.name}
                                restaurantCity={item.restaurant?.city}
                                restaurantCuisine={item.restaurant?.cuisine}
                                restaurantPhotoUrl={item.restaurant?.photo_url}
                                onConfirm={
                                    item.extraction_status === 'needs_confirm'
                                        ? () => handleConfirm(item)
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                ) : null}

                {/* YOUR LISTS rail — saves stay the hero; lists sit up top as a
                    visible shelf (not buried at the bottom), with + new list
                    always one tap away. */}
                <ListsRail
                    rows={listRows}
                    onOpenList={(id) => router.push(`/list/${id}` as any)}
                    onNewList={() => router.push('/list/new' as any)}
                />
                <View style={[styles.railDivider, { backgroundColor: palette.outlineVariant }]} />

                {/* Recently imported — what just landed (async imports). Tertiary +
                    conditional (renders nothing when there are no imports), so it
                    never crowds saves for non-importers. */}
                <RecentlyImportedBand
                    batches={importBatches}
                    onOpenBatch={(jobId) => router.push(`/imports/${jobId}` as any)}
                    onSeeAll={() => router.push('/imports' as any)}
                />

                {/* Pinned section */}
                {isLoading && allItems.length === 0 ? (
                    <View style={styles.loadingCenter}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : pinnedRows.length > 0 ? (
                    <View style={styles.pinnedSection}>
                        {/* "PINNED · N" kicker — share moved to the header (TICKET-074) */}
                        <Text style={[styles.kicker, { color: palette.textSecondary }]}>
                            {`PINNED · ${pinnedRows.length}`}
                        </Text>

                        {/* where-do-I-go controls: near-me sort + cuisine chips */}
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.filterBar}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Pressable
                                onPress={toggleNearMe}
                                style={[
                                    styles.chip,
                                    sortMode === 'near'
                                        ? { backgroundColor: palette.primary }
                                        : { backgroundColor: palette.surfaceJournalLow },
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: sortMode === 'near' }}
                            >
                                <Ionicons
                                    name="navigate"
                                    size={12}
                                    color={sortMode === 'near' ? '#fffdf8' : palette.textMuted}
                                />
                                <Text style={[styles.chipLabel, { color: sortMode === 'near' ? '#fffdf8' : palette.textMuted }]}>
                                    near me
                                </Text>
                            </Pressable>

                            {renderCuisineChips()}
                        </ScrollView>

                        {displayedRows.length === 0 ? (
                            <Text style={[styles.pinnedMeta, { color: palette.textMuted, paddingVertical: Spacing.sm }]}>
                                {`nothing ${cuisineFilter ? cuisineFilter.toLowerCase() + ' ' : ''}saved yet.`}
                            </Text>
                        ) : null}

                        {displayedRows.map(({ item, distanceLabel }) => (
                            <PinnedRow
                                key={item.id}
                                item={item}
                                palette={palette}
                                distanceLabel={distanceLabel}
                                onPress={() => handlePinnedRowPress(item)}
                            />
                        ))}

                        {/* Load more */}
                        {hasNextPage && !isFetchingNextPage ? (
                            <Pressable
                                onPress={() => fetchNextPage()}
                                style={styles.loadMoreRow}
                            >
                                <Text style={[styles.loadMoreLabel, { color: palette.textMuted }]}>
                                    more
                                </Text>
                            </Pressable>
                        ) : isFetchingNextPage ? (
                            <ActivityIndicator
                                color={palette.primary}
                                style={styles.loadMoreRow}
                                size="small"
                            />
                        ) : null}
                    </View>
                ) : !isLoading ? (
                    /* E· empty slab */
                    <View style={styles.emptySlab}>
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            — nothing pinned yet.
                        </Text>
                        <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                            save a restaurant to remember it.
                        </Text>
                    </View>
                ) : null}

            </ScrollView>
            )}

            <ImportLinkSheet
                visible={importSheetVisible}
                onDismiss={() => setImportSheetVisible(false)}
            />

            <HandoffSheet
                visible={shareTarget !== null}
                onDismiss={() => setShareTarget(null)}
                pinnedCount={shareTarget?.count ?? 0}
                listId={shareTarget?.listId}
                listName={shareTarget?.listName}
            />

            {user ? (
                <CorrectModal
                    visible={correctItem !== null}
                    item={correctItem}
                    userId={user.id}
                    onDone={() => setCorrectItem(null)}
                    palette={palette}
                />
            ) : null}

            <CuisineFilterSheet
                visible={cuisineSheetVisible}
                cuisines={cuisineCounts}
                selected={cuisineFilter}
                onSelect={(c) => {
                    setCuisineFilter(c);
                    setCuisineSheetVisible(false);
                }}
                onDismiss={() => setCuisineSheetVisible(false)}
                palette={palette}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: Spacing.md,
        paddingHorizontal: 22,
    },
    headerSide: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerSideRight: {
        justifyContent: 'flex-end',
        gap: 6,
    },
    headerBack: {
        width: 32,
    },
    headerTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
        textAlign: 'center',
    },
    headerActionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.0,
        textTransform: 'lowercase',
    },
    headerActionDot: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    // List / map view toggle (under the header)
    viewToggleBar: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    viewToggle: {
        flexDirection: 'row',
        gap: 2,
        borderRadius: 10,
        padding: 3,
    },
    viewBtn: {
        width: 40,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
    },
    viewBtnActive: {
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    // Map mode container — flex so the map fills below the (optional) chip bar.
    // No vertical ScrollView ancestor: native pan/zoom must not fight a parent.
    mapMode: {
        flex: 1,
    },
    mapChipScroll: {
        flexGrow: 0,
        flexShrink: 0,
    },
    mapFilterBar: {
        flexDirection: 'row',
        gap: 7,
        paddingHorizontal: 22,
        paddingBottom: 12,
        paddingRight: 30,
    },
    // Scroll
    scrollContent: {
        gap: 0,
    },
    loadingCenter: {
        paddingVertical: 60,
        alignItems: 'center',
    },
    // Pending imports
    pendingSection: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
        gap: Spacing.xs,
    },
    // Pinned section
    pinnedSection: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    // where-do-I-go filter/sort chips
    filterBar: {
        flexDirection: 'row',
        gap: 7,
        paddingBottom: 12,
        paddingRight: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
    },
    chipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Pinned row
    pinnedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
    },
    pinnedTile: {
        width: 52,
        height: 52,
        borderRadius: 12,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    pinnedTileImg: {
        width: 52,
        height: 52,
        borderRadius: 12,
    },
    pinnedTextBlock: {
        flex: 1,
        gap: 3,
    },
    pinnedName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 20,
    },
    pinnedMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Load more
    loadMoreRow: {
        paddingVertical: 14,
        alignItems: 'center',
    },
    loadMoreLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    // Review band
    reviewBand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginHorizontal: 22,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
    },
    reviewBandText: {
        flex: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13.5,
    },
    // YOUR LISTS rail divider
    railDivider: {
        height: 1,
        marginHorizontal: 22,
        marginTop: Spacing.lg,
        marginBottom: Spacing.sm,
        opacity: 0.45,
    },
    // Empty slab
    emptySlab: {
        paddingHorizontal: 22,
        paddingTop: 60,
        gap: 8,
        alignItems: 'center',
    },
    emptyText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 26,
    },
    emptyHint: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
