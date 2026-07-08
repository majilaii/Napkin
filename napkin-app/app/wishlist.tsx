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
import {
    ImportLinkSheet,
    PendingSaveCard,
    HandoffSheet,
    WishlistMapView,
    type WishlistMapItem,
    // Wishlist Redesign (Pinned ↔ Lists) — numbered ledger + filter sheets + empty + inbox.
    WishlistSpotRow,
    WishlistListCardFull,
    WishlistEmptyState,
    FilterTabsSheet,
    type FilterOption,
    ImportInboxCard,
    DiscoverPeopleSheet,
} from '@/components/wishlist';
import { AddToListSheet } from '@/components/lists';
import { priceTierLabel } from '@/lib/priceLevel';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import { useHasImported } from '@/hooks/wishlist/useHasImported';
import { importSourceIcon, importSourceLabel, relativeTime } from '@/components/wishlist/importSourceLabel';
import { useCorrectImport } from '@/hooks/wishlist/useCorrectImport';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useListMapPins } from '@/hooks/lists/useListMapPins';
import { buildMapPins } from '@/components/wishlist/mapPinsUtils';
import {
    spotsToMapItems,
    networkPinsToMapItems,
    filterItemsByCuisine,
    mergeYourItems,
    peopleFromItems,
    filterByCheckedPeople,
    peopleChipLabel,
} from '@/components/wishlist/mapItems';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useNetworkMapPins } from '@/hooks/users/useNetworkMapPins';
import { useActiveImports } from '@/hooks/wishlist/useActiveImports';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { OwnerActionsSheet } from '@/components/common';
import { useToast } from '@/providers/ToastProvider';
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

// Pinned rows now render via WishlistSpotRow (numbered ledger) — see the redesign.

// ── Main screen ────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [importSheetVisible, setImportSheetVisible] = useState(false);
    const [correctItem, setCorrectItem] = useState<PersonalWishlistItem | null>(null);
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

    // TICKET-108: list-entry pins for the map — every restaurant across my lists
    // with coords + the owning list's emoji. Unioned into `mapItems` below.
    const { data: listMapPins } = useListMapPins(user?.id);

    // ── The import slot — ONE card, ever (review > running > failed > recent).
    // Active states route to the imports hub; a recently-saved batch (48h,
    // latest only) routes straight into its fix/prune screen. Never stacks.
    const { data: recentImports } = useRecentImports(user?.id, 4);
    const activeImports = useActiveImports();
    // Collapses the empty-state activation hub to compact once a first import lands.
    const hasImported = useHasImported(user?.id);
    const importSlot = useMemo(() => {
        const review = activeImports.filter((m) => m.phase === 'review');
        const working = activeImports.filter((m) => m.phase === 'reading' || m.phase === 'saving');
        const failed = activeImports.filter((m) => m.phase === 'failed');
        if (review.length > 0) {
            const n = review.reduce((sum, m) => sum + m.spotCount, 0);
            return {
                icon: 'sparkles-outline' as const,
                title: `${n} ${n === 1 ? 'spot' : 'spots'} ready to review`,
                sublabel: 'review and pin',
                // ALWAYS via the hub — deep-linking straight into the review
                // screen broke back-navigation (review → back should land on
                // the hub, not the wishlist; founder 2026-07-02).
                route: '/import-progress',
            };
        }
        if (working.length > 0) {
            return {
                icon: 'sync-outline' as const,
                title: working.length === 1 ? 'importing…' : `importing ${working.length}…`,
                sublabel: 'spots land here when done',
                route: '/import-progress',
            };
        }
        if (failed.length > 0) {
            return {
                icon: 'alert-circle-outline' as const,
                title: 'an import needs attention',
                sublabel: 'try again or discard',
                route: '/import-progress',
            };
        }
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        const latest = (recentImports ?? []).find(
            (b) => new Date(b.created_at).getTime() > cutoff,
        );
        if (latest) {
            return {
                icon: importSourceIcon(latest.source),
                title: `${latest.item_count} ${latest.item_count === 1 ? 'spot' : 'spots'} ${importSourceLabel(latest.source)}`,
                sublabel: `${relativeTime(latest.created_at)} · fix or prune in imports`,
                // Hierarchical back-nav is sacred: EVERY state of this card goes
                // via the imports hub — never deep-link past the intermediate
                // screen (founder rule, 2026-07-02, twice).
                route: '/import-progress',
            };
        }
        return null;
    }, [activeImports, recentImports]);

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

    // Save-from-the-map (network layer peek cards). Loaded pages are enough:
    // a stale miss just shows "Save" and the sheet's add is idempotent server-side.
    const wishlistAdd = useWishlistAdd(user?.id);
    const savedRestaurantIds = useMemo(
        () => new Set(allItems.map((i) => i.restaurant?.id).filter((id): id is string => !!id)),
        [allItems],
    );
    // TICKET-137: the peek Save pill now opens the SAME save sheet the restaurant
    // page uses (AddToListSheet — wishlist / list / unsave), rather than a one-tap
    // add. handleMapSave just targets the sheet; the sheet owns the mutations.
    const [saveSheetItem, setSaveSheetItem] = useState<WishlistMapItem | null>(null);
    const handleMapSave = useCallback((item: WishlistMapItem) => setSaveSheetItem(item), []);
    // Mirror the restaurant page's bookmark wiring for the sheet's Wishlist row:
    // a server-checked saved flag + an idempotent add / remove toggle. Network pin
    // ids are persisted restaurant UUIDs (networkPinsToMapItems → restaurant_id).
    const saveSheetSaved = useIsWishlisted(saveSheetItem?.id, user?.id);
    const handleToggleSaveSheetWishlist = useCallback(() => {
        const item = saveSheetItem;
        if (!item) return;
        if (saveSheetSaved) {
            wishlistRemove.mutate(item.id, {
                onError: () => toast.show('Could not remove that — try again'),
            });
        } else {
            wishlistAdd.mutate({ restaurant_id: item.id });
        }
    }, [saveSheetItem, saveSheetSaved, wishlistAdd, wishlistRemove, toast]);

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
    const handleMapSource = useCallback((key: string) => {
        const next = key as 'your' | 'discover';
        setMapSource(next);
        if (next === 'discover') setNetworkArmed(true);
    }, []);
    const { data: beenSpots } = useUserSpots(user?.id);
    const { data: networkPins } = useNetworkMapPins(networkArmed ? user?.id : null);
    // Watch position live while sorting by nearest or viewing the map, so distances
    // re-rank as you walk (Amsterdam-stroll fix) instead of freezing until restart.
    const { coords, status: locationStatus, request: requestLocation } = useNearbyLocation({
        watch: sortMode === 'near' || viewMode === 'map',
    });

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

    // Price tiers present in the saved set (1–4 → "$".."$$$$"), frequency-ranked,
    // for the Price filter sheet. Only tiers that exist appear as options.
    const priceCounts = useMemo(() => {
        const counts = new Map<number, number>();
        for (const i of pinnedRows) {
            const lvl = i.restaurant?.price_level;
            if (lvl != null && lvl > 0) counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([level, count]) => ({ level, count }))
            .sort((a, b) => a.level - b.level);
    }, [pinnedRows]);

    // Cities present in the saved set ("London", "Lisbon"…), frequency-ranked, for
    // the City filter — answers "show me only my London spots." Sourced from the
    // restaurant's Places locality (restaurants.city). Pill only appears below when
    // ≥2 cities exist (a single-city wishlist needs no city filter).
    const cityCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const i of pinnedRows) {
            const c = i.restaurant?.city?.trim();
            if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return [...counts.entries()]
            .map(([city, count]) => ({ city, count }))
            .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.city.localeCompare(b.city)));
    }, [pinnedRows]);

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

    // Map view: filtered union of (A) wishlist saves + (B) my-list entries
    // (TICKET-108). Sort is irrelevant on a map (position is the signal), so
    // this reads from pinnedRows/listMapPins directly, not the distance-decorated
    // displayedRows. The same city/cuisine/price filters apply to BOTH sources.
    //
    // Precedence (spec decision 3): key by restaurant id; seed with wishlist
    // saves (plain teardrop); then fold list pins ordered by list updated_at ASC
    // (newest written last, so it wins), and an emoji ALWAYS overwrites a plain save
    // (more specific). One pin per restaurant — matches Google Maps' one-icon rule.
    const { mapItems, unmappableCount } = useMemo(() => {
        const saves = pinnedRows
            .map((i) => i.restaurant)
            .filter((r): r is NonNullable<typeof r> => r != null)
            .map((r) => ({
                id: r.id, name: r.name, city: r.city, cuisine: r.cuisine,
                price_level: r.price_level ?? null,
                // lat/lng may be absent → buildMapPins counts them as unmappable.
                lat: r.lat ?? null, lng: r.lng ?? null,
            }));
        const { items, unmappableSaves } = buildMapPins(saves, listMapPins ?? [], {
            city: cityFilter,
            cuisine: cuisineFilter,
            price: priceFilter,
        });
        return { mapItems: items as WishlistMapItem[], unmappableCount: unmappableSaves };
    }, [pinnedRows, listMapPins, cityFilter, cuisineFilter, priceFilter]);

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

    // Picker roster — distinct authors across the network layer (no new endpoint;
    // reuses useNetworkMapPins). "Everyone you follow who has pins."
    const discoverPeople = useMemo(() => peopleFromItems(networkItems), [networkItems]);

    // Discover: network pins EXCLUSIVE-include filtered by the picker (empty = all).
    const discoverItems = useMemo(
        () => filterByCheckedPeople(networkItems, checkedPeople),
        [networkItems, checkedPeople],
    );

    const activeMapItems = mapSource === 'discover' ? discoverItems : yourItems;

    // Chip label reflects the checked set: Everyone · one name · N people.
    const peopleLabel = useMemo(
        () => peopleChipLabel(checkedPeople, discoverPeople),
        [checkedPeople, discoverPeople],
    );

    // Picker toggles: plain add/remove (exclusive-include); Everyone clears the set.
    const handleTogglePerson = useCallback((id: string) => {
        setCheckedPeople((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const handleEveryone = useCallback(() => setCheckedPeople(new Set()), []);

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

    // Switching to map opts into location lazily.
    const handleSelectView = useCallback((mode: 'list' | 'map') => {
        setViewMode(mode);
        if (mode === 'map') requestLocation();
    }, [requestLocation]);

    const totalPinned = pinnedRows.length;
    const listsCount = myLists?.length ?? 0;

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
            ? hasActiveFilters || !showSaved || !showBeen
            : !!cuisineFilter;

    // One trigger replaces the pill-per-sheet strip. List mode only since
    // TICKET-131 — map mode's trigger is the frosted Filter chip floating on the
    // map itself (WishlistMapView's onOpenFilters), opening the same sheet.
    const filtersTriggerRow = (
        <View style={styles.rFilterBar}>
            <Pressable
                onPress={() => setFiltersOpen(true)}
                style={[
                    styles.rFilterPill,
                    { backgroundColor: filtersActive ? palette.primaryMuted : palette.surfaceJournalHi },
                ]}
                accessibilityRole="button"
                accessibilityLabel="filters"
            >
                <Ionicons
                    name="options-outline"
                    size={15}
                    color={filtersActive ? palette.primary : palette.textSecondary}
                />
                <Text
                    style={[
                        styles.rFilterPillText,
                        { color: filtersActive ? palette.primary : palette.textSecondary },
                    ]}
                >
                    Filters
                </Text>
                {filtersActive ? (
                    <View style={[styles.rFilterDot, { backgroundColor: palette.primary }]} />
                ) : null}
            </Pressable>
        </View>
    );

    // ── Full-bleed map — ALWAYS mounted (the Map tab's hero). The list is an
    // opaque overlay ON TOP when viewMode==='list' (TICKET-134). Your map merges
    // saved+been; Discover shows the network layer + friend rail. The Filter chip
    // + sheet share the SAME filter state as the list, so toggling views never
    // loses filters (founder, 2026-07-03).
    const mapSurface = (
        <WishlistMapView
            items={activeMapItems}
            // Unmappable murmur is a saved-layer concern only.
            unmappableCount={mapSource === 'your' && showSaved ? unmappableCount : 0}
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
            onSwitchToList={() => setViewMode('list')}
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
            // Save-from-the-map (#167): Discover peek cards render a Save pill.
            save={{ savedIds: savedRestaurantIds, onSave: handleMapSave }}
            onOpenFilters={() => setFiltersOpen(true)}
            filtersActive={mapFiltersActive}
            chromeTopOffset={insets.top + 8}
            palette={palette}
        />
    );

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Full-bleed map — always mounted, edge to edge, behind the nav pill. */}
            {mapSurface}

            {/* List overlay — the entire wishlist surface (title · Import ·
                segmented · ledger · lists), opaque over the map. Toggled by the
                corner Map/List pills (viewMode). TICKET-134. */}
            {viewMode === 'list' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}>

            {/* Header — title left, share + Import right (redesign) */}
            <View style={[styles.rHeader, { paddingTop: insets.top + Spacing.sm }]}>
                <Text style={[styles.rTitle, { color: palette.text }]}>Wishlist</Text>
                <View style={styles.rHeaderActions}>
                    {totalPinned > 0 ? (
                        <Pressable
                            onPress={() => setShareTarget({ count: totalPinned })}
                            style={[styles.rHeaderIcon, { backgroundColor: palette.surfaceJournalHi }]}
                            hitSlop={8}
                            accessibilityLabel="share wishlist"
                        >
                            <Ionicons name="share-outline" size={17} color={palette.textSecondary} />
                        </Pressable>
                    ) : null}
                    <Pressable
                        onPress={() => setImportSheetVisible(true)}
                        style={[styles.rImportBtn, { backgroundColor: palette.primary }]}
                        hitSlop={8}
                        accessibilityLabel="import from a link"
                    >
                        <Ionicons name="download-outline" size={15} color="#fff" />
                        <Text style={styles.rImportText}>Import</Text>
                    </Pressable>
                </View>
            </View>

            {/* Segmented: Pinned ↔ Lists */}
            <View style={styles.rSegWrap}>
                <View style={[styles.rSeg, { backgroundColor: palette.surfaceJournalHi }]}>
                    {(['pinned', 'lists'] as const).map((tab) => {
                        const active = activeTab === tab;
                        const label = tab === 'pinned' ? `Pinned · ${totalPinned}` : `Lists · ${listsCount}`;
                        return (
                            <Pressable
                                key={tab}
                                onPress={() => setActiveTab(tab)}
                                style={[
                                    styles.rSegBtn,
                                    active && [styles.rSegBtnActive, { backgroundColor: palette.surfaceNote }],
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                            >
                                <Text style={[styles.rSegText, { color: active ? palette.primary : palette.textMuted }]}>
                                    {label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {/* ───────── PINNED ───────── */}
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
                    <View style={{ flex: 1 }}>
                        {/* Filter bar — one "Filters" trigger → tabbed sheet */}
                        {filtersTriggerRow}

                        <ScrollView
                            contentContainerStyle={[styles.rListContent, { paddingBottom: insets.bottom + 150 }]}
                            showsVerticalScrollIndicator={false}
                        >
                            {/* The import slot — one card, one state, one destination */}
                            {importSlot ? (
                                <ImportInboxCard
                                    title={importSlot.title}
                                    sublabel={importSlot.sublabel}
                                    iconName={importSlot.icon}
                                    palette={palette}
                                    onPress={() => router.push(importSlot.route as any)}
                                />
                            ) : null}

                            {/* needs-confirm captures — the existing correction flow */}
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

                            <Text style={[styles.rSpotsKicker, { color: palette.textMuted }]}>
                                {`${displayedRows.length} ${displayedRows.length === 1 ? 'spot' : 'spots'}${filterSuffix}`}
                            </Text>

                            {displayedRows.length === 0 ? (
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
                            ) : (
                                displayedRows.map(({ item, distanceLabel }, i) => (
                                    <WishlistSpotRow
                                        key={item.id}
                                        index={i + 1}
                                        item={item}
                                        distanceLabel={distanceLabel}
                                        palette={palette}
                                        onPress={() => handlePinnedRowPress(item)}
                                        onLongPress={() => setRemoveItem(item)}
                                        onRemove={() => setRemoveItem(item)}
                                    />
                                ))
                            )}

                            {hasNextPage && !isFetchingNextPage ? (
                                <Pressable onPress={() => fetchNextPage()} style={styles.loadMoreRow}>
                                    <Text style={[styles.loadMoreLabel, { color: palette.textMuted }]}>more</Text>
                                </Pressable>
                            ) : isFetchingNextPage ? (
                                <ActivityIndicator color={palette.primary} style={styles.loadMoreRow} size="small" />
                            ) : null}
                        </ScrollView>
                    </View>
                )
            ) : (
                /* ───────── LISTS ───────── */
                <ScrollView
                    contentContainerStyle={[styles.rListContent, { paddingBottom: insets.bottom + 150 }]}
                    showsVerticalScrollIndicator={false}
                >
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
                </ScrollView>
            )}

            {/* Map pill — bottom-RIGHT, mirrors the map's List pill (corner law v2,
                TICKET-137: mode toggle lives bottom-right in both directions). */}
            <Pressable
                onPress={() => handleSelectView('map')}
                style={[styles.rMapPill, { backgroundColor: palette.scrimFrost, bottom: insets.bottom + 92 }]}
                accessibilityRole="button"
                accessibilityLabel="map view"
            >
                <Ionicons name="map" size={15} color={palette.primary} />
                <Text style={[styles.rMapPillText, { color: palette.primary }]}>Map</Text>
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
                    viewMode === 'map' && mapSource === 'your'
                        ? { value: showSaved, onToggle: () => setShowSaved((v) => !v) }
                        : undefined
                }
                showBeen={
                    viewMode === 'map' && mapSource === 'your'
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

            {/* TICKET-137: Discover people picker (exclusive-include). */}
            <DiscoverPeopleSheet
                visible={peopleSheetOpen}
                onDismiss={() => setPeopleSheetOpen(false)}
                palette={palette}
                people={discoverPeople}
                checkedIds={checkedPeople}
                onToggle={handleTogglePerson}
                onEveryone={handleEveryone}
            />

            {/* TICKET-137: peek Save pill → the shared save sheet (wishlist / list /
                unsave), same component + data flow as the restaurant page bookmark. */}
            <AddToListSheet
                visible={saveSheetItem !== null}
                onClose={() => setSaveSheetItem(null)}
                userId={user?.id}
                restaurantId={saveSheetItem?.id}
                restaurantName={saveSheetItem?.name}
                showWishlist
                isWishlisted={saveSheetSaved}
                onToggleWishlist={handleToggleSaveSheetWishlist}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    // ── Wishlist Redesign ────────────────────────────────────────────────────
    rHeader: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 4,
    },
    rTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        letterSpacing: -0.5,
    },
    rHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rHeaderIcon: {
        width: 38,
        height: 38,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rImportBtn: {
        height: 38,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 15,
    },
    rImportText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.3,
        color: '#fff',
    },
    rSegWrap: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 6,
    },
    rSeg: {
        flexDirection: 'row',
        gap: 4,
        borderRadius: 13,
        padding: 4,
    },
    rSegBtn: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: 10,
    },
    rSegBtnActive: {
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 1,
    },
    rSegText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
        letterSpacing: 0.2,
    },
    rFilterBarScroll: {
        flexGrow: 0,
    },
    rFilterBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 8,
    },
    rFilterPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
    },
    rFilterPillText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    // Active-dot on the "Filters" trigger — a filter (or near sort) is engaged.
    rFilterDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    rListContent: {
        paddingHorizontal: 20,
        paddingTop: 4,
    },
    rSpotsKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        paddingTop: 14,
        paddingBottom: 2,
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
    // Map pill — bottom-RIGHT frosted (mirrors the map's List pill; corner law v2,
    // TICKET-137, ⑨ h42·13/800). Same frost family, same corner as the List pill.
    rMapPill: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 12,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 30,
    },
    rMapPillText: {
        fontFamily: 'Manrope_800ExtraBold',
        fontSize: 13,
        letterSpacing: 0.4,
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
    // Header (legacy — retained for unaffected styles below)
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
