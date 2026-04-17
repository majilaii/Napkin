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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
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
} from '@/components/search';

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

    // Immediate display value (responsive to keystrokes)
    const [immediateQuery, setImmediateQuery] = useState(lastQuery);
    // Debounced query that actually drives the search hook
    const [debouncedQuery, setDebouncedQuery] = useState(lastQuery);

    const inputRef = useRef<TextInput>(null);
    const listRef = useRef<FlatList<FlatItem>>(null);
    const didRestoreScrollRef = useRef(false);

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
                <Text style={[Type.titleLarge, styles.screenTitle, { color: palette.text }]}>
                    Search
                </Text>
                <SearchInput
                    ref={inputRef}
                    value={immediateQuery}
                    onChangeImmediate={setImmediateQuery}
                    onChangeDebounced={setDebouncedQuery}
                    onClear={handleClear}
                />
            </View>

            {/* Content */}
            {!hasQuery ? (
                // Empty state
                <View style={styles.emptyContainer}>
                    {recentQueries.length === 0 && (
                        <Text style={[Type.body, styles.emptyHint, { color: palette.textMuted }]}>
                            Start typing to find any restaurant
                        </Text>
                    )}
                    <RecentSearchesList
                        queries={recentQueries}
                        onSelect={handleRecentSelect}
                    />
                </View>
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
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.sm,
        paddingBottom: 0,
    },
    emptyContainer: {
        flex: 1,
        paddingTop: Spacing.md,
    },
    emptyHint: {
        textAlign: 'center',
        paddingHorizontal: Spacing.xl,
        marginTop: Spacing.xl,
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
