/**
 * Search tab — find any restaurant, whether or not your Tables have logged it.
 *
 * Layout:
 *   [sticky SearchInput]
 *   [empty state: heading + RecentSearchesList] OR [tiered FlatList]
 *
 * Autofocus policy: focus on first mount only. Re-entering the tab within the
 * same session does NOT re-autofocus (respects user intent per UX spec).
 * State (query, results) is preserved at module scope across tab unmounts.
 *
 * Navigation:
 *   Tier 1/2 → /restaurant/[id]?tableId=... (persisted)
 *   Tier 3 (ghost) → /restaurant/[placeId]?placeId=... (TICKET-016 ghost shape)
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';

import { Colors, Spacing, Type } from '@/constants/theme';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import {
    useRestaurantSearch,
    useRecentSearches,
    type SearchResultRow as SearchResultRowType,
} from '@/hooks/search/useRestaurantSearch';
import { searchCache } from '@/hooks/search/searchCache';
import {
    SearchInput,
    SearchResultRow,
    RecentSearchesList,
    TierHeader,
    SearchModeTabs,
    PeopleSearchPane,
} from '@/components/search';
import type { SearchMode } from '@/components/search';

type Palette = typeof Colors.light;

// ── Module-scope state — preserved across tab mounts within the session ──────
// Tracks whether the tab has been mounted at least once (for autofocus gate)
let hasAutoFocused = false;
// Last query string — survives tab unmount so query is restored
let lastQuery = '';
// Last scroll offset — survives tab unmount so scroll position is restored
let lastScrollOffset = 0;

// ── Row types for FlatList ───────────────────────────────────────────────────

type SectionHeaderItem = { _type: 'header'; label: string; key: string };
type ResultItem = { _type: 'result'; row: SearchResultRowType; key: string };
type FlatItem = SectionHeaderItem | ResultItem;

function buildFlatList(results: {
    visited: SearchResultRowType[];
    onNapkin: SearchResultRowType[];
    morePlaces: SearchResultRowType[];
}): FlatItem[] {
    const items: FlatItem[] = [];

    if (results.visited.length > 0) {
        items.push({ _type: 'header', label: 'Your Tables', key: 'hdr-visited' });
        for (const row of results.visited) {
            items.push({ _type: 'result', row, key: `r-${row.id ?? row.placeId ?? row.name}` });
        }
    }
    if (results.onNapkin.length > 0) {
        items.push({ _type: 'header', label: 'On Napkin', key: 'hdr-onnapkin' });
        for (const row of results.onNapkin) {
            items.push({ _type: 'result', row, key: `r-${row.id ?? row.placeId ?? row.name}` });
        }
    }
    if (results.morePlaces.length > 0) {
        items.push({ _type: 'header', label: 'More places', key: 'hdr-more' });
        for (const row of results.morePlaces) {
            items.push({ _type: 'result', row, key: `r-${row.id ?? row.placeId ?? row.name}` });
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

    // [ARCH-REVIEW-M1] Seed search from ?q= route param (used by ImportLinkSheet fallback).
    // Consumed once on mount; cleared so re-entering the tab doesn't auto-re-search.
    const { q: prefillQ } = useLocalSearchParams<{ q?: string }>();
    const prefillConsumedRef = useRef(false);

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

    // Immediate display value (responsive to keystrokes)
    const [immediateQuery, setImmediateQuery] = useState(lastQuery);
    // Debounced query that actually drives the search hook
    const [debouncedQuery, setDebouncedQuery] = useState(lastQuery);

    const inputRef = useRef<TextInput>(null);
    const listRef = useRef<FlatList<FlatItem>>(null);
    const didRestoreScrollRef = useRef(false);

    // ── Geolocation for Places bias ──────────────────────────────────────
    const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getLastKnownPositionAsync() ??
                    await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                if (loc) setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            } catch {
                // Location unavailable — search works fine without bias
            }
        })();
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

    // Autofocus on first mount only
    useFocusEffect(
        useCallback(() => {
            if (!hasAutoFocused) {
                hasAutoFocused = true;
                // Use requestAnimationFrame to avoid racing the tab transition animation
                requestAnimationFrame(() => {
                    inputRef.current?.focus();
                });
            }
        }, []),
    );

    const { results, isLoading, isPlacesError, refetch } = useRestaurantSearch(
        debouncedQuery,
        user?.id,
        coords,
    );
    const recentQueries = useRecentSearches();

    const hasQuery = immediateQuery.trim().length > 0;
    const hasResults =
        results.visited.length > 0 ||
        results.onNapkin.length > 0 ||
        results.morePlaces.length > 0;

    const flatData = hasQuery ? buildFlatList(results) : [];

    // Pick the first table as context for persisted restaurant navigation
    const activeTableId = tables?.[0]?.tables?.id;

    const handleResultPress = useCallback(
        (item: SearchResultRowType) => {
            if (item.tier === 'morePlaces' && item.placeId) {
                // Ghost: navigate with placeId param and full payload for instant hero render
                router.push({
                    pathname: '/restaurant/[id]',
                    params: {
                        id: item.placeId,
                        placeId: item.placeId,
                        placePayload: JSON.stringify(item),
                    },
                });
            } else if (item.id) {
                // Persisted: navigate with Napkin DB id
                router.push({
                    pathname: '/restaurant/[id]',
                    params: {
                        id: item.id,
                        ...(activeTableId ? { tableId: activeTableId } : {}),
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

    const handleClear = useCallback(() => {
        setImmediateQuery('');
        setDebouncedQuery('');
    }, []);

    const renderItem = useCallback(
        ({ item }: { item: FlatItem }) => {
            if (item._type === 'header') {
                return <TierHeader label={item.label} />;
            }
            return <SearchResultRow item={item.row} onPress={handleResultPress} />;
        },
        [handleResultPress],
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
                {!FRIEND_TEST.hidePeopleSearch && (
                    <SearchModeTabs mode={mode} onModeChange={setMode} />
                )}
                <SearchInput
                    ref={inputRef}
                    value={immediateQuery}
                    onChangeImmediate={setImmediateQuery}
                    onChangeDebounced={setDebouncedQuery}
                    onClear={handleClear}
                />
            </View>

            {/* People tab — unmounted when Places is active so no stale render.
                 Entire people path gated behind FRIEND_TEST.hidePeopleSearch. */}
            {!FRIEND_TEST.hidePeopleSearch && mode === 'people' ? (
                <PeopleSearchPane
                    query={immediateQuery}
                    debouncedQuery={debouncedQuery}
                />
            ) : (
                /* Places content (unchanged) */
                !hasQuery ? (
                    // Empty state — canvas E·SEARCH
                    <ScrollView
                        style={styles.emptyContainer}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                        keyboardShouldPersistTaps="handled"
                    >
                        {recentQueries.length > 0 && (
                            <RecentSearchesList
                                queries={recentQueries}
                                onSelect={handleRecentSelect}
                            />
                        )}
                        {/* No placeholder slab — a clean, focused search field with
                            nothing to apologise for is the empty state. */}
                    </ScrollView>
                ) : isLoading && !hasResults ? (
                    // Loading state
                    <View style={styles.centeredState}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : (
                    // Results (or error overlay)
                    <FlatList
                        ref={listRef}
                        data={flatData}
                        keyExtractor={(item) => item.key}
                        renderItem={renderItem}
                        keyboardShouldPersistTaps="handled"
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
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
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
