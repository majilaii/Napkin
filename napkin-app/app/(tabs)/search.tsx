/**
 * Search tab — find any restaurant, whether or not your Tables have logged it.
 *
 * Layout:
 *   [sticky SearchInput + Places locality bar]
 *   [empty state: SearchEmptyState — recents · pinned near you · your lists]
 *   OR [tiered FlatList (+ trailing "Your lists" section when titles match)]
 *
 * Autofocus policy: focus on first mount only. Re-entering the tab within the
 * same session does NOT re-autofocus (respects user intent per UX spec).
 * State (query, results) is preserved at module scope across tab unmounts.
 *
 * Navigation:
 *   Tier 1/2 → /restaurant/[id]?tableId=... (persisted)
 *   Tier 3 (ghost) → /restaurant/[placeId]?placeId=... (TICKET-016 ghost shape)
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    ActivityIndicator,
    Pressable,
    TextInput,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, IconSize, Type } from '@/constants/theme';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useMyLists, type MyList } from '@/hooks/lists/useMyLists';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useUserProfile } from '@/hooks/users';
import { useSearchLocality } from '@/hooks/search/useSearchLocality';
import { searchLocalityLabel } from '@/hooks/search/searchLocalityStore';
import {
    useRestaurantSearch,
    useRecentSearches,
    mergeUnified,
    type SearchResultRow as SearchResultRowType,
} from '@/hooks/search/useRestaurantSearch';
import { searchCache } from '@/hooks/search/searchCache';
import {
    SearchResultRow,
    ListRow,
    SearchEmptyState,
    SearchLocalityBar,
    TierHeader,
    SearchModeTabs,
    PeopleSearchPane,
    ListsSearchPane,
    selectNearbyPinned,
    filterListsByQuery,
} from '@/components/search';
import type { SearchMode } from '@/components/search';

type Palette = typeof Colors.light;
const SEARCH_DEBOUNCE_MS = 250;

// ── Module-scope state — preserved across tab mounts within the session ──────
// Last query string — survives tab unmount so query is restored
let lastQuery = '';
// Last scroll offset — survives tab unmount so scroll position is restored
let lastScrollOffset = 0;

// ── Row types for FlatList ───────────────────────────────────────────────────

type SectionHeaderItem = { _type: 'header'; label: string; key: string };
type ResultItem = { _type: 'result'; row: SearchResultRowType; key: string };
type ListItem = { _type: 'list'; list: MyList; key: string };
type FlatItem = SectionHeaderItem | ResultItem | ListItem;

function buildFlatList(
    rows: SearchResultRowType[],
    matchingLists: MyList[],
): FlatItem[] {
    const items: FlatItem[] = [];

    // TICKET-167: one flat ranked list, no tier headers. The been-here signal
    // rides each row (the pin), and the address disambiguates same-name venues.
    for (const row of rows) {
        if (row.fartherAfield && !items.some((item) => item.key === 'hdr-farther-afield')) {
            items.push({
                _type: 'header',
                label: 'Farther afield',
                key: 'hdr-farther-afield',
            });
        }
        items.push({ _type: 'result', row, key: `r-${row.id ?? row.placeId ?? row.name}` });
    }

    // TICKET-097 (TICKET-094 option A): matching lists tail the restaurant results.
    if (matchingLists.length > 0) {
        items.push({ _type: 'header', label: 'Your lists', key: 'hdr-lists' });
        for (const list of matchingLists) {
            items.push({ _type: 'list', list, key: `l-${list.id}` });
        }
    }

    return items;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SearchScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { data: tables } = useTables(user?.id);
    const { data: ownProfileResult, isSuccess: ownProfileSettled } = useUserProfile(user?.id);
    const homeCity = ownProfileResult?.data?.profile.home_city?.trim() || null;
    const { locality, setAuto: setAutoLocality, setCity: setCityLocality } =
        useSearchLocality(user?.id);

    // [ARCH-REVIEW-M1] Seed search from ?q= route param (used by ImportLinkSheet fallback).
    // TICKET-125: ?mode=lists lands directly on the Lists segment (For You "see more").
    // Both consumed once on mount; cleared so re-entering the tab doesn't re-apply.
    const { q: prefillQ, mode: prefillMode } = useLocalSearchParams<{ q?: string; mode?: string }>();
    const prefillConsumedRef = useRef(false);
    const modeConsumedRef = useRef(false);

    useEffect(() => {
        if (prefillQ && !prefillConsumedRef.current) {
            prefillConsumedRef.current = true;
            const q = prefillQ.trim();
            if (q) {
                setImmediateQuery(q);
                setDebouncedQuery(q);
                lastQuery = q;
            }
            // Clear the param so re-entering the tab doesn't auto-re-search
            router.setParams({ q: undefined });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillQ]);

    // Search mode — Places (default) or People. State is local to the tab.
    // People mode is curtained in friend-test (FRIEND_TEST.hidePeopleSearch).
    const [mode, setMode] = useState<SearchMode>('places');

    // TICKET-125: consume ?mode= once (For You "see more" → Lists segment). Mirrors
    // the ?q= prefill effect. People is dropped if it's curtained; Lists always ok.
    useEffect(() => {
        if (prefillMode && !modeConsumedRef.current) {
            modeConsumedRef.current = true;
            const next = prefillMode as SearchMode;
            const allowed =
                next === 'lists' ||
                next === 'places' ||
                (next === 'people' && !FRIEND_TEST.hidePeopleSearch);
            if (allowed) setMode(next);
            router.setParams({ mode: undefined });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefillMode]);

    // Immediate display value (responsive to keystrokes)
    const [immediateQuery, setImmediateQuery] = useState(lastQuery);
    // Debounced query that actually drives the search hook
    const [debouncedQuery, setDebouncedQuery] = useState(lastQuery);

    const inputRef = useRef<TextInput>(null);
    const listRef = useRef<FlatList<FlatItem>>(null);
    const didRestoreScrollRef = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Geolocation — silent until the locality sheet asks explicitly ───
    // Feeds the Places result bias AND the "Pinned near you" empty-state.
    const {
        results,
        isLoading,
        isPlacesError,
        refetch,
        coords,
        permissionStatus,
        requestLocation,
    } = useRestaurantSearch(
        debouncedQuery,
        user?.id,
        { grantedLocationBias: true, locality },
    );

    const localityLabel = searchLocalityLabel(
        locality,
        !!coords,
        homeCity,
        ownProfileSettled,
    );

    const handleCurrentLocation = useCallback(() => {
        setAutoLocality();
        if (permissionStatus === null || permissionStatus === 'undetermined') {
            void requestLocation();
        }
    }, [permissionStatus, requestLocation, setAutoLocality]);

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    // Sync module-scope lastQuery on unmount / query change
    useEffect(() => {
        lastQuery = immediateQuery;
    }, [immediateQuery]);

    // Add to recent-searches list when the user actually submits a query
    // (i.e., the debounced value crosses the minimum-length threshold)
    useEffect(() => {
        const trimmed = debouncedQuery.trim();
        if (trimmed.length >= 2) {
            searchCache.addRecent(trimmed);
        }
    }, [debouncedQuery]);

    const handleScroll = useCallback(
        (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            lastScrollOffset = e.nativeEvent.contentOffset.y;
        },
        [],
    );

    // No autofocus: opening the Search tab should NOT raise the keyboard. The
    // user taps the field when they're ready to type (tester feedback).

    const recentQueries = useRecentSearches();

    // ── Empty-state material (TICKET-097) — the user's OWN stuff ─────────
    const { data: myLists } = useMyLists(user?.id);
    const { data: wishlistData } = useMyWishlist(user?.id);

    // First page only — no pagination loops for a 6-row shelf.
    const nearbyPinned = useMemo(
        () => selectNearbyPinned(wishlistData?.pages?.[0]?.data ?? [], coords),
        [wishlistData, coords],
    );

    // Typing mode: lists whose title (or description) matches the query —
    // client-side, top 3 (TICKET-094 option A). Keyed off debouncedQuery so
    // the section moves in step with the restaurant tiers.
    const matchingLists = useMemo(
        () =>
            debouncedQuery.trim().length >= 2
                ? filterListsByQuery(myLists ?? [], debouncedQuery)
                : [],
        [myLists, debouncedQuery],
    );

    // TICKET-167: collapse the three tiers into one deterministically-ranked
    // flat list (keyed off the debounced query, which drives the search hook).
    const mergedResults = useMemo(
        () => mergeUnified(results, debouncedQuery),
        [results, debouncedQuery],
    );
    const hasQuery = immediateQuery.trim().length > 0;
    const hasResults = mergedResults.length > 0;

    const flatData = hasQuery ? buildFlatList(mergedResults, matchingLists) : [];

    // Pick the first table as context for persisted restaurant navigation
    const activeTableId = tables?.[0]?.tables?.id;

    const handleResultPress = useCallback(
        (item: SearchResultRowType) => {
            // TICKET-167: branch on persistence, not tier. A persisted row (any
            // tier) carries a Napkin DB id; a ghost carries only a placeId.
            if (item.id) {
                // Persisted: navigate with Napkin DB id
                router.push({
                    pathname: '/restaurant/[id]',
                    params: {
                        id: item.id,
                        ...(activeTableId ? { tableId: activeTableId } : {}),
                    },
                });
            } else if (item.placeId) {
                // Ghost: pass the FULL Places object (item.place) — the trimmed row
                // starves the page of coords/price/rating/hours (Ritz empty-page bug).
                router.push({
                    pathname: '/restaurant/[id]',
                    params: {
                        id: item.placeId,
                        placeId: item.placeId,
                        placePayload: JSON.stringify(item.place ?? item),
                    },
                });
            }
        },
        [router, activeTableId],
    );

    const handleRecentSelect = useCallback(
        (q: string) => {
            setImmediateQuery(q);
            setDebouncedQuery(q);
        },
        [],
    );

    const handleClearRecents = useCallback(() => {
        searchCache.clearRecents();
    }, []);

    const handleListPress = useCallback(
        (list: MyList) => {
            router.push({ pathname: '/list/[id]', params: { id: list.id } });
        },
        [router],
    );

    const handleQueryChange = useCallback((text: string) => {
        setImmediateQuery(text);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            debounceRef.current = null;
            setDebouncedQuery(text);
        }, SEARCH_DEBOUNCE_MS);
    }, []);

    const handleClear = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        setImmediateQuery('');
        setDebouncedQuery('');
    }, []);

    // Switching mode drops the keyboard so the bottom nav / new pane is reachable.
    const handleModeChange = useCallback((next: SearchMode) => {
        Keyboard.dismiss();
        setMode(next);
    }, []);

    const renderItem = useCallback(
        ({ item }: { item: FlatItem }) => {
            if (item._type === 'header') {
                return <TierHeader label={item.label} />;
            }
            if (item._type === 'list') {
                return <ListRow list={item.list} onPress={handleListPress} />;
            }
            return <SearchResultRow item={item.row} onPress={handleResultPress} />;
        },
        [handleListPress, handleResultPress],
    );

    return (
        <KeyboardAvoidingView
            style={[styles.root, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
        >
            {/* Safe area top + header */}
            <View
                style={[
                    styles.header,
                    { paddingTop: insets.top, backgroundColor: palette.background },
                ]}
            >
                <Text style={[styles.screenTitle, { color: palette.text }]}>
                    Search
                </Text>
                {/* TICKET-106: tabs render whenever People OR Lists is available.
                    Lists is ALWAYS available (decoupled from hidePeopleSearch); when
                    People is curtained the People tab is dropped but Lists survives. */}
                <SearchModeTabs
                    mode={mode}
                    onModeChange={handleModeChange}
                    hidePeople={FRIEND_TEST.hidePeopleSearch}
                />
                <View
                    style={[
                        styles.searchBar,
                        { backgroundColor: palette.surfaceContainerLow },
                    ]}
                >
                    <Ionicons
                        name="search-outline"
                        size={IconSize.sm}
                        color={palette.textMuted}
                    />
                    <TextInput
                        ref={inputRef}
                        value={immediateQuery}
                        onChangeText={handleQueryChange}
                        style={[Type.body, styles.searchInput, { color: palette.text }]}
                        placeholder="Search restaurants…"
                        placeholderTextColor={palette.textMuted}
                        autoFocus={false}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                        clearButtonMode="never"
                        accessibilityLabel="search restaurants"
                    />
                    {immediateQuery.length > 0 ? (
                        <Pressable
                            onPress={handleClear}
                            hitSlop={Spacing.sm}
                            style={styles.searchClear}
                            accessibilityRole="button"
                            accessibilityLabel="clear search"
                        >
                            <Ionicons
                                name="close-circle"
                                size={IconSize.sm}
                                color={palette.textMuted}
                            />
                        </Pressable>
                    ) : null}
                </View>
                {mode === 'places' ? (
                    <SearchLocalityBar
                        label={localityLabel}
                        locality={locality}
                        onSelectCurrentLocation={handleCurrentLocation}
                        onSelectCity={setCityLocality}
                    />
                ) : null}
            </View>

            {/* Lists tab (TICKET-106) — decoupled from hidePeopleSearch; always
                 available. Unmounted when another mode is active. */}
            {mode === 'lists' ? (
                <ListsSearchPane
                    query={immediateQuery}
                    debouncedQuery={debouncedQuery}
                />
            ) : /* People tab — unmounted when Places is active so no stale render.
                    Entire people path gated behind FRIEND_TEST.hidePeopleSearch. */
            !FRIEND_TEST.hidePeopleSearch && mode === 'people' ? (
                <PeopleSearchPane
                    query={immediateQuery}
                    debouncedQuery={debouncedQuery}
                />
            ) : (
                /* Places content (unchanged) */
                !hasQuery ? (
                    // Empty state — TICKET-097: the user's own material.
                    // Each section renders only when it has data; a brand-new
                    // user still gets the clean field with nothing to
                    // apologise for.
                    <ScrollView
                        style={styles.emptyContainer}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                    >
                        <SearchEmptyState
                            recentQueries={recentQueries}
                            onSelectRecent={handleRecentSelect}
                            onClearRecents={handleClearRecents}
                            nearbyPinned={nearbyPinned}
                            onPressRestaurant={handleResultPress}
                            lists={myLists ?? []}
                            onPressList={handleListPress}
                        />
                    </ScrollView>
                ) : isLoading && !hasResults ? (
                    // Loading state — tap to drop the keyboard (covers the bottom nav).
                    <Pressable
                        style={styles.centeredState}
                        onPress={Keyboard.dismiss}
                        accessible={false}
                    >
                        <ActivityIndicator color={palette.primary} />
                    </Pressable>
                ) : (
                    // Results (or error overlay)
                    <FlatList
                        ref={listRef}
                        data={flatData}
                        keyExtractor={(item) => item.key}
                        renderItem={renderItem}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        onScroll={handleScroll}
                        scrollEventThrottle={16}
                        onContentSizeChange={() => {
                            if (!didRestoreScrollRef.current && lastScrollOffset > 0) {
                                didRestoreScrollRef.current = true;
                                listRef.current?.scrollToOffset({
                                    offset: lastScrollOffset,
                                    animated: false,
                                });
                            }
                        }}
                        contentContainerStyle={[
                            styles.listContent,
                            { paddingBottom: insets.bottom + Spacing.lg },
                        ]}
                        ListEmptyComponent={
                            !isLoading ? (
                                <View style={styles.centeredState}>
                                    <Text
                                        style={[Type.body, { color: palette.textMuted }]}
                                    >
                                        {`No results for "${debouncedQuery}"`}
                                    </Text>
                                </View>
                            ) : null
                        }
                        ListFooterComponent={
                            isPlacesError ? (
                                <View style={styles.errorBanner}>
                                    <Text style={[Type.bodySmall, { color: palette.error }]}>
                                        {`Couldn't reach search \u2014 try again`}
                                    </Text>
                                    <Pressable onPress={refetch} style={styles.retryButton}>
                                        <Text
                                            style={[
                                                Type.caption,
                                                { color: palette.primary },
                                            ]}
                                        >
                                            Retry
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null
                        }
                    />
                )
            )}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        paddingBottom: Spacing.xs,
    },
    screenTitle: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: 0,
        ...Type.screenTitle,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
        paddingLeft: Spacing.md,
        paddingRight: Spacing.xs,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 0,
    },
    searchClear: {
        padding: Spacing.sm,
    },
    emptyContainer: {
        flex: 1,
        paddingTop: Spacing.md,
    },
    centeredState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.xl,
    },
    listContent: {
        flexGrow: 1,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
    retryButton: {
        paddingLeft: Spacing.sm,
    },
});
