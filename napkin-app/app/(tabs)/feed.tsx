/**
 * Feed tab — cross-Table chronological feed.
 *
 * Shape matches feed-canvas.jsx from the Napkin Design System:
 *   Header · Scope pills · Trending rail · Date-grouped entries · Terminus
 *
 * "Friends" in Napkin v1 == Tablemates. The feed unions entries across every
 * Table the user belongs to, capped to a rolling 14-day window, then renders
 * them chronologically. Rating-only entries become FastLogRow one-liners;
 * entries with prose or photos become FriendLogCard prose cards.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useFeed, flattenFeed, type FeedEntry, TOWN_TRENDING_MOCK } from '@/hooks/feed';
import { queryKeys } from '@/lib/queryKeys';
import {
    FeedHeader,
    ScopePills,
    TrendingRail,
    FeedDateHeader,
    FriendLogCard,
    FastLogRow,
    FeedTerminus,
    type FeedScope,
} from '@/components/feed';

type Group = { label: string; entries: FeedEntry[] };

export default function FeedScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [scope, setScope] = useState<FeedScope>('tables');

    const {
        data,
        isLoading,
        refetch,
        isRefetching,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useFeed(user?.id);

    // Flatten all pages into a single entry array
    const entries = useMemo(() => flattenFeed(data), [data]);
    const groups = useMemo(() => groupByDay(entries), [entries]);

    // Trending comes from the first page only
    const page0 = data?.pages?.[0] as any;
    const railTitle = scope === 'tables' ? 'Circling your table' : 'Around town';
    const railKicker = scope === 'tables' ? 'Circling · 14 days' : 'Popular · 7 days';
    const railScope = scope === 'tables' ? 'Tablemates' : 'London · editorial';
    const trending = scope === 'tables' ? page0?.trending ?? [] : TOWN_TRENDING_MOCK;

    const onRefresh = () => {
        if (user?.id) {
            queryClient.invalidateQueries({ queryKey: queryKeys.feed.all(user.id) });
        }
        refetch();
    };

    const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
        const nearEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 300;
        if (nearEnd && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top }}>
            <FeedHeader />

            <ScrollView
                contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
                showsVerticalScrollIndicator={false}
                onMomentumScrollEnd={onScrollEnd}
                onScrollEndDrag={onScrollEnd}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={onRefresh}
                        tintColor={palette.primary}
                    />
                }
            >
                <ScopePills scope={scope} onChange={setScope} />

                <TrendingRail
                    kicker={railKicker}
                    title={railTitle}
                    scope={railScope}
                    posters={trending}
                />

                {isLoading && !data ? (
                    <View style={{ paddingVertical: Spacing.xxl, alignItems: 'center' }}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : groups.length === 0 ? (
                    <EmptyState />
                ) : (
                    <>
                        {groups.map((g) => (
                            <View key={g.label}>
                                <FeedDateHeader label={g.label} />
                                {g.entries.map((entry) => (
                                    <FeedItem key={entry.id} entry={entry} />
                                ))}
                            </View>
                        ))}
                        {isFetchingNextPage && (
                            <View style={{ paddingVertical: Spacing.lg, alignItems: 'center' }}>
                                <ActivityIndicator color={palette.primary} />
                            </View>
                        )}
                        <FeedTerminus windowDays={page0?.window_days ?? 14} />
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function FeedItem({ entry }: { entry: FeedEntry }) {
    const isFast = !entry.content?.trim() && entry.photos.length === 0;
    const time = formatRelative(entry.sort_date);
    const sub = formatSub(entry);

    if (isFast) {
        return <FastLogRow entry={entry} sub={sub} />;
    }
    return <FriendLogCard entry={entry} time={time} sub={sub} />;
}

function EmptyState() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <View style={{ padding: 22 }}>
            <View
                style={{
                    padding: 18,
                    borderRadius: 10,
                    backgroundColor: palette.surfaceContainerLow,
                    borderWidth: 1,
                    borderColor: palette.border,
                }}
            >
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 18,
                        color: palette.text,
                        lineHeight: 24,
                    }}
                >
                    Your Feed is where your tablemates&rsquo; meals show up.
                </Text>
                <Text
                    style={{
                        fontFamily: 'Manrope_400Regular',
                        fontSize: 12,
                        color: palette.textMuted,
                        marginTop: 6,
                        lineHeight: 18,
                    }}
                >
                    Start a Table with a few people and this page fills with their logs.
                </Text>
            </View>
        </View>
    );
}

// ── helpers ────────────────────────────────────────────────────────────────

function groupByDay(entries: FeedEntry[]): Group[] {
    const map = new Map<string, { label: string; entries: FeedEntry[] }>();
    const now = new Date();
    const today = dayKey(now);
    const yDate = new Date(now);
    yDate.setDate(now.getDate() - 1);
    const yesterday = dayKey(yDate);

    for (const e of entries) {
        const d = new Date(e.sort_date);
        const key = dayKey(d);
        let label: string;
        if (key === today) label = 'Today · ' + d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        else if (key === yesterday) label = 'Yesterday';
        else label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        const bucket = map.get(key) ?? { label, entries: [] };
        bucket.entries.push(e);
        map.set(key, bucket);
    }

    return [...map.values()].map((b) => ({ ...b, entries: b.entries }));
}

function dayKey(d: Date) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatRelative(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / (60 * 60 * 1000));
    if (h < 1) return 'now';
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

function formatSub(entry: FeedEntry): string | undefined {
    const d = entry.visited_at ? new Date(entry.visited_at) : null;
    if (!d) return undefined;
    const hour = d.getHours();
    if (hour >= 5 && hour < 11) return 'Breakfast';
    if (hour >= 11 && hour < 15) return 'Lunch';
    if (hour >= 15 && hour < 18) return 'Afternoon';
    if (hour >= 18 && hour < 23) return 'Dinner';
    return 'Late';
}
