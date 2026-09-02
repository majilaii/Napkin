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
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    ListsSearchPane,
    PeopleSearchPane,
    RecentSearchesList,
    SearchLocalityBar,
    SearchModeTabs,
} from '@/components/search';
import type { SearchMode } from '@/components/search';
import { ErrorState, InlineErrorState } from '@/components/ErrorState';
import { SnapSheet, type SnapSheetHandle } from '@/components/sheets/SnapSheet';
import {
    FULL,
    PLACES_SNAP_METRICS,
    visibleHeight,
} from '@/components/sheets/snapSheetMath';
import {
    FilterTabsSheet,
    ImportLinkSheet,
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
    composeRowMeta,
    decorateAndSortRows,
    deriveDistanceOrigin,
    presentPlacesRating,
    projectPlacesPins,
    resolvePlacesFailurePresentation,
    resolvePlacesProjection,
    restaurantRouteForRow,
    searchRowsToDisplayRows,
    spotRowsToDisplayRows,
    wishlistRowsToDisplayRows,
    type DecoratedPlacesRow,
    type PlacesDisplayRow,
} from '@/components/places/placesPresentation';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    queryForPlacesRouteArrival,
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
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { priceTierLabel } from '@/lib/priceLevel';
import { useAuth } from '@/providers/AuthProvider';

const SEARCH_DEBOUNCE_MS = 250;
const NAV_CLEARANCE = 92;

type Palette = typeof Colors.light;
type FrozenProjection = {
    pins: WishlistMapItem[];
    rows: PlacesDisplayRow[];
    scopeKey: string;
};

function emptyProjection(): FrozenProjection {
    return { pins: [], rows: [], scopeKey: 'places:frozen-empty' };
}

function routeMode(mode: string | undefined): SearchMode | null {
    return mode === 'places' || mode === 'lists' || mode === 'people' ? mode : null;
}

function RatingLabel({ row, palette }: { row: PlacesDisplayRow; palette: Palette }) {
    const presentation = presentPlacesRating(row.rating);
    const color = presentation.tone === 'amber'
        ? palette.tertiary
        : presentation.tone === 'muted'
          ? palette.textMuted
          : palette.textFaint;
    if (!presentation.value) {
        return <Text style={[styles.unrated, { color }]}>{presentation.suffix}</Text>;
    }
    return (
        <Text numberOfLines={1}>
            <Text style={[styles.ratingValue, { color }]}>{presentation.value}</Text>
            {presentation.suffix ? (
                <Text style={[styles.ratingSuffix, { color: palette.textMuted }]}>
                    {presentation.suffix}
                </Text>
            ) : null}
        </Text>
    );
}

function ResultRow({
    item,
    palette,
    onPress,
}: {
    item: DecoratedPlacesRow;
    palette: Palette;
    onPress: (row: PlacesDisplayRow) => void;
}) {
    const meta = composeRowMeta(item.row, item.distanceLabel);
    return (
        <Pressable
            onPress={() => onPress(item.row)}
            style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.64 }]}
            accessibilityRole="button"
            accessibilityLabel={`open ${item.row.name}`}
        >
            <View style={styles.resultCopy}>
                <View style={styles.nameRatingLine}>
                    <Text style={[styles.resultName, { color: palette.text }]} numberOfLines={1}>
                        {item.row.name}
                    </Text>
                    <RatingLabel row={item.row} palette={palette} />
                </View>
                {meta ? (
                    <Text style={[styles.resultMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            <Ionicons name="chevron-forward-outline" size={17} color={palette.textFaint} />
        </Pressable>
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
    const { q: incomingQ, mode: incomingMode } = useLocalSearchParams<{
        q?: string;
        mode?: string;
    }>();
    const { value: screenState, patch: patchScreenState } = usePlacesScreenState(user?.id);
    const { locality, setAuto: setAutoLocality, setCity: setCityLocality } =
        useSearchLocality(user?.id);

    const requestedMode = routeMode(incomingMode)
        ?? (incomingQ !== undefined ? 'places' : null);
    const routeRequestedSegment = requestedMode === 'people' && FRIEND_TEST.hidePeopleSearch
        ? 'places'
        : requestedMode;
    const storedSegment = screenState.activeSegment === 'people' && FRIEND_TEST.hidePeopleSearch
        ? 'places'
        : screenState.activeSegment;
    const activeSegment = routeRequestedSegment
        ? routeRequestedSegment
        : storedSegment;
    const routeQuery = incomingQ?.trim() ?? '';
    const initialQuery = queryForPlacesRouteArrival(
        screenState.query,
        incomingQ,
        requestedMode,
    );
    const [immediateQuery, setImmediateQuery] = useState(initialQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
    const [segmentHeaderRevealed, setSegmentHeaderRevealed] = useState(
        Boolean(routeQuery || requestedMode === 'lists' || requestedMode === 'people'
            || screenState.query || screenState.activeSegment !== 'places'),
    );
    const inputRef = useRef<TextInput>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const routeEffectHandledRef = useRef(false);
    const renderedUserRef = useRef(user?.id ?? null);

    const sheetH = Math.max(1, (height - insets.top) * 0.76);
    const firstSnap = activeSegment === 'people' ? FULL : screenState.sheetSnap;
    const sheetRef = useRef<SnapSheetHandle>(null);
    const [bottomInset, setBottomInset] = useState(() => (
        visibleHeight(sheetH, firstSnap, PLACES_SNAP_METRICS)
    ));
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
        setSegmentHeaderRevealed(Boolean(
            nextQuery || requestedMode === 'lists' || requestedMode === 'people',
        ));
        restoredScrollRef.current = false;
        sheetRef.current?.snapTo(screenState.sheetSnap);
    }, [incomingQ, requestedMode, screenState.query, screenState.sheetSnap, user?.id]);

    useEffect(() => {
        const hasRouteRequest = incomingQ !== undefined || incomingMode !== undefined;
        if (!hasRouteRequest) {
            routeEffectHandledRef.current = false;
            return;
        }
        if (routeEffectHandledRef.current) return;
        routeEffectHandledRef.current = true;
        let nextState = screenState;
        if (requestedMode) {
            setSegmentHeaderRevealed(true);
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
            setSegmentHeaderRevealed(true);
        }
        patchScreenState(nextState);
        if (nextState.sheetSnap !== screenState.sheetSnap) {
            sheetRef.current?.snapTo(nextState.sheetSnap);
        }
        if (requestedMode === 'lists' || requestedMode === 'people') {
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
    const wishlistData = wishlistQuery.data;
    const spotsData = spotsQuery.data;
    const recentQueries = useRecentSearches();
    const pinnedRows = useMemo(
        () => wishlistRowsToDisplayRows(
            wishlistData?.pages.flatMap((page) => page.data ?? []) ?? [],
        ),
        [wishlistData],
    );
    const beenRows = useMemo(() => spotRowsToDisplayRows(spotsData ?? []), [spotsData]);
    const [activeLayer, setActiveLayer] = useState<'pinned' | 'been'>('pinned');
    const layerRows = activeLayer === 'pinned' ? pinnedRows : beenRows;

    const mergedSearchRows = useMemo(
        () => searchRowsToDisplayRows(mergeUnified(results, debouncedQuery)),
        [debouncedQuery, results],
    );
    const queryActive = immediateQuery.trim().length >= 2;
    const sourceRows = queryActive ? mergedSearchRows : layerRows;
    const layerLoading = activeLayer === 'pinned'
        ? wishlistQuery.isLoading
        : spotsQuery.isLoading;
    const failurePresentation = resolvePlacesFailurePresentation({
        queryActive,
        activeLayer,
        hasCachedRows: sourceRows.length > 0,
        placesFailed: isPlacesError,
        persistedFailed: isPersistedError,
        wishlistFailed: wishlistQuery.isError,
        spotsFailed: spotsQuery.isError,
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
    const decoratedRows = useMemo(
        () => decorateAndSortRows(filteredRows, distanceOrigin),
        [distanceOrigin, filteredRows],
    );
    const currentPins = useMemo(() => projectPlacesPins(filteredRows), [filteredRows]);
    const currentScopeKey = queryActive
        ? `search:${locality === 'auto' ? 'auto' : locality.city.trim().toLowerCase()}:${debouncedQuery.trim().toLowerCase()}`
        : `layer:${activeLayer}`;
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

    // Round 5 builder note: ONLY Places may commit the frozen projection.
    // Disabled Lists/People searches therefore cannot replace pins with [].
    useEffect(() => {
        if (activeSegment === 'places') frozenProjectionRef.current = currentProjection;
    }, [activeSegment, currentProjection]);

    const renderedProjection = resolvePlacesProjection(
        activeSegment,
        currentProjection,
        frozenProjectionRef.current,
    ).rendered;
    const selectedRow = renderedProjection.rows.find(
        (row) => row.id === screenState.selectedPinId,
    ) ?? null;
    const selectedDistance = selectedRow
        ? decorateAndSortRows([selectedRow], distanceOrigin)[0]?.distanceLabel ?? null
        : null;

    useEffect(() => {
        const trimmed = debouncedQuery.trim();
        if (activeSegment === 'places' && trimmed.length >= 2) searchCache.addRecent(trimmed);
    }, [activeSegment, debouncedQuery]);

    const handleQueryChange = useCallback((text: string) => {
        setImmediateQuery(text);
        patchScreenState({ query: text });
        if (text.trim()) setSegmentHeaderRevealed(true);
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

    const handleRetryFailure = useCallback(() => {
        for (const source of failurePresentation.sources) {
            if (source === 'places') refetchPlaces();
            if (source === 'persisted') refetchPersisted();
            if (source === 'wishlist') void wishlistQuery.refetch();
            if (source === 'spots') void spotsQuery.refetch();
        }
    }, [
        failurePresentation.sources,
        refetchPersisted,
        refetchPlaces,
        spotsQuery,
        wishlistQuery,
    ]);

    const handleSegmentChange = useCallback((next: SearchMode) => {
        Keyboard.dismiss();
        setSegmentHeaderRevealed(true);
        const transitioned = transitionPlacesSegment(
            screenState,
            next,
            FRIEND_TEST.hidePeopleSearch,
        );
        patchScreenState(transitioned);
        sheetRef.current?.snapTo(transitioned.sheetSnap);
    }, [patchScreenState, screenState]);

    const openRestaurant = useCallback((row: PlacesDisplayRow) => {
        const route = restaurantRouteForRow(row);
        if (route) router.push(route as never);
    }, [router]);

    const handleCurrentLocation = useCallback(() => {
        setAutoLocality();
        if (permissionStatus === null || permissionStatus === 'undetermined') {
            void requestLocation();
        }
    }, [permissionStatus, requestLocation, setAutoLocality]);

    const [filterOpen, setFilterOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
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

    const renderSheetHeader = useCallback(() => (
        <View style={styles.sheetHeader}>
            {segmentHeaderRevealed ? (
                <SearchModeTabs
                    mode={activeSegment}
                    onModeChange={handleSegmentChange}
                    hidePeople={FRIEND_TEST.hidePeopleSearch}
                />
            ) : null}
            {activeSegment === 'places' ? (
                <View style={styles.sheetLedgerHeader}>
                    <Text style={[styles.kicker, { color: palette.primary }]}>
                        {queryActive ? 'RESULTS' : 'NEARBY'}
                    </Text>
                    <Text style={[styles.placeCount, { color: palette.textMuted }]}>
                        {`${decoratedRows.length} ${decoratedRows.length === 1 ? 'place' : 'places'}`}
                    </Text>
                </View>
            ) : null}
        </View>
    ), [
        activeSegment,
        decoratedRows.length,
        handleSegmentChange,
        palette.primary,
        palette.textMuted,
        queryActive,
        segmentHeaderRevealed,
    ]);

    const restoreScroll = useCallback(() => {
        if (restoredScrollRef.current || screenState.scrollOffset <= 0) return;
        restoredScrollRef.current = true;
        placesListRef.current?.scrollToOffset({
            offset: screenState.scrollOffset,
            animated: false,
        });
    }, [screenState.scrollOffset]);

    return (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
            <WishlistMapView
                items={renderedProjection.pins}
                unmappableCount={0}
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
                bottomInset={bottomInset}
                preserveItemOrder={!distanceOrigin}
                collectionScopeKey={renderedProjection.scopeKey}
                palette={palette}
            />

            <LinearGradient
                colors={[
                    palette.background,
                    `${palette.background}F2`,
                    `${palette.background}00`,
                ]}
                locations={[0, 0.7, 1]}
                style={[styles.topWash, { paddingTop: insets.top + 8 }]}
                pointerEvents="box-none"
            >
                <View style={styles.searchLine}>
                    <View style={[styles.searchPill, Shadow.ambient, { backgroundColor: palette.surfaceNote }]}>
                        <Ionicons name="search-outline" size={20} color={palette.textMuted} />
                        <TextInput
                            ref={inputRef}
                            value={immediateQuery}
                            onChangeText={handleQueryChange}
                            placeholder="find a place"
                            placeholderTextColor={palette.textFaint}
                            style={[styles.searchInput, { color: palette.text }]}
                            autoCorrect={false}
                            returnKeyType="search"
                            clearButtonMode="never"
                            accessibilityLabel="find a place, list, or person"
                        />
                        {immediateQuery ? (
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
                    <Pressable
                        onPress={() => setImportOpen(true)}
                        style={({ pressed }) => [
                            styles.iconButton,
                            Shadow.ambient,
                            { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.7 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="import places"
                    >
                        <Ionicons name="download-outline" size={20} color={palette.textSecondary} />
                    </Pressable>
                </View>
                <View style={styles.chipLine}>
                    <SearchLocalityBar
                        compact
                        label={localityLabel}
                        locality={locality}
                        onSelectCurrentLocation={handleCurrentLocation}
                        onSelectCity={setCityLocality}
                    />
                    <LayerChip
                        label="pinned"
                        icon="bookmark-outline"
                        active={!queryActive && activeLayer === 'pinned'}
                        palette={palette}
                        onPress={() => setActiveLayer('pinned')}
                    />
                    <LayerChip
                        label="been"
                        icon="checkmark-circle-outline"
                        active={!queryActive && activeLayer === 'been'}
                        palette={palette}
                        onPress={() => setActiveLayer('been')}
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
                </View>
            </LinearGradient>

            {activeSegment === 'places' && selectedRow ? (
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
                    accessibilityLabel={`open ${selectedRow.name}`}
                >
                    <View style={styles.captionCopy}>
                        <View style={styles.nameRatingLine}>
                            <Text style={[styles.captionName, { color: palette.text }]} numberOfLines={1}>
                                {selectedRow.name}
                            </Text>
                            <RatingLabel row={selectedRow} palette={palette} />
                        </View>
                        <Text style={[styles.resultMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {composeRowMeta(
                                { ...selectedRow, friendsBeenCount: 0, isPinned: false },
                                selectedDistance,
                            )}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward-outline" size={17} color={palette.textFaint} />
                </Pressable>
            ) : null}

            <SnapSheet
                H={sheetH}
                initialSnap={firstSnap}
                sheetRef={sheetRef}
                backgroundColor={palette.surfaceNote}
                handleColor={palette.ruleWarmNib}
                metrics={PLACES_SNAP_METRICS}
                onPanStart={Keyboard.dismiss}
                onSettle={(sheetSnap, settledHeight) => {
                    setBottomInset(settledHeight);
                    patchScreenState({ sheetSnap });
                }}
                renderHeader={renderSheetHeader}
                renderContent={({ scrollEnabled, onScroll }) => {
                    if (activeSegment === 'lists') {
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
                        return <ActivityIndicator style={styles.loader} color={palette.primary} />;
                    }
                    if (layerLoading && sourceRows.length === 0 && !queryActive) {
                        return <ActivityIndicator style={styles.loader} color={palette.primary} />;
                    }
                    if (failurePresentation.kind === 'broken') {
                        return (
                            <ErrorState
                                onRetry={handleRetryFailure}
                                message="couldn't load places"
                            />
                        );
                    }
                    return (
                        <Animated.FlatList
                            ref={placesListRef}
                            data={decoratedRows}
                            keyExtractor={({ row }) => row.id}
                            renderItem={({ item }) => (
                                <ResultRow item={item} palette={palette} onPress={openRestaurant} />
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
                                    {!queryActive && recentQueries.length > 0 ? (
                                        <RecentSearchesList
                                            queries={recentQueries}
                                            onSelect={handleQueryChange}
                                            onClear={searchCache.clearRecents}
                                        />
                                    ) : null}
                                </>
                            )}
                            ListEmptyComponent={
                                <View style={styles.emptyResults}>
                                    <Text style={[styles.emptyCopy, { color: palette.textMuted }]}>
                                        {immediateQuery.trim().length === 1
                                              ? 'type one more letter'
                                              : queryActive
                                                ? 'no places found'
                                                : activeLayer === 'pinned'
                                                  ? 'no pinned places yet'
                                                  : 'no logged places yet'}
                                    </Text>
                                </View>
                            }
                        />
                    );
                }}
            />

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
            <ImportLinkSheet visible={importOpen} onDismiss={() => setImportOpen(false)} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        overflow: 'hidden',
    },
    topWash: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 184,
        paddingHorizontal: 14,
        gap: 10,
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
    chipLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
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
    kicker: {
        ...Type.sectionKicker,
        letterSpacing: 1.8,
    },
    placeCount: {
        ...Type.metadata,
    },
    resultsContent: {
        flexGrow: 1,
        paddingHorizontal: 8,
    },
    resultRow: {
        minHeight: 65,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    resultCopy: {
        flex: 1,
        gap: 3,
    },
    nameRatingLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
    },
    resultName: {
        flex: 1,
        fontFamily: 'Newsreader_500Medium',
        fontSize: 16,
        lineHeight: 21,
    },
    ratingValue: {
        ...Type.feedLedgerRating,
    },
    ratingSuffix: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        lineHeight: 18,
    },
    unrated: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
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
});
