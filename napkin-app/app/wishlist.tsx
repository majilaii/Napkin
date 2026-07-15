/**
 * /wishlist — Map-first saved places workspace.
 *
 * Chrome diet (TICKET-163): no workspace header — the map runs edge to edge and
 * owns its corner chrome (corner law v2):
 *   top-LEFT   Your map · Discover source pills (the only toggle)
 *   top-RIGHT  filter chip · Import chip · pending-import status chip
 *   bottom-RIGHT  locate FAB stacked over the List pill
 *   bottom-LEFT   people chip (Discover only)
 * List is an alternate full-screen presentation: a slim workspace bar
 * (Pinned | Lists segment + filter/import icons) tops the ledger, and a
 * frosted Map pill (bottom-right, mirroring the List pill) flips back.
 * The import/review inbox renders as a CARD only in list mode; on the map it
 * shrinks to the top-right status chip (never squats over pins).
 *
 * TICKET-060 corrections: pending/needs_confirm → CorrectModal flow preserved.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    ImportLinkSheet,
    PendingSaveCard,
    HandoffSheet,
    WishlistMapView,
    type WishlistMapItem,
    // Wishlist Redesign (Pinned ↔ Lists) — numbered ledger + filter sheets + empty + inbox.
    WishlistSpotRow,
    WishlistListCardFull,
    SavedListCardFull,
    WishlistEmptyState,
    FilterTabsSheet,
    type FilterOption,
    ImportInboxCard,
    DiscoverPeopleSheet,
    WishlistListsSheet,
    type WishlistMapListOption,
} from '@/components/wishlist';
import { UnmappedSpotsSheet } from '@/components/wishlist/UnmappedSpotsSheet';
import { priceTierLabel } from '@/lib/priceLevel';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useHasImported } from '@/hooks/wishlist/useHasImported';
import { useImportSlot } from '@/hooks/imports/useImportSlot';
import { useCorrectImport } from '@/hooks/wishlist/useCorrectImport';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useSavedLists } from '@/hooks/lists/useSavedLists';
import { useList } from '@/hooks/lists/useList';
import { buildMapPins } from '@/components/wishlist/mapPinsUtils';
import {
    countUnmappableListEntries,
    listEntriesToWishlistMapItems,
    resolveSwitchToPlaces,
    routeParamValue,
} from '@/components/wishlist/listMapScope';
import {
    spotsToMapItems,
    networkPinsToMapItems,
    filterItemsByCuisine,
    mergeYourItems,
    peopleFromItems,
    buildTableRows,
    peopleChipLabel,
    peopleCountLine,
    discoverItemsFor,
    overlapToMapItems,
} from '@/components/wishlist/mapItems';
import { useTablesOverlap } from '@/hooks/wishlist/useTablesOverlap';
import { GatherSheet } from '@/components/gatherings';
import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { useTables } from '@/hooks/tables/useTables';
import { fetchTableMembers } from '@/hooks/tables/useTableMembers';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useNetworkMapPins } from '@/hooks/users/useNetworkMapPins';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { OwnerActionsSheet } from '@/components/common';
import { useToast } from '@/providers/ToastProvider';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { haversineMiles, formatDistance } from '@/lib/geo';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';

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
    const [resolveError, setResolveError] = useState(false);
    const { results, isLoading } = usePlacesSearch(query);
    const { mutate: correct, isPending } = useCorrectImport(userId);
    const { mutateAsync: persistPlace, isPending: isResolving } = usePersistPlace();

    // The modal stays mounted across open/close (visible prop toggles) — reset
    // per-item state on reopen so a failed attempt doesn't bleed into the next.
    React.useEffect(() => {
        if (visible) {
            setQuery('');
            setResolveError(false);
        }
    }, [visible, item?.job_id]);

    const handleSelect = useCallback(async (r: SearchResult) => {
        if (!item?.job_id) return;
        setResolveError(false);
        // r.id is a Google Place id (text-search result) but fn_correct_import_job
        // takes a Napkin restaurant UUID — persist first (idempotent upsert) and
        // send the echoed id. Sending r.id raw fails the RPC's uuid coercion.
        let restaurantId: string;
        try {
            restaurantId = await persistPlace(r.id);
        } catch {
            // Inline error, not a toast — the root-level toast renders BEHIND
            // this open pageSheet on iOS. Modal stays open so the user can retry.
            setResolveError(true);
            return;
        }
        correct(
            { job_id: item.job_id, restaurant_id: restaurantId, restaurantName: r.name ?? undefined },
            { onSettled: () => { setQuery(''); onDone(); } },
        );
    }, [correct, item, onDone, persistPlace]);

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
                        onChangeText={(t) => { setQuery(t); setResolveError(false); }}
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
                {resolveError ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.error, paddingHorizontal: 22, paddingTop: Spacing.sm },
                        ]}
                    >
                        {`couldn't save that place — try again`}
                    </Text>
                ) : null}
                {isPending || isLoading || isResolving ? (
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

// Pinned rows now render via WishlistSpotRow (numbered ledger) — see the redesign.

// ── Main screen ────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const params = useLocalSearchParams<{
        view?: string | string[];
        listId?: string | string[];
        restaurantId?: string | string[];
    }>();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [importSheetVisible, setImportSheetVisible] = useState(false);
    const [correctItem, setCorrectItem] = useState<PersonalWishlistItem | null>(null);
    // Map murmur tap-through: which saves lack coordinates + per-row fix.
    const [unmappedSheetOpen, setUnmappedSheetOpen] = useState(false);
    // TICKET-111: long-press / swipe → remove-from-wishlist confirm sheet.
    const [removeItem, setRemoveItem] = useState<PersonalWishlistItem | null>(null);
    const wishlistRemove = useWishlistRemove(user?.id);
    const toast = useToast();
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
    const { data: savedLists } = useSavedLists(user?.id);

    const routeView = routeParamValue(params.view);
    const routeListId = routeParamValue(params.listId);
    const routeRestaurantId = routeParamValue(params.restaurantId);
    const [selectedListId, setSelectedListId] = useState<string | null>(routeListId);
    const [focusRestaurantId, setFocusRestaurantId] = useState<string | null>(routeRestaurantId);
    const [listsSheetOpen, setListsSheetOpen] = useState(false);
    const {
        data: selectedListResult,
        isLoading: isSelectedListLoading,
        isError: isSelectedListError,
        refetch: refetchSelectedList,
    } = useList(selectedListId);
    const selectedListDetail = selectedListResult?.data ?? null;
    const selectedListEntries = useMemo(
        () => selectedListDetail?.entries ?? [],
        [selectedListDetail?.entries],
    );
    const selectedList = selectedListDetail?.list ?? null;

    // Collapses the empty-state activation hub to compact once a first import lands.
    const hasImported = useHasImported(user?.id);
    // The import slot — ONE card, ever (review > running > failed > recent, then
    // idle). Derivation lives in useImportSlot so this map chip and the profile
    // Explore "Imports" row read the same live state (TICKET-185).
    const importSlot = useImportSlot(user?.id);

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

    // ── Wishlist Redesign: Pinned ↔ Lists segmented tab ──────────────────────
    const [activeTab, setActiveTab] = useState<'pinned' | 'lists'>('pinned');

    // ── Filters: Cuisine · Price · Area · Sort (one tabbed FilterTabsSheet) ──
    // Open-now / walk-time are deliberately omitted — the wishlist payload carries
    // no hours and there's no walk-time source (numbers are Google's price/rating).
    const [sortMode, setSortMode] = useState<'recent' | 'near'>('recent');
    const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
    const [priceFilter, setPriceFilter] = useState<string | null>(null); // "1".."4"
    const [cityFilter, setCityFilter] = useState<string | null>(null);
    // TICKET-124: one sheet, four tabs — replaces the per-key openSheet state.
    const [filtersOpen, setFiltersOpen] = useState(false);
    // TICKET-134: the Map tab lands ON the map (map-first). List is an overlay.
    const [viewMode, setViewMode] = useState<'list' | 'map'>('map');

    // ── TICKET-134: map sources — Your map · Discover ─────────────────────────
    // Your map = saved (terracotta) + been (olive) merged, gated by the show
    // saved / show been toggles. Discover = follows' logs (avatar pins) filtered
    // by the friend rail. Been loads immediately (Your map is default and always
    // includes it); Network arms lazily on first Discover select, then stays armed.
    const [mapSource, setMapSource] = useState<'your' | 'discover'>('your');
    const [showSaved, setShowSaved] = useState(true);
    const [showBeen, setShowBeen] = useState(true);
    const [networkArmed, setNetworkArmed] = useState(false);
    // TICKET-137 Discover people picker — EXCLUSIVE-include: empty set = everyone;
    // any checked ids show ONLY those people's pins. Session state (resets per
    // launch). Replaces the old friend rail's null=all/toggle-off-to-hide model.
    const [checkedPeople, setCheckedPeople] = useState<Set<string>>(new Set());
    const [peopleSheetOpen, setPeopleSheetOpen] = useState(false);

    // Deep links from List Places mode arrive before the selected List query.
    // Keep that scope stable while the entries hydrate; the map handles the
    // requested restaurant once it appears and will not reopen it after close.
    useEffect(() => {
        if (routeView === 'map') setViewMode('map');
        if (routeListId) {
            setSelectedListId(routeListId);
            setMapSource('your');
            setCuisineFilter(null);
            setPriceFilter(null);
            setCityFilter(null);
        }
        setFocusRestaurantId(routeRestaurantId);
    }, [routeListId, routeRestaurantId, routeView]);

    useEffect(() => {
        if (!selectedListId || !selectedListResult?.isNotFound) return;
        setSelectedListId(null);
        setFocusRestaurantId(null);
        router.setParams({ listId: '', restaurantId: '' });
        toast.show('That List is no longer available');
    }, [router, selectedListId, selectedListResult?.isNotFound, toast]);
    // TICKET-138: "gather here" on an overlap peek → GatherSheet, prefilled with
    // the restaurant + the overlap's max-count table. The 409 ALREADY_PROPOSED
    // path is owned inside GatherSheet (Alert), exactly as the restaurant page.
    const [gatherItem, setGatherItem] = useState<WishlistMapItem | null>(null);
    const handleMapSource = useCallback((key: string) => {
        const next = key as 'your' | 'discover';
        setMapSource(next);
        if (next === 'discover') setNetworkArmed(true);
    }, []);
    const { data: beenSpots } = useUserSpots(user?.id);
    const { data: networkPins } = useNetworkMapPins(networkArmed ? user?.id : null);
    // TICKET-138: table overlap pins on Discover — per-table `list_table` fan-out,
    // armed together with the network layer (first Discover select). Zero-table
    // users fetch nothing (the hook gates useTables + the fan-out on `enabled`).
    const { sources: overlapSources } = useTablesOverlap(user?.id, { enabled: networkArmed });

    // TICKET-139: "your table" rows in the Discover people picker — one tap =
    // exclusive-include that table's member ids. Rosters fan out per table, armed
    // only with Discover (enabled: networkArmed), so non-Discover / zero-table
    // users fetch no rosters. Reuses the SAME cache key + shape as useTableMembers.
    const { data: rosterMemberships } = useTables(networkArmed ? user?.id : null);
    const rosterTables = useMemo(
        () => (rosterMemberships ?? []).map((m) => m.tables).filter(Boolean),
        [rosterMemberships],
    );
    const rosterResults = useQueries({
        queries: rosterTables.map((t) => ({
            queryKey: queryKeys.tables.members(t.id),
            queryFn: () => fetchTableMembers(t.id),
            enabled: networkArmed && !!user?.id,
            staleTime: 1000 * 60 * 5,
        })),
    });
    // member_id (NOT user_id) is the table_members column (member_id trap). Raw
    // rosters only; the EFFECTIVE picker rows (minus self ∩ visible people, ≥2)
    // derive below once discoverPeople exists — buildTableRows kills the
    // one-member alias bug (founder repro 2026-07-09: table row ≡ its only
    // pin-holding member, so tapping either lit both).
    const rawTableRows = rosterTables.map((t, i) => ({
        tableId: t.id,
        name: t.name,
        memberIds: (rosterResults[i]?.data ?? []).map((m) => m.member_id),
    }));
    // Watch position live while sorting by nearest or viewing the map, so distances
    // re-rank as you walk (Amsterdam-stroll fix) instead of freezing until restart.
    const { coords, status: locationStatus, request: requestLocation } = useNearbyLocation({
        watch: sortMode === 'near' || viewMode === 'map',
    });

    // Cuisine chips, frequency-ranked: most-saved cuisines lead. The inline row
    // caps to the top few (below) — the rest live in the overflow sheet so the
    // chip strip never becomes an endless horizontal scroll.
    const facetRestaurants = useMemo(
        () => selectedListId
            ? selectedListEntries.map((entry) => entry.restaurant)
            : pinnedRows
                .map((item) => item.restaurant)
                .filter((restaurant): restaurant is NonNullable<typeof restaurant> => restaurant != null),
        [pinnedRows, selectedListEntries, selectedListId],
    );

    const cuisineCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const restaurant of facetRestaurants) {
            const c = restaurant.cuisine?.trim();
            if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([cuisine, count]) => ({ cuisine, count }))
            .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.cuisine.localeCompare(b.cuisine)));
    }, [facetRestaurants]);

    // Price tiers present in the saved set (1–4 → "$".."$$$$"), frequency-ranked,
    // for the Price filter sheet. Only tiers that exist appear as options.
    const priceCounts = useMemo(() => {
        const counts = new Map<number, number>();
        for (const restaurant of facetRestaurants) {
            const lvl = restaurant.price_level;
            if (lvl != null && lvl > 0) counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([level, count]) => ({ level, count }))
            .sort((a, b) => a.level - b.level);
    }, [facetRestaurants]);

    // Cities present in the saved set ("London", "Lisbon"…), frequency-ranked, for
    // the City filter — answers "show me only my London spots." Sourced from the
    // restaurant's Places locality (restaurants.city). Pill only appears below when
    // ≥2 cities exist (a single-city wishlist needs no city filter).
    const cityCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const restaurant of facetRestaurants) {
            const c = restaurant.city?.trim();
            if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([city, count]) => ({ city, count }))
            .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.city.localeCompare(b.city)));
    }, [facetRestaurants]);

    // ── Filter-sheet option lists + current-value labels (Cuisine · Price · Sort) ──
    const cuisineOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'All cuisines' },
            ...cuisineCounts.map((c) => ({ value: c.cuisine, label: c.cuisine, count: c.count })),
        ],
        [cuisineCounts],
    );
    const priceOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'Any price' },
            ...priceCounts.map((p) => ({ value: String(p.level), label: priceTierLabel(p.level), count: p.count })),
        ],
        [priceCounts],
    );
    const cityOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'All cities' },
            ...cityCounts.map((c) => ({ value: c.city, label: c.city, count: c.count })),
        ],
        [cityCounts],
    );
    const sortOptions: FilterOption[] = useMemo(
        () => [
            { value: 'recent', label: 'Recently saved' },
            { value: 'near', label: 'Nearest' },
        ],
        [],
    );
    // Area (city) tab hides when the saved set spans <2 cities (a single-city
    // wishlist needs no city filter). Sort tab hides in map mode (position is the
    // signal on a map) — passed to FilterTabsSheet's hideSort below.
    const hideAreaTab = cityCounts.length < 2;

    // Sort selection: "Nearest" opts into location lazily (same idiom as the map).
    // The tabbed sheet stays open on select — set several filters in one session.
    const handleSelectSort = useCallback((value: string | null) => {
        const next = (value as 'recent' | 'near') ?? 'recent';
        setSortMode(next);
        if (next === 'near') requestLocation();
    }, [requestLocation]);

    const clearFilters = useCallback(() => {
        setCuisineFilter(null);
        setPriceFilter(null);
        setCityFilter(null);
    }, []);

    const hasActiveFilters = !!cuisineFilter || !!priceFilter || !!cityFilter;

    // Filter (cuisine + price) → (optional) distance-decorate → sort. Distance label
    // rides along so the row can show it without recomputing.
    const displayedRows = useMemo(() => {
        let rows = pinnedRows;
        if (cityFilter) {
            rows = rows.filter((i) => i.restaurant?.city?.trim() === cityFilter);
        }
        if (cuisineFilter) {
            rows = rows.filter((i) => i.restaurant?.cuisine?.trim() === cuisineFilter);
        }
        if (priceFilter) {
            rows = rows.filter((i) => String(i.restaurant?.price_level ?? '') === priceFilter);
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
    }, [pinnedRows, cityFilter, cuisineFilter, priceFilter, sortMode, coords]);

    // Default Your map is explicit personal context: Wishlist + Been. Lists no
    // longer leak every authored collection into this layer; the Lists picker
    // scopes one collection deliberately below.
    const { mapItems, unmappableCount, unmappedItems } = useMemo(() => {
        const saves = pinnedRows
            .map((i) => i.restaurant)
            .filter((r): r is NonNullable<typeof r> => r != null)
            .map((r) => ({
                id: r.id, name: r.name, city: r.city, cuisine: r.cuisine,
                price_level: r.price_level ?? null,
                // lat/lng may be absent → buildMapPins counts them as unmappable.
                lat: r.lat ?? null, lng: r.lng ?? null,
            }));
        const { items, unmappableSaves, unmappableSaveIds } = buildMapPins(saves, [], {
            city: cityFilter,
            cuisine: cuisineFilter,
            price: priceFilter,
        });
        // The murmur's tap-through lists the actual saves behind the count —
        // restaurant ids back to their wishlist rows (repoint needs the ITEM id).
        const idSet = new Set(unmappableSaveIds);
        const unmapped = pinnedRows.filter((i) => i.restaurant && idSet.has(i.restaurant.id));
        return {
            mapItems: items as WishlistMapItem[],
            unmappableCount: unmappableSaves,
            unmappedItems: unmapped,
        };
    }, [pinnedRows, cityFilter, cuisineFilter, priceFilter]);

    // Been / Network layers (TICKET-131): shared mappers + the active cuisine
    // filter (the one filter that applies to whichever layer is active — price/
    // sort semantics stay saved-only). Unmappable murmur is saved-layer only.
    const beenItems = useMemo(
        () => filterItemsByCuisine(spotsToMapItems(beenSpots), cuisineFilter),
        [beenSpots, cuisineFilter],
    );
    const networkItems = useMemo(
        () => filterItemsByCuisine(networkPinsToMapItems(networkPins), cuisineFilter),
        [networkPins, cuisineFilter],
    );

    // Your map: saved (terracotta) + been (olive) merged, been-wins, gated by the
    // show saved / show been toggles (TICKET-134).
    const yourItems = useMemo(
        () => mergeYourItems(mapItems, beenItems, { showSaved, showBeen }),
        [mapItems, beenItems, showSaved, showBeen],
    );

    const scopedListItems = useMemo(
        () => selectedList
            ? listEntriesToWishlistMapItems(selectedListEntries, {
                emoji: selectedList.emoji,
                ranked: selectedList.ranked,
                city: cityFilter,
                cuisine: cuisineFilter,
                price: priceFilter,
            })
            : [],
        [selectedList, selectedListEntries, cityFilter, cuisineFilter, priceFilter],
    );
    const scopedListUnmappableCount = useMemo(
        () => countUnmappableListEntries(selectedListEntries, {
            city: cityFilter,
            cuisine: cuisineFilter,
            price: priceFilter,
        }),
        [selectedListEntries, cityFilter, cuisineFilter, priceFilter],
    );

    const myListOptions = useMemo<WishlistMapListOption[]>(
        () => (myLists ?? []).map((list) => ({
            id: list.id,
            title: list.title,
            emoji: list.emoji,
            entryCount: list.entry_count,
            ownerLabel: list.table_name ?? null,
        })),
        [myLists],
    );
    const savedListOptions = useMemo<WishlistMapListOption[]>(
        () => (savedLists ?? []).map((list) => ({
            id: list.id,
            title: list.title,
            emoji: list.emoji,
            entryCount: list.entry_count,
            ownerLabel: list.owner_display_name ?? list.owner_username,
        })),
        [savedLists],
    );
    const activeListOption = useMemo(
        () => [...myListOptions, ...savedListOptions].find((option) => option.id === selectedListId)
            ?? (selectedList
                ? {
                    id: selectedList.id,
                    title: selectedList.title,
                    emoji: selectedList.emoji,
                    entryCount: selectedListEntries.length,
                }
                : null),
        [myListOptions, savedListOptions, selectedList, selectedListEntries.length, selectedListId],
    );

    // Picker roster — distinct authors across the network layer (no new endpoint;
    // reuses useNetworkMapPins). "Everyone you follow who has pins."
    const discoverPeople = useMemo(() => peopleFromItems(networkItems), [networkItems]);

    // Effective "your table" picker rows: minus self, intersected with visible
    // people, rendered whenever ≥1 remains — see buildTableRows (founder call
    // 2026-07-09; a table shouldn't vanish just because only one member posted).
    const tableRows = useMemo(
        () => buildTableRows(rawTableRows, user?.id, discoverPeople),
        [rawTableRows, user?.id, discoverPeople],
    );

    // Table overlap items (≥2 members saved) — amber count bubbles, max-count
    // table winning per restaurant. The active cuisine filter applies (same as the
    // network layer). TICKET-138.
    const overlapItems = useMemo(
        () => filterItemsByCuisine(overlapToMapItems(overlapSources, { minCount: 2 }), cuisineFilter),
        [overlapSources, cuisineFilter],
    );

    // Discover: the shared derivation (mapItems.discoverItemsFor) — empty checked
    // set = overlap + network merged (overlap wins the dedupe); a non-empty
    // exclusive-include = ONLY those people's network pins (overlap bubbles would
    // break the "only these people" promise — TICKET-138). Shared with the
    // picker's count line so the narration can never disagree with the pins.
    const discoverItems = useMemo(
        () => discoverItemsFor(networkItems, overlapItems, checkedPeople),
        [overlapItems, networkItems, checkedPeople],
    );

    const activeMapItems = mapSource === 'discover'
        ? discoverItems
        : selectedListId
            ? scopedListItems
            : yourItems;

    // Chip label reflects the APPLIED set: Everyone · one name · N people.
    const peopleLabel = useMemo(
        () => peopleChipLabel(checkedPeople, discoverPeople),
        [checkedPeople, discoverPeople],
    );

    // Live count line for the picker — `showing N places from everyone/2 people`.
    // Called by the sheet with its DRAFT set (draft-apply); same derivation the
    // map renders, so the number matches the pins that will show on apply.
    const peopleCountFor = useCallback(
        (checked: ReadonlySet<string>) => peopleCountLine(networkItems, overlapItems, checked),
        [networkItems, overlapItems],
    );

    const handleConfirm = useCallback((item: PersonalWishlistItem) => {
        setCorrectItem(item);
    }, []);

    const handlePinnedRowPress = useCallback((item: PersonalWishlistItem) => {
        if (item.restaurant?.id) {
            router.push(('/restaurant/' + item.restaurant.id) as any);
        }
    }, [router]);

    // TICKET-111: confirmed remove-from-wishlist (long-press or swipe → sheet).
    const handleConfirmRemove = useCallback(() => {
        const item = removeItem;
        const rid = item?.restaurant?.id;
        setRemoveItem(null);
        if (!rid) return;
        wishlistRemove.mutate(rid, {
            onSuccess: () => toast.show(`Removed ${item?.restaurant?.name ?? 'spot'}`),
            onError: () => toast.show('Could not remove that — try again'),
        });
    }, [removeItem, wishlistRemove, toast]);

    // Map/List are presentations of the same saved-places workspace. Selecting
    // either presentation always returns from the collections section to places.
    // Switching to map also opts into location lazily.
    const handleSelectView = useCallback((mode: 'list' | 'map') => {
        setActiveTab('pinned');
        setViewMode(mode);
        if (mode === 'map') requestLocation();
    }, [requestLocation]);

    const handleSelectListScope = useCallback((nextListId: string | null) => {
        setSelectedListId(nextListId);
        setFocusRestaurantId(null);
        setMapSource('your');
        setViewMode('map');
        setActiveTab('pinned');
        setCuisineFilter(null);
        setPriceFilter(null);
        setCityFilter(null);
        router.setParams({
            view: 'map',
            listId: nextListId ?? '',
            restaurantId: '',
        });
        requestLocation();
    }, [requestLocation, router]);

    const handleSwitchToPlaces = useCallback(() => {
        // A scoped List pushes to its own sheet-over-map route (TICKET-186);
        // the unscoped map returns to the in-tab list overlay.
        const target = resolveSwitchToPlaces(selectedListId);
        if (target.kind === 'push-list') {
            router.push({ pathname: '/list/[id]', params: { id: target.listId } });
            return;
        }
        handleSelectView('list');
    }, [handleSelectView, router, selectedListId]);

    const totalPinned = pinnedRows.length;
    const listsCount = (myLists?.length ?? 0) + (savedLists?.length ?? 0);

    // "{N} spots · italian · $$" — the active filters spelled out after the count.
    const filterSuffix = useMemo(() => {
        const parts: string[] = [];
        if (cityFilter) parts.push(cityFilter.toLowerCase());
        if (cuisineFilter) parts.push(cuisineFilter.toLowerCase());
        if (priceFilter) parts.push(priceTierLabel(Number(priceFilter)));
        return parts.length ? ` · ${parts.join(' · ')}` : '';
    }, [cityFilter, cuisineFilter, priceFilter]);

    // The "Filters" trigger shows an active dot when any filter (or, in list
    // mode, the near sort) is engaged — the tabbed sheet carries the detail.
    const filtersActive = hasActiveFilters || (viewMode === 'list' && sortMode === 'near');
    // Map chip dot follows the ACTIVE source (#167 doctrine, adapted to
    // your/discover): Your map honors all filters (its saved portion takes
    // city/price too) plus the show-saved/show-been toggles (a hidden layer is
    // an active filter); Discover only honors cuisine — a lit dot for a filter
    // that can't apply reads as a bug.
    const mapFiltersActive =
        mapSource === 'your'
            ? hasActiveFilters || (!selectedListId && (!showSaved || !showBeen))
            : !!cuisineFilter;

    // ── Full-bleed map — ALWAYS mounted (the Map tab's hero). The list is an
    // opaque overlay ON TOP when viewMode==='list' (TICKET-134). Your map merges
    // saved+been; Discover shows the network layer + friend rail. The Filter chip
    // + sheet share the SAME filter state as the list, so toggling views never
    // loses filters (founder, 2026-07-03).
    const mapSurface = (
        <WishlistMapView
            items={activeMapItems}
            // Unmappable murmur is a saved-layer concern only. Tapping it opens
            // the which-spots + fix sheet (founder ask 2026-07-12).
            unmappableCount={
                mapSource === 'your'
                    ? selectedListId
                        ? scopedListUnmappableCount
                        : showSaved
                            ? unmappableCount
                            : 0
                    : 0
            }
            onUnmappablePress={
                mapSource === 'your' && !selectedListId
                    ? () => setUnmappedSheetOpen(true)
                    : undefined
            }
            userCoords={coords}
            locationStatus={locationStatus}
            onRequestLocation={requestLocation}
            onOpenRestaurant={(id) => router.push(('/restaurant/' + id) as any)}
            onOpenReview={(entryId) =>
                router.push({
                    pathname: '/entry-detail',
                    params: { entryId, viewAs: 'public' },
                })
            }
            // Chrome diet (TICKET-163): the workspace header is gone. The map owns
            // its corner chrome — filter chip + Import chip top-right, List pill
            // bottom-right (corner law v2). The old inbox card shrinks to a
            // status chip; the full card survives only as the list-mode inbox row.
            onSwitchToList={handleSwitchToPlaces}
            preserveItemOrder={mapSource === 'your' && !!selectedListId && !!selectedList?.ranked}
            collectionScopeKey={mapSource === 'your' && selectedListId ? `list:${selectedListId}` : null}
            focusItemId={mapSource === 'your' && selectedListId ? focusRestaurantId : null}
            emptyMessage={
                mapSource === 'your' && selectedListId
                    ? isSelectedListLoading
                        ? 'gathering this List…'
                        : isSelectedListError
                            ? 'couldn’t load this List.'
                            : 'this List has no mappable places for the current filters.'
                    : undefined
            }
            emptyAction={
                mapSource === 'your' && selectedListId && isSelectedListError
                    ? { label: 'Try again', onPress: () => void refetchSelectedList() }
                    : undefined
            }
            unmappableLabel={
                mapSource === 'your' && selectedListId && scopedListUnmappableCount > 0
                    ? `${scopedListUnmappableCount} ${scopedListUnmappableCount === 1 ? 'place in this List isn’t' : 'places in this List aren’t'} on the map`
                    : undefined
            }
            onOpenFilters={() => setFiltersOpen(true)}
            filtersActive={mapFiltersActive}
            onImport={() => setImportSheetVisible(true)}
            importStatus={
                importSlot && importSlot.kind !== 'recent'
                    ? {
                          icon: importSlot.icon,
                          count: importSlot.kind === 'review' ? importSlot.count : null,
                          accessibilityLabel: importSlot.title,
                          onPress: () => router.push(importSlot.route as any),
                      }
                    : undefined
            }
            sources={{
                options: [
                    { key: 'your', label: 'Your map' },
                    { key: 'discover', label: 'Discover' },
                ],
                value: mapSource,
                onChange: handleMapSource,
            }}
            peopleChip={
                mapSource === 'discover'
                    ? { label: peopleLabel, onPress: () => setPeopleSheetOpen(true) }
                    : undefined
            }
            listChip={
                mapSource === 'your'
                    ? {
                        label: activeListOption
                            ? `${activeListOption.emoji ? `${activeListOption.emoji} ` : ''}${activeListOption.title}`
                            : 'Lists',
                        selected: !!selectedListId,
                        onPress: () => setListsSheetOpen(true),
                    }
                    : undefined
            }
            // TICKET-138: overlap peek cards render "gather here" (only overlap
            // items call this; reachable on Discover with the people filter off).
            onGather={(item) => setGatherItem(item)}
            chromeTopOffset={insets.top + Spacing.sm}
            palette={palette}
        />
    );

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Full-bleed map — always mounted, edge to edge, behind the nav pill. */}
            {mapSurface}

            {/* List is an alternate presentation of the same Places workspace.
                The shared header renders above both surfaces. */}
            {viewMode === 'list' ? (
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        styles.listOverlay,
                        {
                            backgroundColor: palette.background,
                            paddingTop: insets.top + Spacing.xs,
                        },
                    ]}
                >
                    {/* Workspace bar — the list's own tools (chrome diet, TICKET-163):
                        Pinned | Lists segment + filter and import icon buttons. */}
                    <View style={styles.listBar}>
                        <View style={[styles.listSegment, { backgroundColor: palette.surfaceContainerLow }]}>
                            {(
                                [
                                    { key: 'pinned', label: 'Pinned' },
                                    { key: 'lists', label: listsCount > 0 ? `Lists · ${listsCount}` : 'Lists' },
                                ] as const
                            ).map((seg) => {
                                const on = activeTab === seg.key;
                                return (
                                    <Pressable
                                        key={seg.key}
                                        onPress={() => setActiveTab(seg.key)}
                                        style={[
                                            styles.listSegmentBtn,
                                            on && { backgroundColor: palette.card },
                                            on && Shadow.ambient,
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel={seg.label}
                                    >
                                        <Text
                                            style={[
                                                styles.listSegmentText,
                                                { color: on ? palette.text : palette.textMuted },
                                            ]}
                                        >
                                            {seg.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                        <View style={{ flex: 1 }} />
                        <Pressable
                            onPress={() => setFiltersOpen(true)}
                            hitSlop={8}
                            style={styles.listBarIcon}
                            accessibilityRole="button"
                            accessibilityLabel="filters"
                        >
                            <Ionicons
                                name="options-outline"
                                size={19}
                                color={filtersActive ? palette.primary : palette.textSecondary}
                            />
                            {filtersActive ? (
                                <View style={[styles.listBarDot, { backgroundColor: palette.primary }]} />
                            ) : null}
                        </Pressable>
                        <Pressable
                            onPress={() => setImportSheetVisible(true)}
                            hitSlop={8}
                            style={styles.listBarIcon}
                            accessibilityRole="button"
                            accessibilityLabel="import spots"
                        >
                            <Ionicons name="download-outline" size={19} color={palette.textSecondary} />
                        </Pressable>
                    </View>

                    {activeTab === 'pinned' ? (
                        isLoading && allItems.length === 0 ? (
                            <View style={styles.loadingCenter}>
                                <ActivityIndicator color={palette.primary} />
                            </View>
                        ) : totalPinned === 0 && !hasActiveFilters ? (
                            <WishlistEmptyState
                                palette={palette}
                                onImport={() => setImportSheetVisible(true)}
                                onSearch={() => router.push('/search' as any)}
                                hasImported={hasImported}
                                onImportsHub={() => router.push('/import-progress' as any)}
                            />
                        ) : (
                            <FlatList
                                style={styles.pinnedList}
                                data={displayedRows}
                                keyExtractor={(row) => row.item.id}
                                renderItem={({ item: row, index }) => (
                                    <WishlistSpotRow
                                        index={index + 1}
                                        item={row.item}
                                        distanceLabel={row.distanceLabel}
                                        palette={palette}
                                        onPress={() => handlePinnedRowPress(row.item)}
                                        onLongPress={() => setRemoveItem(row.item)}
                                        onRemove={() => setRemoveItem(row.item)}
                                    />
                                )}
                                contentContainerStyle={[
                                    styles.rListContent,
                                    { paddingBottom: insets.bottom + 150 },
                                ]}
                                showsVerticalScrollIndicator={false}
                                onEndReached={() => {
                                    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
                                }}
                                onEndReachedThreshold={0.4}
                                ListHeaderComponent={(
                                    <>
                                        {importSlot ? (
                                            <ImportInboxCard
                                                title={importSlot.title}
                                                sublabel={importSlot.sublabel}
                                                iconName={importSlot.icon}
                                                palette={palette}
                                                onPress={() => router.push(importSlot.route as any)}
                                            />
                                        ) : null}

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

                                        <View style={styles.rSpotsHeading}>
                                            <Text
                                                style={[
                                                    styles.rSpotsKicker,
                                                    styles.rSpotsKickerFlex,
                                                    { color: palette.textMuted },
                                                ]}
                                            >
                                                {`${displayedRows.length} ${displayedRows.length === 1 ? 'spot' : 'spots'}${filterSuffix}`}
                                            </Text>
                                            {totalPinned > 0 ? (
                                                <Pressable
                                                    onPress={() => setShareTarget({ count: totalPinned })}
                                                    style={({ pressed }) => [
                                                        styles.rShareButton,
                                                        {
                                                            backgroundColor: palette.surfaceJournalHi,
                                                            opacity: pressed ? 0.78 : 1,
                                                            transform: [{ scale: pressed ? 0.96 : 1 }],
                                                        },
                                                    ]}
                                                    accessibilityRole="button"
                                                    accessibilityLabel="share saved places"
                                                >
                                                    <Ionicons name="share-outline" size={16} color={palette.textSecondary} />
                                                </Pressable>
                                            ) : null}
                                        </View>
                                    </>
                                )}
                                ListEmptyComponent={(
                                    <View style={styles.rNoResults}>
                                        <Text style={[styles.rNoResultsTitle, { color: palette.text }]}>Nothing matches that</Text>
                                        <Text style={[styles.rNoResultsHint, { color: palette.textMuted }]}>Try loosening a filter.</Text>
                                        <Pressable
                                            onPress={clearFilters}
                                            style={[styles.rClearBtn, { borderColor: palette.terracottaBorder }]}
                                            accessibilityRole="button"
                                        >
                                            <Text style={[styles.rClearText, { color: palette.primary }]}>Clear filters</Text>
                                        </Pressable>
                                    </View>
                                )}
                                ListFooterComponent={
                                    isFetchingNextPage ? (
                                        <ActivityIndicator color={palette.primary} style={styles.loadMoreRow} size="small" />
                                    ) : null
                                }
                            />
                        )
                    ) : (
                        <ScrollView
                            contentContainerStyle={[
                                styles.rListContent,
                                { paddingBottom: insets.bottom + 150 },
                            ]}
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={[styles.rSpotsKicker, { color: palette.textMuted }]}>
                                {`${listsCount} ${listsCount === 1 ? 'list' : 'lists'}`}
                            </Text>
                            <Text style={[styles.rCollectionHeading, { color: palette.textMuted }]}>Your lists</Text>
                            {(myLists ?? []).map((list) => (
                                <WishlistListCardFull
                                    key={list.id}
                                    list={list}
                                    palette={palette}
                                    onPress={() => router.push(`/list/${list.id}` as any)}
                                />
                            ))}
                            <Pressable
                                onPress={() => router.push('/list/new' as any)}
                                style={[styles.rNewList, { borderColor: palette.terracottaBorder }]}
                                accessibilityRole="button"
                            >
                                <Ionicons name="add" size={17} color={palette.primary} />
                                <Text style={[styles.rNewListText, { color: palette.primary }]}>New list</Text>
                            </Pressable>
                            {(savedLists?.length ?? 0) > 0 ? (
                                <>
                                    <Text style={[styles.rCollectionHeading, styles.rSavedHeading, { color: palette.textMuted }]}>Saved lists</Text>
                                    {(savedLists ?? []).map((list) => (
                                        <SavedListCardFull
                                            key={list.id}
                                            list={list}
                                            palette={palette}
                                            scheme={scheme}
                                            onPress={() => router.push(`/list/${list.id}` as any)}
                                        />
                                    ))}
                                </>
                            ) : null}
                        </ScrollView>
                    )}

                    {/* Map pill — frosted, bottom-right; mirrors the map's List
                        pill geometry so the flip lives in one spot (corner law v2). */}
                    <Pressable
                        onPress={() => handleSelectView('map')}
                        style={[
                            styles.mapPill,
                            { backgroundColor: palette.card, bottom: insets.bottom + 92 },
                            Shadow.ambient,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="map view"
                    >
                        <Ionicons name="map-outline" size={15} color={palette.primary} />
                        <Text style={[styles.mapPillText, { color: palette.primary }]}>Map</Text>
                    </Pressable>
                </View>
            ) : null}

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

            <UnmappedSpotsSheet
                visible={unmappedSheetOpen}
                onClose={() => setUnmappedSheetOpen(false)}
                items={unmappedItems}
                userId={user?.id}
                palette={palette}
            />

            <FilterTabsSheet
                visible={filtersOpen}
                onDismiss={() => setFiltersOpen(false)}
                palette={palette}
                // Map mode: position is the signal → no Sort tab.
                hideSort={viewMode === 'map'}
                hideArea={hideAreaTab}
                cuisine={{ options: cuisineOptions, selected: cuisineFilter, onSelect: setCuisineFilter }}
                price={{ options: priceOptions, selected: priceFilter, onSelect: setPriceFilter }}
                area={{ options: cityOptions, selected: cityFilter, onSelect: setCityFilter }}
                sort={{ options: sortOptions, selected: sortMode, onSelect: handleSelectSort }}
                // "On the map" layer toggles — Your map only (TICKET-134).
                showSaved={
                    viewMode === 'map' && mapSource === 'your' && !selectedListId
                        ? { value: showSaved, onToggle: () => setShowSaved((v) => !v) }
                        : undefined
                }
                showBeen={
                    viewMode === 'map' && mapSource === 'your' && !selectedListId
                        ? { value: showBeen, onToggle: () => setShowBeen((v) => !v) }
                        : undefined
                }
            />

            {/* TICKET-111: remove-from-wishlist confirm (long-press or swipe). */}
            <OwnerActionsSheet
                visible={removeItem !== null}
                title={removeItem?.restaurant?.name ?? 'this spot'}
                subtitle="Remove from your wishlist?"
                actions={[
                    { label: 'Remove from wishlist', kind: 'destructive', onPress: handleConfirmRemove },
                ]}
                onCancel={() => setRemoveItem(null)}
            />

            <WishlistListsSheet
                visible={listsSheetOpen}
                onDismiss={() => setListsSheetOpen(false)}
                palette={palette}
                selectedListId={selectedListId}
                myLists={myListOptions}
                savedLists={savedListOptions}
                onSelect={handleSelectListScope}
            />

            {/* TICKET-137: Discover people picker (exclusive-include, draft-apply:
                the sheet owns a local draft; the map applies once on dismiss so it
                never reconciles markers under the open Modal — TICKET-147). */}
            <DiscoverPeopleSheet
                visible={peopleSheetOpen}
                onDismiss={() => setPeopleSheetOpen(false)}
                palette={palette}
                people={discoverPeople}
                checkedIds={checkedPeople}
                onApply={setCheckedPeople}
                countFor={peopleCountFor}
                // TICKET-139: "your table" rows — one tap drafts only that table's
                // members (overlap pins then hide per 138; their visits show).
                tableRows={tableRows}
            />

            {/* TICKET-138: "gather here" from an overlap peek → propose a date to
                the overlap's table. No photo_url (banned Places hero); the 409
                ALREADY_PROPOSED case is owned inside GatherSheet (Alert). */}
            <GatherSheet
                visible={gatherItem !== null}
                onClose={() => setGatherItem(null)}
                restaurant={{
                    id: gatherItem?.id,
                    name: gatherItem?.name ?? '',
                    city: gatherItem?.city ?? null,
                }}
                tableId={gatherItem?.overlap?.tableId ?? null}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    listOverlay: {
        zIndex: 10,
    },
    pinnedList: {
        flex: 1,
    },
    // List workspace bar — Pinned|Lists segment + filter/import icons (TICKET-163).
    listBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xs,
        paddingBottom: Spacing.sm,
        gap: 4,
    },
    listSegment: {
        flexDirection: 'row',
        borderRadius: 999,
        padding: 3,
        gap: 2,
    },
    listSegmentBtn: {
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 7,
    },
    listSegmentText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    listBarIcon: {
        padding: 8,
    },
    listBarDot: {
        position: 'absolute',
        top: 7,
        right: 6,
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    // Map pill — frosted flip back to the map, bottom-right over the list.
    mapPill: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    mapPillText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    rListContent: {
        paddingHorizontal: 20,
        paddingTop: Spacing.sm,
    },
    rSpotsHeading: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    rSpotsKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        paddingTop: 14,
        paddingBottom: 2,
    },
    rCollectionHeading: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 20,
        marginTop: 12,
        marginBottom: 10,
    },
    rSavedHeading: {
        marginTop: Spacing.xl,
    },
    rSpotsKickerFlex: {
        flex: 1,
    },
    rShareButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rNoResults: {
        alignItems: 'center',
        paddingVertical: 48,
        paddingHorizontal: 24,
    },
    rNoResultsTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
    },
    rNoResultsHint: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        marginTop: 6,
    },
    rClearBtn: {
        marginTop: 16,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 9,
    },
    rClearText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    rNewList: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderRadius: 18,
        paddingVertical: 20,
    },
    rNewListText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.2,
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
