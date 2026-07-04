/**
 * Feed tab — TICKET-098: friends-only reviews feed + trending wishlist rail.
 *
 * Replaces the legacy TICKET-032 cross-Table feed wholesale (useFeed /
 * ScopePills / FastLogRow / logger-count trending all deleted).
 *
 *   [masthead: italic serif "Feed"]
 *   [trending rail — Phase B; hidden entirely below 3 qualifying restaurants]
 *   [friends reviews — reverse-chron FriendFeedCard list, keyset paginated]
 *
 * Zero-follow / empty state: the rail (if it qualifies) + exactly one lowercase
 * line. No location prompt on this tab (wishlist owns the grant).
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
import { FriendFeedCard, TrendingRail } from '@/components/feed';
import type { FriendFeedRow } from '@/hooks/feed';

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

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const renderItem = useCallback(
        ({ item }: { item: FriendFeedRow }) => <FriendFeedCard row={item} />,
        [],
    );

    const ListHeader = useMemo(
        () => (
            <View>
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Text style={[styles.title, { color: palette.text }]}>Feed</Text>
                </View>
                {/* Finite trending rail — renders nothing below 3 qualifiers. */}
                <TrendingRail />
            </View>
        ),
        [insets.top, palette],
    );

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <FlatList
                data={rows}
                keyExtractor={(r) => r.id}
                renderItem={renderItem}
                ListHeaderComponent={ListHeader}
                ListEmptyComponent={
                    isLoading ? (
                        <ActivityIndicator
                            style={{ marginTop: Spacing.xl }}
                            color={palette.primary}
                        />
                    ) : (
                        <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                            follow people you eat with
                        </Text>
                    )
                }
                ListFooterComponent={
                    isFetchingNextPage ? (
                        <ActivityIndicator
                            style={{ marginVertical: Spacing.lg }}
                            color={palette.primary}
                        />
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
    emptyLine: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
        marginTop: Spacing.xxl,
    },
});
