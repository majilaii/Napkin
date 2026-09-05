import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { flattenFriendsFeed, type FriendsActivityRow, useFriendsFeed } from '@/hooks/feed';
import { ErrorState } from '@/components/ErrorState';
import { shouldShowSparseTail } from './feedRouting';
import { feedSectionLabel } from './feedDates';
import { ActivityFeedRow } from './ActivityFeedRow';
import { SectionKicker } from './SectionKicker';
import { FriendFeedCard } from './FriendFeedCard';
import { FeedSparseTail } from './FeedSparseTail';
import { FollowingEmptyState } from './FollowingEmptyState';

type FeedListItem =
    | { _type: 'header'; key: string; label: string }
    | { _type: 'row'; key: string; row: FriendsActivityRow; showDivider: boolean };

/**
 * Interleave a date-section header before the first row of each day boundary.
 * Each of the three feed weights now owns its approved internal rhythm, so the
 * list wrapper adds no generic card-sized gutter between dense rows.
 */
function buildFeedList(rows: FriendsActivityRow[]): FeedListItem[] {
    const items: FeedListItem[] = [];
    let lastLabel = '';
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const label = feedSectionLabel(row.sort_date);
        if (label !== lastLabel) {
            // Keyed by the section's first row id, not the label — bare month
            // labels ("June") can recur across years on a deep scroll.
            items.push({ _type: 'header', key: `header-${row.id}`, label });
            lastLabel = label;
        }
        items.push({
            _type: 'row',
            key: `row-${row.id}`,
            row,
            showDivider: i < rows.length - 1,
        });
    }
    return items;
}

interface Props {
    /** The single useFriendsFeed subscription — owned by feed.tsx, passed down. */
    feedQuery: ReturnType<typeof useFriendsFeed>;
    ListHeaderComponent: React.ReactElement;
    /** Flip the tab to For You (used by the empty state's discovery hand-off). */
    onSwitchToForYou: () => void;
}

export function FollowingFeed({ feedQuery, ListHeaderComponent, onSwitchToForYou }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const {
        data,
        isLoading,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = feedQuery;

    const [refreshing, setRefreshing] = useState(false);
    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try { await refetch(); } finally { setRefreshing(false); }
    }, [refetch]);
    const rows = useMemo(() => flattenFriendsFeed(data), [data]);
    const listData = useMemo(() => buildFeedList(rows), [rows]);

    // Caught-up mark whenever the feed reached true end-of-list with a thin set.
    const showSparseTail = shouldShowSparseTail({ rows, hasNextPage: !!hasNextPage, isLoading });

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const renderItem = useCallback(
        ({ item }: { item: FeedListItem }) => {
            if (item._type === 'header') {
                return (
                    <SectionKicker first={item.key === listData[0]?.key}>{item.label}</SectionKicker>
                );
            }
            return (
                <View style={styles.rowSlot}>
                    {item.row.kind === 'pin' || item.row.kind === 'list'
                        ? <ActivityFeedRow row={item.row} showDivider={item.showDivider} />
                        : <FriendFeedCard row={item.row} showDivider={item.showDivider} />}
                </View>
            );
        },
        [listData],
    );

    return (
        <FlatList
            data={listData}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            ListHeaderComponent={ListHeaderComponent}
            ListEmptyComponent={
                isLoading ? (
                    <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
                ) : isError ? (
                    // Only reachable with zero rows to render — cached pages keep
                    // rendering as today (TICKET-121).
                    <ErrorState onRetry={refetch} />
                ) : (
                    <FollowingEmptyState onSwitchToForYou={onSwitchToForYou} />
                )
            }
            ListFooterComponent={
                isFetchingNextPage ? (
                    <ActivityIndicator style={{ marginVertical: Spacing.lg }} color={palette.primary} />
                ) : showSparseTail ? (
                    <FeedSparseTail />
                ) : null
            }
            onEndReached={onEndReached}
            onEndReachedThreshold={0.4}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={palette.primary}
                />
            }
        />
    );
}

const styles = StyleSheet.create({ rowSlot: { paddingHorizontal: Spacing.lg } });
