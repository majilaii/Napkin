/**
 * FollowingFeed — the purified Following body of the Feed tab (TICKET-125).
 *
 * Pure chronological reviews from people you follow — nothing else. This is the
 * pre-125 feed.tsx FlatList (date-sectioned FriendFeedCard rows, keyset
 * paginated) with discovery SUBTRACTED:
 *   - the TrendingRail is GONE from the header (it moved to For You),
 *   - the sparse tail is the "· you're caught up ·" mark ONLY (the discovery
 *     ledger moved to For You).
 * Its empty state is the honest "you don't follow anyone yet" home
 * (FollowingEmptyState — ghost + invite + a quiet hand-off to For You).
 *
 * The single useFriendsFeed subscription lives in feed.tsx and is passed in as
 * `feedQuery` (avoids a double subscription — the load-bearing risk). The shared
 * FeedHeader is passed as `ListHeaderComponent` so the masthead reads continuous
 * across a mode switch.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { flattenFriendsFeed, type FriendFeedRow, useFriendsFeed } from '@/hooks/feed';
import { ErrorState } from '@/components/ErrorState';
import { shouldShowSparseTail, isNoteCard } from './feedRouting';
import { feedSectionLabel } from './feedDates';
import { FriendFeedCard } from './FriendFeedCard';
import { FeedSparseTail } from './FeedSparseTail';
import { FollowingEmptyState } from './FollowingEmptyState';

type FeedListItem =
    | { _type: 'header'; key: string; label: string }
    | { _type: 'row'; key: string; row: FriendFeedRow; marginBottom: number };

/**
 * Interleave a date-section header before the first row of each day boundary.
 * Consecutive ledger rows stack tight (13px — they're the mortar); everything
 * else gets 16px. The header carries its own top margin, so trailing spacing
 * is harmless below a section break.
 */
function buildFeedList(rows: FriendFeedRow[]): FeedListItem[] {
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
        // Tight 13px gap only between two adjacent ledger rows on the same day.
        const next = rows[i + 1];
        const bothLedger =
            !!next &&
            !isNoteCard(row) &&
            !isNoteCard(next) &&
            feedSectionLabel(next.sort_date) === label;
        items.push({
            _type: 'row',
            key: `row-${row.id}`,
            row,
            marginBottom: bothLedger ? 13 : 16,
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
        isRefetching,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = feedQuery;

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
                    <Text style={[styles.dateHeader, { color: palette.textMuted }]}>{item.label}</Text>
                );
            }
            return (
                <View style={[styles.rowSlot, { marginBottom: item.marginBottom }]}>
                    <FriendFeedCard row={item.row} />
                </View>
            );
        },
        [palette],
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
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
        />
    );
}

const styles = StyleSheet.create({
    dateHeader: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        paddingHorizontal: Spacing.lg,
        marginTop: 22,
        marginBottom: 12,
    },
    rowSlot: {
        paddingHorizontal: Spacing.lg,
    },
});
