import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    ActivityIndicator,
    FlatList,
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent,
    useWindowDimensions,
} from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Region } from 'react-native-maps';

import {
    ListsSearchPane,
    PeopleSearchPane,
    SearchLocalityBar,
    SearchModeTabs,
} from '@/components/search';
import type { SearchMode } from '@/components/search';
import { ErrorState, InlineErrorState } from '@/components/ErrorState';
import { PlacesListsPane } from '@/components/places/PlacesListsPane';
import { PlacesRatingLabel, PlacesRow } from '@/components/places/PlacesRow';
import { PlacesSearchSections } from '@/components/places/PlacesSearchSections';
import {
    SnapSheet,
    type SnapSheetContentContext,
    type SnapSheetHandle,
} from '@/components/sheets/SnapSheet';
import {
    FULL,
    PLACES_SNAP_METRICS,
    visibleHeight,
} from '@/components/sheets/snapSheetMath';
import {
    ClipTray,
    FilterTabsSheet,
    HandoffSheet,
    UnmappedSpotsSheet,
    WishlistMapView,
    type FilterOption,
    type WishlistMapItem,
} from '@/components/wishlist';
import {
    cityFacets,
    cuisineFacets,
    matchesFacets,
    priceFacets,
} from '@/components/wishlist/mapFacets';
import {
    composeFriendCaptionMeta,
    composeRowMeta,
    composePlacesContentKey,
    decorateAndSortRows,
    deriveDistanceOrigin,
    filterPlacesLayerRows,
    flattenPlacesCityGroups,
    groupRowsByCity,
    networkRowsToDisplayRows,
    placesCountLabel,
    placesListsContentBranch,
    placesSearchBranch,
    placesViewToggle,
    projectPlacesPins,
    resolvePlacesFailurePresentation,
    resolvePlacesListsBranch,
    resolvePlacesProjection,
    restaurantRouteForRow,
    searchRowsToDisplayRows,
    selectNearbyPlaces,
    shouldShowPlacesFollowingRail,
    shouldFetchNextPlacesPage,
    spotRowsToDisplayRows,
    wishlistRowsToDisplayRows,
    type DecoratedPlacesRow,
    type PlacesCityLedgerItem,
    type PlacesDisplayRow,
} from '@/components/places/placesPresentation';
import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    enterPlacesSearch,
    leavePlacesSearch,
    queryForPlacesRouteArrival,
    togglePlacesLayerFilter,
    transitionPlacesSegment,
    usePlacesScreenState,
} from '@/hooks/search/placesScreenState';
import { searchCache } from '@/hooks/search/searchCache';
import { searchLocalityLabel } from '@/hooks/search/searchLocalityStore';
import { useSearchLocality } from '@/hooks/search/useSearchLocality';
import {
    mergeUnified,
    useRecentSearches,
    useRestaurantSearch,
} from '@/hooks/search/useRestaurantSearch';
import { useUserProfile } from '@/hooks/users';
import { useNetworkMapPins } from '@/hooks/users/useNetworkMapPins';
import { useFollowingList } from '@/hooks/users/useFollowingList';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useSavedLists } from '@/hooks/lists/useSavedLists';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { priceTierLabel } from '@/lib/priceLevel';
import { useAuth } from '@/providers/AuthProvider';
import { useClipTray } from '@/hooks/imports/useClipTray';

const SEARCH_DEBOUNCE_MS = 250;
const NAV_CLEARANCE = 92;
const VIEW_TOGGLE_HEIGHT = Spacing.hitTarget;

type Palette = typeof Colors.light;
type FrozenProjection = {
    pins: WishlistMapItem[];
    rows: PlacesDisplayRow[];
    scopeKey: string;
};

function emptyProjection(): FrozenProjection {
    return { pins: [], rows: [], scopeKey: 'places:frozen-empty' };
}

function ClipPillRing({ color }: { color: string }) {
    const rotation = useSharedValue(0);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));

    useEffect(() => {
        rotation.value = withRepeat(
            withTiming(360, { duration: 1800, easing: Easing.linear }),
            -1,
            false,
        );
        return () => cancelAnimation(rotation);
    }, [rotation]);

    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.clipPillRing, { borderTopColor: color }, animatedStyle]}
        />
    );
}

function routeMode(mode: string | undefined): SearchMode | null {
    return mode === 'places' || mode === 'lists' || mode === 'people' ? mode : null;
}

function SheetStatePane({
    children,
    scrollEnabled,
    onScroll,
}: {
    children: React.ReactNode;
    scrollEnabled: boolean;
    onScroll?: SnapSheetContentContext['onScroll'];
}) {
    return (
        <Animated.FlatList
            data={[] as string[]}
            keyExtractor={(item) => item}
            renderItem={() => null}
            scrollEnabled={scrollEnabled}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.statePane}
            ListEmptyComponent={<View style={styles.statePaneBody}>{children}</View>}
        />
    );
}

function LayerChip({
    label,
    icon,
    active,
    palette,
    onPress,
}: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    active: boolean;
    palette: Palette;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.headerChip,
                Shadow.ambient,
                {
                    backgroundColor: active ? palette.primary : palette.scrimFrost,
                    opacity: pressed ? 0.72 : 1,
                },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
        >
            <Ionicons
                name={icon}
                size={14}
                color={active ? palette.textInverse : palette.textSecondary}
            />
            <Text
                style={[
                    styles.headerChipLabel,
                    { color: active ? palette.textInverse : palette.textSecondary },
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

export default function PlacesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const router = useRouter();
    const { user } = useAuth();
    const clipTray = useClipTray(user?.id);
    const { q: incomingQ, mode: incomingMode } = useLocalSearchParams<{
        q?: string;
        mode?: string;
    }>();
    const { value: screenState, patch: patchScreenState } = usePlacesScreenState(user?.id);
    const { locality, setAuto: setAutoLocality, setCity: setCityLocality } =
        useSearchLocality(user?.id);

    const requestedMode = routeMode(incomingMode)
        ?? (incomingQ !== undefined ? 'places' : null);
    const routeWantsSearch = incomingQ !== undefined || incomingMode !== undefined;
    const routeRequestedSegment = requestedMode === 'people' && FRIEND_TEST.hidePeopleSearch
        ? 'places'
        : requestedMode;
    const storedSegment = screenState.activeSegment === 'people' && FRIEND_TEST.hidePeopleSearch
        ? 'places'
        : screenState.activeSegment;
    const activeSegment = routeRequestedSegment
        ? routeRequestedSegment
        : storedSegment;
    const searchMode = routeWantsSearch || screenState.previousNonSearchSnap !== null;
    const listMode = !searchMode && screenState.viewMode === 'list';
    const mapMode = !searchMode && !listMode;
    const initialQuery = queryForPlacesRouteArrival(
        screenState.query,
        incomingQ,
        requestedMode,
    );
    const [immediateQuery, setImmediateQuery] = useState(initialQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
    const inputRef = useRef<TextInput>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const routeEffectHandledRef = useRef(false);
    const renderedUserRef = useRef(user?.id ?? null);

    const sheetH = Math.max(1, (height - insets.top) * 0.76);
    const firstSnap = searchMode || activeSegment === 'people' ? FULL : screenState.sheetSnap;
    const sheetRef = useRef<SnapSheetHandle>(null);
    const [bottomInset, setBottomInset] = useState(() => (
        visibleHeight(sheetH, firstSnap, PLACES_SNAP_METRICS)
    ));
    const [paperTopChromeHeight, setPaperTopChromeHeight] = useState<number | null>(null);
    const placesListRef = useRef<FlatList<DecoratedPlacesRow>>(null);
    const restoredScrollRef = useRef(false);

    useEffect(() => {
        const nextUserId = user?.id ?? null;
        if (renderedUserRef.current === nextUserId) return;
        renderedUserRef.current = nextUserId;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const nextQuery = queryForPlacesRouteArrival(
            screenState.query,
            incomingQ,
            requestedMode,
        );
        setImmediateQuery(nextQuery);
        setDebouncedQuery(nextQuery);
        restoredScrollRef.current = false;
        sheetRef.current?.snapTo(searchMode ? FULL : screenState.sheetSnap);
    }, [incomingQ, requestedMode, screenState.query, screenState.sheetSnap, searchMode, user?.id]);

    useEffect(() => {
        const hasRouteRequest = incomingQ !== undefined || incomingMode !== undefined;
        if (!hasRouteRequest) {
            routeEffectHandledRef.current = false;
            return;
        }
        if (routeEffectHandledRef.current) return;
        routeEffectHandledRef.current = true;
        let nextState = routeWantsSearch
            ? enterPlacesSearch(screenState)
            : screenState;
        if (requestedMode) {
            nextState = transitionPlacesSegment(
                nextState,
                requestedMode,
                FRIEND_TEST.hidePeopleSearch,
            );
        }
        const nextRouteQuery = queryForPlacesRouteArrival(
            nextState.query,
            incomingQ,
            requestedMode,
        );
        if (incomingQ !== undefined || requestedMode === 'lists' || requestedMode === 'people') {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = null;
            nextState = { ...nextState, query: nextRouteQuery };
            setImmediateQuery(nextRouteQuery);
            setDebouncedQuery(nextRouteQuery);
        }
        patchScreenState(nextState);
        if (nextState.sheetSnap !== screenState.sheetSnap) {
            sheetRef.current?.snapTo(nextState.sheetSnap);
        }
        if (routeWantsSearch) {
            setTimeout(() => inputRef.current?.focus(), 260);
        }
        if (hasRouteRequest) {
            router.setParams({ q: undefined, mode: undefined });
        }
    }, [
        incomingMode,
        incomingQ,
        patchScreenState,
        requestedMode,
        routeWantsSearch,
        router,
        screenState,
    ]);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    const {
        results,
        isLoading,
        isPlacesError,
        isPersistedError,
        refetchPlaces,
        refetchPersisted,
        coords: deviceCoords,
        permissionStatus,
        locationStatus,
        requestLocation,
    } = useRestaurantSearch(debouncedQuery, user?.id, {
        grantedLocationBias: true,
        locality,
        enabled: activeSegment === 'places',
    });

    const { data: ownProfileResult, isSuccess: profileSettled } = useUserProfile(user?.id);
    const homeCity = ownProfileResult?.data?.profile.home_city?.trim() || null;
    const localityLabel = searchLocalityLabel(
        locality,
        !!deviceCoords,
        homeCity,
        profileSettled,
    );
    const distanceOrigin = deriveDistanceOrigin(locality, deviceCoords);

    const wishlistQuery = useMyWishlist(user?.id);
    const spotsQuery = useUserSpots(user?.id);
    const networkQuery = useNetworkMapPins(user?.id, {
        enabled: screenState.layerFilter === 'friends',
    });
    const listsShelfVisible = activeSegment === 'lists'
        && immediateQuery.trim().length === 0;
    const myListsQuery = useMyLists(
        listsShelfVisible
            || (searchMode && activeSegment === 'places' && immediateQuery.trim().length === 0)
            ? user?.id
            : null,
    );
    const savedListsQuery = useSavedLists(user?.id, { enabled: listsShelfVisible });
    const followingQuery = useFollowingList(
        searchMode
            && activeSegment === 'places'
            && immediateQuery.trim().length === 0
            && !FRIEND_TEST.hidePeopleSearch
            ? user?.id
            : null,
    );
    const wishlistData = wishlistQuery.data;
    const spotsData = spotsQuery.data;
    const recentQueries = useRecentSearches();
    const loadedWishlistItems = useMemo(
        () => wishlistData?.pages.flatMap((page) => page.data ?? []) ?? [],
        [wishlistData],
    );
    const pinnedRows = useMemo(
        () => wishlistRowsToDisplayRows(loadedWishlistItems),
        [loadedWishlistItems],
    );
    const beenRows = useMemo(() => spotRowsToDisplayRows(spotsData ?? []), [spotsData]);
    const friendsRows = useMemo(
        () => networkRowsToDisplayRows(networkQuery.data ?? []),
        [networkQuery.data],
    );
    const allLayerRows = useMemo(
        () => filterPlacesLayerRows('all', pinnedRows, beenRows, friendsRows),
        [beenRows, friendsRows, pinnedRows],
    );
    const layerRows = useMemo(
        () => filterPlacesLayerRows(
            screenState.layerFilter,
            pinnedRows,
            beenRows,
            friendsRows,
        ),
        [beenRows, friendsRows, pinnedRows, screenState.layerFilter],
    );

    const mergedSearchRows = useMemo(
        () => searchRowsToDisplayRows(mergeUnified(results, debouncedQuery)),
        [debouncedQuery, results],
    );
    const queryActive = immediateQuery.trim().length >= 2;
    const sourceRows = queryActive ? mergedSearchRows : layerRows;
    const layerLoading = screenState.layerFilter === 'all'
        ? wishlistQuery.isLoading || spotsQuery.isLoading
        : screenState.layerFilter === 'pinned'
          ? wishlistQuery.isLoading
          : screenState.layerFilter === 'been'
            ? spotsQuery.isLoading
            : networkQuery.isLoading;
    const failurePresentation = resolvePlacesFailurePresentation({
        queryActive,
        layerFilter: screenState.layerFilter,
        hasCachedRows: sourceRows.length > 0,
        placesFailed: isPlacesError,
        persistedFailed: isPersistedError,
        wishlistFailed: wishlistQuery.isError,
        spotsFailed: spotsQuery.isError,
        networkFailed: networkQuery.isError,
    });
    const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
    const [priceFilter, setPriceFilter] = useState<string | null>(null);
    const [cityFilter, setCityFilter] = useState<string | null>(null);
    const filteredRows = useMemo(
        () => sourceRows.filter((row) => matchesFacets(row, {
            cuisine: cuisineFilter,
            price: priceFilter,
            city: cityFilter,
        })),
        [cityFilter, cuisineFilter, priceFilter, sourceRows],
    );
    const unmappedItems = useMemo(
        () => loadedWishlistItems.filter((item) => {
            const [row] = wishlistRowsToDisplayRows([item]);
            return row && (row.lat == null || row.lng == null);
        }),
        [loadedWishlistItems],
    );
    const unmappableCount = !searchMode
        && immediateQuery.trim().length === 0
        && (screenState.layerFilter === 'all' || screenState.layerFilter === 'pinned')
        ? unmappedItems.length
        : 0;
    const decoratedRows = useMemo(
        () => decorateAndSortRows(filteredRows, distanceOrigin),
        [distanceOrigin, filteredRows],
    );
    const cityGroups = useMemo(
        () => groupRowsByCity(decoratedRows, { locality, distanceOrigin, homeCity }),
        [decoratedRows, distanceOrigin, homeCity, locality],
    );
    const nearbySearchRows = useMemo(
        () => selectNearbyPlaces(allLayerRows, distanceOrigin),
        [allLayerRows, distanceOrigin],
    );
    const listsShelfBranch = resolvePlacesListsBranch({
        myCount: myListsQuery.data?.length ?? 0,
        savedCount: savedListsQuery.data?.length ?? 0,
        myLoading: myListsQuery.isLoading,
        savedLoading: savedListsQuery.isLoading,
        myError: myListsQuery.isError,
        savedError: savedListsQuery.isError,
    });
    const searchGuidanceBranch = placesSearchBranch(immediateQuery);
    // Unfreeze on the DEBOUNCED branch: flipping lock/scrim/projection on the
    // immediate keystroke stalls the JS thread mid-burst and drops characters.
    const guidanceSearchMode = searchMode && placesSearchBranch(debouncedQuery) !== 'results';
    const placesContentBranch = searchMode && searchGuidanceBranch !== 'results'
        ? searchGuidanceBranch
        : isLoading && decoratedRows.length === 0 && queryActive
          ? 'search-loading'
          : layerLoading && sourceRows.length === 0 && !queryActive
            ? 'layer-loading'
            : failurePresentation.kind === 'broken'
              ? 'broken'
              : queryActive
                ? 'results'
                : 'guidance';
    // The mounted list follows the DEBOUNCED query: a new query remounts the
    // scroll surface, so it must join the key or a stale offset survives A→B.
    const contentQueryKey = debouncedQuery.trim().toLowerCase();
    const segmentContentBranch = activeSegment === 'lists'
        ? placesListsContentBranch(immediateQuery, listsShelfBranch)
        : activeSegment === 'people'
          ? immediateQuery.trim().length === 0 ? 'guidance' : 'results'
          : searchMode
            ? placesContentBranch
            : `${placesContentBranch}-${screenState.layerFilter}`;
    const sheetContentKey = composePlacesContentKey({
        searchMode,
        segment: activeSegment,
        branch: segmentContentBranch,
        query: contentQueryKey,
    });
    const paginatedBrowse = !searchMode
        && activeSegment === 'places'
        && (screenState.layerFilter === 'all' || screenState.layerFilter === 'pinned');
    const placesHaveMore = paginatedBrowse && !!wishlistQuery.hasNextPage;
    const cityLedgerItems = useMemo(
        () => flattenPlacesCityGroups(cityGroups, placesHaveMore),
        [cityGroups, placesHaveMore],
    );
    const viewToggle = placesViewToggle(screenState.viewMode);
    const currentPins = useMemo(() => projectPlacesPins(filteredRows), [filteredRows]);
    const currentScopeKey = queryActive
        ? `search:${locality === 'auto' ? 'auto' : locality.city.trim().toLowerCase()}:${debouncedQuery.trim().toLowerCase()}`
        : `layer:${screenState.layerFilter}`;
    const currentProjection = useMemo<FrozenProjection>(() => ({
        pins: currentPins,
        rows: filteredRows,
        scopeKey: currentScopeKey,
    }), [currentPins, currentScopeKey, filteredRows]);
    const frozenProjectionRef = useRef<FrozenProjection>(emptyProjection());
    const frozenOwnerRef = useRef(user?.id ?? null);
    if (frozenOwnerRef.current !== (user?.id ?? null)) {
        // Synchronous identity fence: a direct Lists/People arrival for user B
        // must never render user A's last map for even one frame.
        frozenOwnerRef.current = user?.id ?? null;
        frozenProjectionRef.current = emptyProjection();
    }

    // Search unmounts the map, but keeps the last projection available so the
    // browse map can return without borrowing data from Lists or People.
    useEffect(() => {
        if (activeSegment === 'places' && !guidanceSearchMode) {
            frozenProjectionRef.current = currentProjection;
        }
    }, [activeSegment, currentProjection, guidanceSearchMode]);

    const renderedProjection = resolvePlacesProjection(
        activeSegment,
        currentProjection,
        frozenProjectionRef.current,
        guidanceSearchMode,
    ).rendered;
    const selectedRow = renderedProjection.rows.find(
        (row) => row.id === screenState.selectedPinId,
    ) ?? null;
    const selectedDistance = selectedRow
        ? decorateAndSortRows([selectedRow], distanceOrigin)[0]?.distanceLabel ?? null
        : null;
    const selectedCaptionVisible = mapMode && activeSegment === 'places' && !!selectedRow;

    useEffect(() => {
        const trimmed = debouncedQuery.trim();
        if (activeSegment === 'places' && trimmed.length >= 2) searchCache.addRecent(trimmed);
    }, [activeSegment, debouncedQuery]);

    const handleEnterSearch = useCallback(() => {
        const focused = enterPlacesSearch(screenState);
        patchScreenState(focused);
        sheetRef.current?.snapTo(FULL);
    }, [patchScreenState, screenState]);

    const handleLeaveSearch = useCallback(() => {
        Keyboard.dismiss();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        setImmediateQuery('');
        setDebouncedQuery('');
        const restored = leavePlacesSearch(screenState);
        patchScreenState(restored);
    }, [patchScreenState, screenState]);

    const handleQueryChange = useCallback((text: string) => {
        setImmediateQuery(text);
        patchScreenState({ query: text });
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            setDebouncedQuery(text);
        }, SEARCH_DEBOUNCE_MS);
    }, [patchScreenState]);

    const handleClearQuery = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        setImmediateQuery('');
        setDebouncedQuery('');
        patchScreenState({ query: '', scrollOffset: 0 });
    }, [patchScreenState]);

    const handleRegionChangeComplete = useCallback((region: Region) => {
        patchScreenState({ region });
    }, [patchScreenState]);

    const handlePaperTopChromeLayout = useCallback((event: LayoutChangeEvent) => {
        const nextHeight = Math.ceil(event.nativeEvent.layout.height);
        if (nextHeight <= 0) return;
        setPaperTopChromeHeight((current) => current === nextHeight ? current : nextHeight);
    }, []);

    const handleViewToggle = useCallback(() => {
        patchScreenState({
            viewMode: viewToggle.target,
            selectedPinId: null,
            scrollOffset: 0,
        });
    }, [patchScreenState, viewToggle.target]);

    const handleRetryFailure = useCallback(() => {
        for (const source of failurePresentation.sources) {
            if (source === 'places') refetchPlaces();
            if (source === 'persisted') refetchPersisted();
            if (source === 'wishlist') void wishlistQuery.refetch();
            if (source === 'spots') void spotsQuery.refetch();
            if (source === 'network') void networkQuery.refetch();
        }
    }, [
        failurePresentation.sources,
        refetchPersisted,
        refetchPlaces,
        networkQuery,
        spotsQuery,
        wishlistQuery,
    ]);

    const handleSegmentChange = useCallback((next: SearchMode) => {
        Keyboard.dismiss();
        const transitioned = transitionPlacesSegment(
            screenState,
            next,
            FRIEND_TEST.hidePeopleSearch,
        );
        patchScreenState(transitioned);
        if (mapMode) sheetRef.current?.snapTo(transitioned.sheetSnap);
    }, [mapMode, patchScreenState, screenState]);

    const openRestaurant = useCallback((row: PlacesDisplayRow) => {
        const route = restaurantRouteForRow(row);
        if (route) router.push(route as never);
    }, [router]);

    const openList = useCallback((list: { id: string }) => {
        router.push({ pathname: '/list/[id]', params: { id: list.id } });
    }, [router]);

    const handleLayerPress = useCallback((requested: 'pinned' | 'been' | 'friends') => {
        patchScreenState({
            layerFilter: togglePlacesLayerFilter(screenState.layerFilter, requested),
            selectedPinId: null,
            scrollOffset: 0,
        });
    }, [patchScreenState, screenState.layerFilter]);

    const handleCurrentLocation = useCallback(() => {
        setAutoLocality();
        if (permissionStatus === null || permissionStatus === 'undetermined') {
            void requestLocation();
        }
    }, [permissionStatus, requestLocation, setAutoLocality]);

    const handlePlacesEndReached = useCallback(() => {
        if (shouldFetchNextPlacesPage({
            searchMode,
            activeSegment,
            layerFilter: screenState.layerFilter,
            hasNextPage: !!wishlistQuery.hasNextPage,
            isFetchingNextPage: wishlistQuery.isFetchingNextPage,
        })) {
            void wishlistQuery.fetchNextPage();
        }
    }, [activeSegment, screenState.layerFilter, searchMode, wishlistQuery]);

    const [filterOpen, setFilterOpen] = useState(false);
    const [trayOpen, setTrayOpen] = useState(false);
    const [unmappedSheetOpen, setUnmappedSheetOpen] = useState(false);
    const [handoffOpen, setHandoffOpen] = useState(false);
    const cuisineOptions = useMemo<FilterOption[]>(() => [
        { value: null, label: 'All cuisines' },
        ...cuisineFacets(sourceRows).map((facet) => ({
            value: facet.value,
            label: facet.value,
            count: facet.count,
        })),
    ], [sourceRows]);
    const priceOptions = useMemo<FilterOption[]>(() => [
        { value: null, label: 'All prices' },
        ...priceFacets(sourceRows).map((facet) => ({
            value: String(facet.value),
            label: priceTierLabel(facet.value),
            count: facet.count,
        })),
    ], [sourceRows]);
    const areaOptions = useMemo<FilterOption[]>(() => [
        { value: null, label: 'All areas' },
        ...cityFacets(sourceRows).map((facet) => ({
            value: facet.value,
            label: facet.value,
            count: facet.count,
        })),
    ], [sourceRows]);
    const filtersActive = Boolean(cuisineFilter || priceFilter || cityFilter);
    const sharePinnedVisible = !searchMode
        && activeSegment === 'places'
        && screenState.layerFilter === 'pinned'
        && pinnedRows.length > 0;

    const renderSheetHeader = useCallback(() => (
        <View style={styles.sheetHeader}>
            <SearchModeTabs
                mode={activeSegment}
                onModeChange={handleSegmentChange}
                hidePeople={FRIEND_TEST.hidePeopleSearch}
            />
            {activeSegment === 'places' && (!searchMode || queryActive) ? (
                <View style={styles.sheetLedgerHeader}>
                    <Text style={[styles.kicker, { color: palette.primary }]}>
                        {queryActive ? 'RESULTS' : 'NEARBY'}
                    </Text>
                    <View style={styles.countActions}>
                        <Text style={[styles.placeCount, { color: palette.textMuted }]}>
                            {placesCountLabel(decoratedRows.length, placesHaveMore)}
                        </Text>
                        {sharePinnedVisible ? (
                            <Pressable
                                onPress={() => setHandoffOpen(true)}
                                style={styles.shareAction}
                                accessibilityRole="button"
                                accessibilityLabel="share pinned places"
                            >
                                <Ionicons
                                    name="share-outline"
                                    size={IconSize.md - 1}
                                    color={palette.textMuted}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            ) : null}
        </View>
    ), [
        activeSegment,
        decoratedRows.length,
        handleSegmentChange,
        palette.primary,
        palette.textMuted,
        placesHaveMore,
        queryActive,
        searchMode,
        sharePinnedVisible,
    ]);

    const restoreScroll = useCallback(() => {
        if (restoredScrollRef.current || screenState.scrollOffset <= 0) return;
        restoredScrollRef.current = true;
        placesListRef.current?.scrollToOffset({
            offset: screenState.scrollOffset,
            animated: false,
        });
    }, [screenState.scrollOffset]);

    const renderPaperContent = () => {
        if (activeSegment === 'lists') {
            if (immediateQuery.trim().length === 0) {
                return (
                    <PlacesListsPane
                        branch={listsShelfBranch}
                        myLists={myListsQuery.data ?? []}
                        savedLists={savedListsQuery.data ?? []}
                        myError={myListsQuery.isError}
                        savedError={savedListsQuery.isError}
                        scrollEnabled
                        onOpenList={(id) => openList({ id })}
                        onNewList={() => router.push('/list/new')}
                        onRetryMyLists={() => { void myListsQuery.refetch(); }}
                        onRetrySavedLists={() => { void savedListsQuery.refetch(); }}
                        bottomPadding={insets.bottom + NAV_CLEARANCE}
                    />
                );
            }
            if (immediateQuery.trim().length === 1) {
                return (
                    <SheetStatePane scrollEnabled>
                        <View style={styles.emptyResults}>
                            <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                                type one more letter
                            </Text>
                        </View>
                    </SheetStatePane>
                );
            }
            return (
                <ListsSearchPane
                    query={immediateQuery}
                    debouncedQuery={debouncedQuery}
                />
            );
        }

        if (activeSegment === 'people') {
            return (
                <PeopleSearchPane
                    query={immediateQuery}
                    debouncedQuery={debouncedQuery}
                />
            );
        }

        if (searchMode && searchGuidanceBranch === 'sections') {
            const followingRows = followingQuery.data ?? [];
            const following = shouldShowPlacesFollowingRail(
                FRIEND_TEST.hidePeopleSearch,
                followingRows.length,
            ) ? followingRows : [];
            return (
                <PlacesSearchSections
                    recentQueries={recentQueries.slice(0, 8)}
                    nearbyRows={nearbySearchRows}
                    myLists={(myListsQuery.data ?? []).slice(0, 4)}
                    following={following}
                    loading={wishlistQuery.isLoading
                        || spotsQuery.isLoading
                        || myListsQuery.isLoading
                        || followingQuery.isLoading}
                    onSelectRecent={handleQueryChange}
                    onClearRecent={searchCache.clearRecents}
                    onOpenRestaurant={openRestaurant}
                    onOpenList={openList}
                    onOpenPerson={(identifier) => router.push({
                        pathname: '/u/[identifier]',
                        params: { identifier },
                    })}
                    bottomPadding={insets.bottom + NAV_CLEARANCE}
                />
            );
        }

        if (searchMode && searchGuidanceBranch === 'minimum') {
            return (
                <SheetStatePane scrollEnabled>
                    <View style={styles.emptyResults}>
                        <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                            type one more letter
                        </Text>
                    </View>
                </SheetStatePane>
            );
        }

        if (isLoading && decoratedRows.length === 0 && queryActive) {
            return (
                <SheetStatePane scrollEnabled>
                    <ActivityIndicator style={styles.loader} color={palette.primary} />
                </SheetStatePane>
            );
        }
        if (layerLoading && sourceRows.length === 0 && !queryActive) {
            return (
                <SheetStatePane scrollEnabled>
                    <ActivityIndicator style={styles.loader} color={palette.primary} />
                </SheetStatePane>
            );
        }
        if (failurePresentation.kind === 'broken') {
            return (
                <SheetStatePane scrollEnabled>
                    <ErrorState onRetry={handleRetryFailure} message="couldn't load places" />
                </SheetStatePane>
            );
        }

        if (listMode) {
            return (
                <Animated.FlatList<PlacesCityLedgerItem>
                    testID="places-city-ledger"
                    data={cityLedgerItems}
                    keyExtractor={(item) => item.key}
                    renderItem={({ item }) => item.kind === 'header' ? (
                        <View style={[
                            styles.cityGroupHeader,
                            !item.isFirst && styles.cityGroupHeaderLater,
                        ]}>
                            <Text style={[styles.kicker, { color: palette.primary }]}>
                                {item.label}
                            </Text>
                            <Text style={[styles.placeCount, { color: palette.textMuted }]}>
                                {placesCountLabel(item.count, item.hasMore)}
                            </Text>
                        </View>
                    ) : (
                        <PlacesRow item={item.item} onPress={openRestaurant} />
                    )}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    onEndReached={handlePlacesEndReached}
                    onEndReachedThreshold={0.4}
                    contentContainerStyle={[
                        styles.cityLedgerContent,
                        {
                            paddingBottom: insets.bottom
                                + NAV_CLEARANCE
                                + VIEW_TOGGLE_HEIGHT
                                + Spacing.md,
                        },
                    ]}
                    ListHeaderComponent={failurePresentation.kind === 'inline'
                        ? (
                            <InlineErrorState
                                onRetry={handleRetryFailure}
                                message="couldn't refresh places"
                            />
                        )
                        : null}
                    ListEmptyComponent={(
                        <View style={styles.emptyResults}>
                            <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                                {screenState.layerFilter === 'pinned'
                                    ? 'no pinned places yet'
                                    : screenState.layerFilter === 'been'
                                      ? 'no logged places yet'
                                      : screenState.layerFilter === 'friends'
                                        ? 'nothing from friends yet'
                                        : 'no places yet'}
                            </Text>
                        </View>
                    )}
                    ListFooterComponent={paginatedBrowse && wishlistQuery.isFetchingNextPage
                        ? <ActivityIndicator color={palette.primary} style={styles.pageLoader} />
                        : null}
                />
            );
        }

        return (
            <Animated.FlatList
                testID="places-paper-results"
                data={decoratedRows}
                keyExtractor={({ row }) => row.id}
                renderItem={({ item }) => <PlacesRow item={item} onPress={openRestaurant} />}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={[
                    styles.resultsContent,
                    { paddingBottom: insets.bottom + NAV_CLEARANCE },
                ]}
                ListHeaderComponent={failurePresentation.kind === 'inline'
                    ? (
                        <InlineErrorState
                            onRetry={handleRetryFailure}
                            message="couldn't refresh places"
                        />
                    )
                    : null}
                ListEmptyComponent={(
                    <View style={styles.emptyResults}>
                        <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                            {queryActive ? 'no places found' : 'no places yet'}
                        </Text>
                    </View>
                )}
            />
        );
    };

    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            {mapMode ? (
                <WishlistMapView
                    items={renderedProjection.pins}
                    unmappableCount={unmappableCount}
                    onUnmappablePress={unmappableCount > 0
                        ? () => setUnmappedSheetOpen(true)
                        : undefined}
                    userCoords={deviceCoords}
                    locationStatus={locationStatus}
                    onRequestLocation={() => { void requestLocation(); }}
                    onOpenRestaurant={(id) => {
                        const row = renderedProjection.rows.find((candidate) => candidate.id === id);
                        if (row) openRestaurant(row);
                    }}
                    peek="none"
                    selectedId={screenState.selectedPinId}
                    onSelectedChange={(selectedPinId) => patchScreenState({ selectedPinId })}
                    initialRegion={screenState.region ?? undefined}
                    onRegionChangeComplete={handleRegionChangeComplete}
                    bottomInset={bottomInset}
                    preserveItemOrder={!distanceOrigin}
                    collectionScopeKey={renderedProjection.scopeKey}
                    // Murmur sits below the search pill + chip row (top wash is opaque to ~130pt).
                    chromeTopOffset={insets.top + 108}
                    palette={palette}
                />
            ) : null}

            {!searchMode && !selectedCaptionVisible ? (
                <Pressable
                    testID="places-view-toggle"
                    onPress={handleViewToggle}
                    style={({ pressed }) => [
                        styles.viewToggle,
                        Shadow.ambient,
                        {
                            bottom: mapMode
                                ? bottomInset + Spacing.sm + Spacing.xs
                                : insets.bottom + NAV_CLEARANCE,
                            backgroundColor: palette.scrimFrost,
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${viewToggle.label} places`}
                >
                    <Ionicons name={viewToggle.icon} size={IconSize.md} color={palette.primary} />
                    <Text style={[styles.viewToggleLabel, { color: palette.primary }]}>
                        {viewToggle.label}
                    </Text>
                </Pressable>
            ) : null}

            <View
                testID="places-top-chrome"
                onLayout={mapMode ? undefined : handlePaperTopChromeLayout}
                style={[
                    styles.topChrome,
                    mapMode && styles.mapTopChrome,
                    { paddingTop: insets.top + Spacing.sm },
                ]}
                pointerEvents="box-none"
            >
                <LinearGradient
                    colors={mapMode
                        ? [
                            palette.background,
                            `${palette.background}F2`,
                            `${palette.background}00`,
                        ]
                        : [palette.background, palette.background, palette.background]}
                    locations={[0, 0.7, 1]}
                    style={styles.topWashFill}
                    pointerEvents="none"
                />
                <View style={styles.searchLine}>
                    <View
                        style={[
                            styles.searchPill,
                            searchMode && styles.searchTakeoverPill,
                            Shadow.ambient,
                            { backgroundColor: palette.surfaceNote },
                        ]}
                    >
                        {searchMode ? (
                            <Pressable
                                onPress={handleLeaveSearch}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel="back to places map"
                            >
                                <Ionicons name="chevron-back-outline" size={20} color={palette.textMuted} />
                            </Pressable>
                        ) : (
                            <Ionicons name="search-outline" size={20} color={palette.textMuted} />
                        )}
                        <TextInput
                            ref={inputRef}
                            value={immediateQuery}
                            onFocus={handleEnterSearch}
                            onChangeText={handleQueryChange}
                            placeholder={searchMode ? 'find a place, list or person' : 'find a place'}
                            placeholderTextColor={palette.textFaint}
                            selectionColor={palette.primary}
                            style={[styles.searchInput, { color: palette.text }]}
                            autoCorrect={false}
                            returnKeyType="search"
                            clearButtonMode="never"
                            accessibilityLabel="find a place, list, or person"
                        />
                        {searchMode || immediateQuery ? (
                            <Pressable
                                onPress={handleClearQuery}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel="clear search"
                            >
                                <Ionicons name="close-circle" size={19} color={palette.textFaint} />
                            </Pressable>
                        ) : null}
                    </View>
                    {!searchMode ? (
                        <Pressable
                            onPress={() => setTrayOpen(true)}
                            style={({ pressed }) => [
                                styles.iconButton,
                                Shadow.ambient,
                                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.7 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="import places"
                        >
                            {clipTray.pill.kind === 'clipping' ? (
                                <ClipPillRing color={palette.primary} />
                            ) : null}
                            <Ionicons name="download-outline" size={20} color={palette.textSecondary} />
                            {clipTray.pill.kind === 'needsLook' ? (
                                <View
                                    pointerEvents="none"
                                    style={[styles.clipCountDot, { backgroundColor: palette.primary }]}
                                >
                                    <Text style={[styles.clipCountText, { color: palette.textInverse }]}>
                                        {clipTray.pill.count}
                                    </Text>
                                </View>
                            ) : null}
                        </Pressable>
                    ) : null}
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroller}
                    contentContainerStyle={styles.chipLine}
                >
                    <SearchLocalityBar
                        compact
                        label={localityLabel}
                        locality={locality}
                        onSelectCurrentLocation={handleCurrentLocation}
                        onSelectCity={setCityLocality}
                    />
                    {!searchMode ? (
                        <>
                            <LayerChip
                                label="pinned"
                                icon="bookmark-outline"
                                active={screenState.layerFilter === 'pinned'}
                                palette={palette}
                                onPress={() => handleLayerPress('pinned')}
                            />
                            <LayerChip
                                label="been"
                                icon="checkmark-circle-outline"
                                active={screenState.layerFilter === 'been'}
                                palette={palette}
                                onPress={() => handleLayerPress('been')}
                            />
                            <LayerChip
                                label="friends"
                                icon="people-outline"
                                active={screenState.layerFilter === 'friends'}
                                palette={palette}
                                onPress={() => handleLayerPress('friends')}
                            />
                            <Pressable
                                onPress={() => setFilterOpen(true)}
                                style={({ pressed }) => [
                                    styles.filterButton,
                                    Shadow.ambient,
                                    {
                                        backgroundColor: palette.scrimFrost,
                                        opacity: pressed ? 0.7 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="filters"
                            >
                                <Ionicons
                                    name="options-outline"
                                    size={16}
                                    color={filtersActive ? palette.primary : palette.textSecondary}
                                />
                                {filtersActive ? (
                                    <View style={[styles.filterDot, { backgroundColor: palette.primary }]} />
                                ) : null}
                            </Pressable>
                        </>
                    ) : null}
                </ScrollView>
            </View>

            {!mapMode ? (
                <View
                    testID="places-paper-surface"
                    style={[
                        styles.paperSurface,
                        {
                            backgroundColor: palette.background,
                            paddingTop: (paperTopChromeHeight ?? 0) + Spacing.sm,
                            opacity: paperTopChromeHeight == null ? 0 : 1,
                        },
                    ]}
                >
                    <View style={styles.paperTabs}>
                        <SearchModeTabs
                            mode={activeSegment}
                            onModeChange={handleSegmentChange}
                            hidePeople={FRIEND_TEST.hidePeopleSearch}
                        />
                    </View>
                    {searchMode && activeSegment === 'places' && queryActive ? (
                        <View style={styles.sheetLedgerHeader}>
                            <Text style={[styles.kicker, { color: palette.primary }]}>RESULTS</Text>
                            <Text style={[styles.placeCount, { color: palette.textMuted }]}>
                                {placesCountLabel(decoratedRows.length, false)}
                            </Text>
                        </View>
                    ) : null}
                    <View style={styles.paperBody}>{renderPaperContent()}</View>
                </View>
            ) : null}

            {selectedCaptionVisible && selectedRow ? (
                <Pressable
                    onPress={() => openRestaurant(selectedRow)}
                    style={[
                        styles.selectedCaption,
                        Shadow.ambient,
                        {
                            bottom: bottomInset + 12,
                            backgroundColor: palette.surfaceNote,
                        },
                    ]}
                    accessibilityRole="button"
                    testID="places-selected-caption"
                    accessibilityLabel={`open ${selectedRow.name}`}
                >
                    <View style={styles.captionCopy}>
                        <View style={styles.nameRatingLine}>
                            <Text style={[styles.captionName, { color: palette.text }]} numberOfLines={1}>
                                {selectedRow.name}
                            </Text>
                            <PlacesRatingLabel row={selectedRow} />
                        </View>
                        <Text style={[styles.resultMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {selectedRow.network
                                ? composeFriendCaptionMeta(selectedRow)
                                : composeRowMeta(
                                    { ...selectedRow, friendsBeenCount: 0, isPinned: false },
                                    selectedDistance,
                                )}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward-outline" size={17} color={palette.textFaint} />
                </Pressable>
            ) : null}

            {mapMode ? (
            <SnapSheet
                H={sheetH}
                initialSnap={firstSnap}
                locked={guidanceSearchMode}
                lockedSnap={FULL}
                unlockedSnap={screenState.sheetSnap}
                sheetRef={sheetRef}
                backgroundColor={palette.surfaceNote}
                handleColor={palette.ruleWarmNib}
                metrics={PLACES_SNAP_METRICS}
                contentKey={sheetContentKey}
                onPanStart={Keyboard.dismiss}
                onSettle={(sheetSnap, settledHeight) => {
                    setBottomInset(settledHeight);
                    patchScreenState({ sheetSnap });
                }}
                renderHeader={renderSheetHeader}
                renderContent={({ scrollEnabled, onScroll }) => {
                    if (activeSegment === 'lists') {
                        if (immediateQuery.trim().length === 0) {
                            return (
                                <PlacesListsPane
                                    branch={listsShelfBranch}
                                    myLists={myListsQuery.data ?? []}
                                    savedLists={savedListsQuery.data ?? []}
                                    myError={myListsQuery.isError}
                                    savedError={savedListsQuery.isError}
                                    scrollEnabled={scrollEnabled}
                                    onScroll={onScroll}
                                    onOpenList={(id) => openList({ id })}
                                    onNewList={() => router.push('/list/new')}
                                    onRetryMyLists={() => { void myListsQuery.refetch(); }}
                                    onRetrySavedLists={() => { void savedListsQuery.refetch(); }}
                                    bottomPadding={insets.bottom + NAV_CLEARANCE}
                                />
                            );
                        }
                        if (immediateQuery.trim().length === 1) {
                            return (
                                <SheetStatePane scrollEnabled={scrollEnabled} onScroll={onScroll}>
                                    <View style={styles.emptyResults}>
                                        <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                                            type one more letter
                                        </Text>
                                    </View>
                                </SheetStatePane>
                            );
                        }
                        return (
                            <ListsSearchPane
                                query={immediateQuery}
                                debouncedQuery={debouncedQuery}
                                scrollEnabled={scrollEnabled}
                                onScroll={onScroll}
                            />
                        );
                    }
                    if (activeSegment === 'people') {
                        return (
                            <PeopleSearchPane
                                query={immediateQuery}
                                debouncedQuery={debouncedQuery}
                                scrollEnabled={scrollEnabled}
                                onScroll={onScroll}
                            />
                        );
                    }
                    if (isLoading && decoratedRows.length === 0 && queryActive) {
                        return (
                            <SheetStatePane scrollEnabled={scrollEnabled} onScroll={onScroll}>
                                <ActivityIndicator style={styles.loader} color={palette.primary} />
                            </SheetStatePane>
                        );
                    }
                    if (layerLoading && sourceRows.length === 0 && !queryActive) {
                        return (
                            <SheetStatePane scrollEnabled={scrollEnabled} onScroll={onScroll}>
                                <ActivityIndicator style={styles.loader} color={palette.primary} />
                            </SheetStatePane>
                        );
                    }
                    if (failurePresentation.kind === 'broken') {
                        return (
                            <SheetStatePane scrollEnabled={scrollEnabled} onScroll={onScroll}>
                                <ErrorState
                                    onRetry={handleRetryFailure}
                                    message="couldn't load places"
                                />
                            </SheetStatePane>
                        );
                    }
                    return (
                        <Animated.FlatList
                            testID="places-results"
                            ref={placesListRef}
                            data={decoratedRows}
                            keyExtractor={({ row }) => row.id}
                            renderItem={({ item }) => (
                                <PlacesRow item={item} onPress={openRestaurant} />
                            )}
                            scrollEnabled={scrollEnabled}
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            onContentSizeChange={restoreScroll}
                            onMomentumScrollEnd={(event) => patchScreenState({
                                scrollOffset: event.nativeEvent.contentOffset.y,
                            })}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="on-drag"
                            onEndReached={handlePlacesEndReached}
                            onEndReachedThreshold={0.4}
                            contentContainerStyle={[
                                styles.resultsContent,
                                { paddingBottom: insets.bottom + NAV_CLEARANCE },
                            ]}
                            ListHeaderComponent={(
                                <>
                                    {failurePresentation.kind === 'inline' ? (
                                        <InlineErrorState
                                            onRetry={handleRetryFailure}
                                            message="couldn't refresh places"
                                        />
                                    ) : null}
                                </>
                            )}
                            ListEmptyComponent={
                                <View style={styles.emptyResults}>
                                    <Text
                                        style={[styles.emptyCopy, { color: palette.textMuted }]}
                                    >
                                        {immediateQuery.trim().length === 1
                                              ? 'type one more letter'
                                              : queryActive
                                                ? 'no places found'
                                                : screenState.layerFilter === 'pinned'
                                                  ? 'no pinned places yet'
                                                  : screenState.layerFilter === 'been'
                                                    ? 'no logged places yet'
                                                    : screenState.layerFilter === 'friends'
                                                      ? 'nothing from friends yet'
                                                      : 'no places yet'}
                                    </Text>
                                </View>
                            }
                            ListFooterComponent={paginatedBrowse && wishlistQuery.isFetchingNextPage
                                ? (
                                    <ActivityIndicator
                                        color={palette.primary}
                                        style={styles.pageLoader}
                                    />
                                )
                                : null}
                        />
                    );
                }}
            />
            ) : null}

            <FilterTabsSheet
                visible={filterOpen}
                onDismiss={() => setFilterOpen(false)}
                palette={palette}
                hideSort
                hideArea={areaOptions.length < 3}
                cuisine={{ options: cuisineOptions, selected: cuisineFilter, onSelect: setCuisineFilter }}
                price={{ options: priceOptions, selected: priceFilter, onSelect: setPriceFilter }}
                area={{ options: areaOptions, selected: cityFilter, onSelect: setCityFilter }}
                sort={{ options: [{ value: null, label: 'Map order' }], selected: null, onSelect: () => {} }}
            />
            <ClipTray
                visible={trayOpen}
                onDismiss={() => setTrayOpen(false)}
                palette={palette}
                rows={clipTray.rows}
                hasOlder={clipTray.hasOlder}
                isEmpty={clipTray.isEmpty}
            />
            <HandoffSheet
                visible={handoffOpen}
                onDismiss={() => setHandoffOpen(false)}
                pinnedCount={pinnedRows.length}
            />
            <UnmappedSpotsSheet
                visible={unmappedSheetOpen}
                onClose={() => setUnmappedSheetOpen(false)}
                items={unmappedItems}
                userId={user?.id}
                palette={palette}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        overflow: 'hidden',
    },
    topChrome: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 14,
        gap: 10,
        zIndex: 3,
    },
    mapTopChrome: {
        height: 184,
    },
    topWashFill: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    searchLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    searchPill: {
        flex: 1,
        height: 48,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    searchTakeoverPill: {
        height: Spacing.xxl + Spacing.sm,
    },
    searchInput: {
        ...Type.body,
        flex: 1,
        height: 48,
        paddingVertical: 0,
        fontFamily: 'Manrope_500Medium',
    },
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    clipPillRing: {
        position: 'absolute',
        top: -2.5,
        left: -2.5,
        width: 53,
        height: 53,
        borderRadius: Radius.full,
        borderWidth: 2.5,
        borderColor: 'transparent',
    },
    clipCountDot: {
        position: 'absolute',
        top: -3,
        right: -3,
        minWidth: 20,
        height: 20,
        borderRadius: Radius.full,
        paddingHorizontal: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    clipCountText: {
        ...Type.labelSmall,
        fontFamily: 'Manrope_700Bold',
        fontVariant: ['tabular-nums'],
        letterSpacing: 0,
        lineHeight: 15,
        textTransform: 'none',
    },
    chipScroller: {
        flexGrow: 0,
    },
    chipLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingRight: Spacing.md,
    },
    headerChip: {
        minHeight: 34,
        borderRadius: Radius.full,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    headerChipLabel: {
        ...Type.metadata,
        fontFamily: 'Manrope_600SemiBold',
    },
    filterButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterDot: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    sheetHeader: {
        paddingHorizontal: 8,
    },
    sheetLedgerHeader: {
        paddingHorizontal: 16,
        paddingTop: 3,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    countActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    shareAction: {
        width: Spacing.xl + Spacing.sm,
        height: Spacing.xl + Spacing.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    kicker: {
        ...Type.sectionKicker,
    },
    placeCount: {
        ...Type.metadata,
    },
    viewToggle: {
        position: 'absolute',
        left: Spacing.md,
        minHeight: VIEW_TOGGLE_HEIGHT,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        zIndex: 4,
    },
    viewToggleLabel: {
        ...Type.ledgerValue,
    },
    statePane: {
        flexGrow: 1,
    },
    statePaneBody: {
        flex: 1,
    },
    resultsContent: {
        flexGrow: 1,
        paddingHorizontal: 8,
    },
    nameRatingLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
    },
    resultMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
    },
    selectedCaption: {
        position: 'absolute',
        left: 14,
        right: 14,
        minHeight: 64,
        borderRadius: Radius.lg,
        paddingHorizontal: 15,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    captionCopy: {
        flex: 1,
        gap: 3,
    },
    captionName: {
        flex: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 16,
        lineHeight: 21,
    },
    loader: {
        marginTop: Spacing.xl,
    },
    pageLoader: {
        marginVertical: Spacing.md,
    },
    emptyResults: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 36,
        paddingVertical: 42,
    },
    emptyCopy: {
        ...Type.quote,
        textAlign: 'center',
    },
    paperSurface: {
        flex: 1,
        zIndex: 1,
    },
    paperTabs: {
        paddingHorizontal: Spacing.sm + Spacing.xs,
    },
    paperBody: {
        flex: 1,
    },
    cityLedgerContent: {
        flexGrow: 1,
    },
    cityGroupHeader: {
        paddingHorizontal: Spacing.pageGutter,
        paddingTop: Spacing.md - Spacing.xs / 2,
        paddingBottom: Spacing.xs,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    cityGroupHeaderLater: {
        paddingTop: Spacing.lg - Spacing.xs / 2,
    },
});
