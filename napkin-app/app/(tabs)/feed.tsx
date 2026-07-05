/**
 * Feed tab — TICKET-098 friends-only reviews feed + trending rail, re-dressed in
 * TICKET-103 to the note-card / ledger-line grammar.
 *
 *   [masthead: italic serif "Feed" + small-caps current date]
 *   [trending rail — only when the feed breathes beneath it (rows > 0, not sparse)]
 *   [date-sectioned friend feed — note cards + ledger rows, keyset paginated]
 *   [sparse tail — "· you're caught up ·" + discovery ledger, on a thin feed]
 *
 * The list stays a single FlatList; date headers are interleaved into a memoized
 * FeedListItem[] (header/row discriminated union), mirroring JournalList's
 * buildFlatList idiom — so pagination/refresh/footer plumbing is untouched.
 *
 * Rail-vs-ledger exclusivity is structural: the horizontal rail lives ONLY in
 * ListHeaderComponent (mounted iff rows > 0 && !showSparseTail); the vertical
 * discovery ledger lives ONLY in the empty state or the sparse-tail footer.
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    ActivityIndicator,
    RefreshControl,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useFriendsFeed, flattenFriendsFeed } from '@/hooks/feed';
import { FriendFeedCard, TrendingRail, FeedEmptyState, FeedSparseTail } from '@/components/feed';
import { shouldShowSparseTail, isNoteCard } from '@/components/feed/feedRouting';
import { feedSectionLabel, feedMastheadDate } from '@/components/feed/feedDates';
import type { FriendFeedRow } from '@/hooks/feed';

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

export default function FeedScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const {
        data,
        isLoading,
        refetch,
        isRefetching,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFriendsFeed(user?.id);

    const rows = useMemo(() => flattenFriendsFeed(data), [data]);
    const listData = useMemo(() => buildFeedList(rows), [rows]);
    const mastDate = useMemo(() => feedMastheadDate(), []);

    // Single deterministic gate: caught-up mark + discovery ledger tail whenever
    // the feed reached true end-of-list with a thin set of rows.
    const showSparseTail = shouldShowSparseTail({ rows, hasNextPage: !!hasNextPage, isLoading });
    // Rail (horizontal) and ledger (vertical) are mutually exclusive by
    // construction: rail only when the feed breathes and isn't sparse.
    const showRail = rows.length > 0 && !showSparseTail;

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

    const ListHeader = useMemo(
        () => (
            <View>
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Text style={[styles.title, { color: palette.text }]}>Feed</Text>
                    <Text style={[styles.mastDate, { color: palette.textMuted }]}>{mastDate}</Text>
                </View>
                {/* Horizontal trending rail — only when the feed breathes beneath it */}
                {showRail && <TrendingRail />}
            </View>
        ),
        [insets.top, palette, mastDate, showRail],
    );

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <FlatList
                data={listData}
                keyExtractor={(item) => item.key}
                renderItem={renderItem}
                ListHeaderComponent={ListHeader}
                ListEmptyComponent={
                    isLoading ? (
                        <ActivityIndicator
                            style={{ marginTop: Spacing.xl }}
                            color={palette.primary}
                        />
                    ) : (
                        // TICKET-101: a designed two-tier empty state (co-diner
                        // follow cards, or ghost + invite) + discovery ledger.
                        <FeedEmptyState />
                    )
                }
                ListFooterComponent={
                    isFetchingNextPage ? (
                        <ActivityIndicator
                            style={{ marginVertical: Spacing.lg }}
                            color={palette.primary}
                        />
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
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
        paddingTop: Spacing.sm,
    },
    mastDate: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9.5,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        marginTop: 4,
    },
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
