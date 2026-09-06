import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { flattenFriendsFeed, type FriendsActivityRow, type PinFeedRow, useFriendsFeed } from '@/hooks/feed';
import { ErrorState } from '@/components/ErrorState';
import { shouldShowSparseTail } from './feedRouting';
import { feedSectionLabel } from './feedDates';
import { ActivityFeedRow, PinDigestRow } from './ActivityFeedRow';
import { SectionKicker } from './SectionKicker';
import { FriendFeedCard } from './FriendFeedCard';
import { FeedSparseTail } from './FeedSparseTail';
import { FollowingEmptyState } from './FollowingEmptyState';

export type FeedListItem =
    | { _type: 'header'; key: string; label: string }
    | { _type: 'row'; key: string; row: FriendsActivityRow; showDivider: boolean }
    | { _type: 'pins'; key: string; rows: PinFeedRow[]; showDivider: boolean };

/** Consecutive pins by one person in one date section fold into a digest. */
export const PIN_DIGEST_MIN = 2;

/**
 * Interleave a date-section header before the first row of each day boundary,
 * and fold a run of pins by the same person (within one section) into a single
 * digest row so an import or a saving spree never spams the feed. A lone pin
 * stays a normal row. Expanded digests render their pins in place.
 */
export function buildFeedList(
    rows: FriendsActivityRow[],
    expandedDigests: ReadonlySet<string> = new Set(),
): FeedListItem[] {
    const items: FeedListItem[] = [];
    let lastLabel = '';
    let i = 0;
    while (i < rows.length) {
        const row = rows[i];
        const label = feedSectionLabel(row.sort_date);
        if (label !== lastLabel) {
            // Keyed by the section's first row id, not the label — bare month
            // labels ("June") can recur across years on a deep scroll.
            items.push({ _type: 'header', key: `header-${row.id}`, label });
            lastLabel = label;
        }
        if (row.kind === 'pin') {
            const run: PinFeedRow[] = [row];
            let j = i + 1;
            while (
                j < rows.length
                && rows[j].kind === 'pin'
                && rows[j].user_id === row.user_id
                && feedSectionLabel(rows[j].sort_date) === label
            ) {
                run.push(rows[j] as PinFeedRow);
                j += 1;
            }
            const digestKey = `pins-${row.id}`;
            if (run.length >= PIN_DIGEST_MIN && !expandedDigests.has(digestKey)) {
                items.push({ _type: 'pins', key: digestKey, rows: run, showDivider: j < rows.length });
                i = j;
                continue;
            }
        }
        items.push({
            _type: 'row',
            key: `row-${row.id}`,
            row,
            showDivider: i < rows.length - 1,
        });
        i += 1;
    }
    return items;
}

/** The digest key a run of pins collapses under; the first pin's id anchors it. */
export function pinDigestKey(rows: FriendsActivityRow[], index: number): string | null {
    const row = rows[index];
    if (!row || row.kind !== 'pin') return null;
    const label = feedSectionLabel(row.sort_date);
    let start = index;
    while (
        start > 0
        && rows[start - 1].kind === 'pin'
        && rows[start - 1].user_id === row.user_id
        && feedSectionLabel(rows[start - 1].sort_date) === label
    ) start -= 1;
    return `pins-${rows[start].id}`;
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
    const [expandedDigests, setExpandedDigests] = useState<ReadonlySet<string>>(() => new Set());
    const listData = useMemo(() => buildFeedList(rows, expandedDigests), [rows, expandedDigests]);
    const expandDigest = useCallback((key: string) => {
        setExpandedDigests((current) => {
            if (current.has(key)) return current;
            const next = new Set(current);
            next.add(key);
            return next;
        });
    }, []);

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
            if (item._type === 'pins') {
                return (
                    <View style={styles.rowSlot}>
                        <PinDigestRow
                            rows={item.rows}
                            showDivider={item.showDivider}
                            onExpand={() => expandDigest(item.key)}
                        />
                    </View>
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
        [listData, expandDigest],
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
