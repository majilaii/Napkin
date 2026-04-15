/**
 * Tables tab — activity feed for the active table.
 * Phase 1 features:
 *   - Filter chips (All, Rounds, Solo Shares, By Me, per-member)
 *   - Sticky date section headers (Today/Yesterday/This Week/Last Week/Month Year)
 *   - Pinned active rounds shelf above the feed
 *   - Compact mode for entries older than 14 days (tap to expand)
 *   - Server-side filtering via filter_type / filter_user_id params
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    SectionList,
    RefreshControl,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import {
    useTableActivity,
    type ActivityItem,
    type TableNightActivity,
    type SoloShareActivity,
} from '@/hooks/tables/useTableActivity';
import {
    FilterChipRow,
    DateSectionHeader,
    ActiveRoundsShelf,
    CompactEntryRow,
    TableNightCard,
    SoloShareCard,
    type FilterChip,
} from '@/components/feed';

// ── Date bucketing ──────────────────────────────────────────────────────────

function isoWeek(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function isoYear(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    return date.getUTCFullYear();
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function dateBucketLabel(sortDate: string, now: Date): string {
    const d = new Date(sortDate);
    const dY = d.getFullYear();
    const dM = d.getMonth();
    const dD = d.getDate();
    const nY = now.getFullYear();
    const nM = now.getMonth();
    const nD = now.getDate();

    if (dY === nY && dM === nM && dD === nD) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
        dY === yesterday.getFullYear() &&
        dM === yesterday.getMonth() &&
        dD === yesterday.getDate()
    ) {
        return 'Yesterday';
    }

    const dWeek = isoWeek(d);
    const dIsoYear = isoYear(d);
    const nWeek = isoWeek(now);
    const nIsoYear = isoYear(now);

    if (dIsoYear === nIsoYear && dWeek === nWeek) return 'This Week';

    const prevWeekDate = new Date(now);
    prevWeekDate.setDate(now.getDate() - 7);
    const prevWeek = isoWeek(prevWeekDate);
    const prevIsoYear = isoYear(prevWeekDate);
    if (dIsoYear === prevIsoYear && dWeek === prevWeek) return 'Last Week';

    return `${MONTH_NAMES[dM]} ${dY}`;
}

interface FeedSection {
    title: string;
    data: ActivityItem[];
}

function groupIntoSections(items: ActivityItem[], now: Date): FeedSection[] {
    const sectionMap = new Map<string, ActivityItem[]>();
    const sectionOrder: string[] = [];

    for (const item of items) {
        const label = dateBucketLabel(item.sort_date, now);
        if (!sectionMap.has(label)) {
            sectionMap.set(label, []);
            sectionOrder.push(label);
        }
        sectionMap.get(label)!.push(item);
    }

    return sectionOrder.map((title) => ({
        title,
        data: sectionMap.get(title)!,
    }));
}

// ── Static filter chips ────────────────────────────────────────────────────

const STATIC_CHIPS: FilterChip[] = [
    { key: 'all', label: 'All' },
    { key: 'round', label: 'Rounds' },
    { key: 'solo_share', label: 'Solo Shares' },
    { key: 'by_me', label: 'By Me' },
];

// ── Compact mode cutoff ────────────────────────────────────────────────────

const COMPACT_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000;

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TablesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    // Table switching
    const { data: tables, isLoading: tablesLoading } = useTables(user?.id);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const activeTable = tables?.[selectedIndex]?.tables ?? tables?.[0]?.tables;
    const hasMultipleTables = (tables?.length ?? 0) > 1;

    const cycleTable = () => {
        if (!tables || tables.length <= 1) return;
        setSelectedIndex((i) => (i + 1) % tables.length);
    };

    // Filter state — reset when table changes
    const [activeFilter, setActiveFilter] = useState<string | null>(null);

    useEffect(() => {
        setActiveFilter(null);
    }, [activeTable?.id]);

    // Member list for per-member chips
    const { data: members } = useTableMembers(activeTable?.id);

    const chips: FilterChip[] = useMemo(() => {
        const memberChips: FilterChip[] = (members ?? [])
            .filter((m) => m.member_id !== user?.id)
            .map((m) => ({
                key: m.member_id,
                label: m.profiles?.display_name ?? 'Member',
            }));
        return [...STATIC_CHIPS, ...memberChips];
    }, [members, user?.id]);

    // Derive server-side filter params from the active chip
    const filterParams = useMemo(() => {
        if (!activeFilter || activeFilter === 'all') return undefined;
        if (activeFilter === 'round') return { filterType: 'round' as const };
        if (activeFilter === 'solo_share') return { filterType: 'solo_share' as const };
        if (activeFilter === 'by_me') return { filterUserId: user?.id };
        return { filterUserId: activeFilter };
    }, [activeFilter, user?.id]);

    const {
        data: activityData,
        isLoading: feedLoading,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id, filterParams);

    const items: ActivityItem[] = useMemo(
        () => activityData?.pages?.flat() ?? [],
        [activityData],
    );

    // Partition: active rounds go to the pinned shelf, rest goes into date sections
    const { activeRounds, feedItems } = useMemo(() => {
        const rounds: TableNightActivity[] = [];
        const feed: ActivityItem[] = [];
        for (const item of items) {
            if (
                item.type === 'table_night' &&
                (item as TableNightActivity).status === 'rating'
            ) {
                rounds.push(item as TableNightActivity);
            } else {
                feed.push(item);
            }
        }
        return { activeRounds: rounds, feedItems: feed };
    }, [items]);

    // Date sections — memoized; `now` is stable for the lifetime of this render pass
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const now = useMemo(() => new Date(), []);
    const sections: FeedSection[] = useMemo(
        () => groupIntoSections(feedItems, now),
        [feedItems, now],
    );

    // Compact mode — one expanded entry at a time
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

    const handleToggleExpand = (itemId: string) => {
        setExpandedItemId((prev) => (prev === itemId ? null : itemId));
    };

    // Per-filter empty state labels
    const emptyLabel = useMemo(() => {
        if (!activeFilter || activeFilter === 'all') return 'Nothing here yet';
        if (activeFilter === 'round') return 'No rounds yet';
        if (activeFilter === 'solo_share') return 'No solo shares yet';
        if (activeFilter === 'by_me') return 'No entries from you yet';
        const chip = chips.find((c) => c.key === activeFilter);
        return chip ? `No entries from ${chip.label}` : 'Nothing here yet';
    }, [activeFilter, chips]);

    const emptySubLabel = useMemo(() => {
        if (!activeFilter || activeFilter === 'all') {
            return 'Log a meal or start a Table Night to get the conversation going.';
        }
        return 'Try switching to a different filter.';
    }, [activeFilter]);

    if (tablesLoading) {
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (!activeTable) {
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <Text style={[Type.displaySmall, { color: palette.text }]}>
                    No tables yet
                </Text>
                <Text
                    style={[
                        Type.body,
                        {
                            color: palette.textSecondary,
                            marginTop: Spacing.sm,
                            textAlign: 'center',
                        },
                    ]}
                >
                    Create or join a table to get started.
                </Text>
            </View>
        );
    }

    const tableName = activeTable.name;
    const isEmpty =
        !feedLoading && items.length === 0 && activeRounds.length === 0;
    const compactCutoff = now.getTime() - COMPACT_CUTOFF_MS;

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            {/* Fixed header + filter chips */}
            <View style={{ paddingTop: insets.top + Spacing.sm }}>
                <View style={styles.header}>
                    <Pressable
                        onPress={cycleTable}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                        <Text
                            style={[
                                Type.headlineLarge,
                                {
                                    color: palette.text,
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 28,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {tableName}
                        </Text>
                        {hasMultipleTables && (
                            <Text style={{ color: palette.textMuted, fontSize: 14 }}>▾</Text>
                        )}
                    </Pressable>
                </View>

                <FilterChipRow
                    chips={chips}
                    activeKey={activeFilter}
                    onSelect={(key) => setActiveFilter(key === 'all' ? null : key)}
                    palette={palette}
                />
            </View>

            {/* Feed */}
            {feedLoading ? (
                <ActivityIndicator
                    color={palette.primary}
                    style={{ marginTop: Spacing.xxl }}
                />
            ) : isEmpty ? (
                <View
                    style={{
                        padding: Spacing.xl,
                        alignItems: 'center',
                        marginTop: Spacing.xxl,
                    }}
                >
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.text, textAlign: 'center' },
                        ]}
                    >
                        {emptyLabel}
                    </Text>
                    <Text
                        style={[
                            Type.body,
                            {
                                color: palette.textSecondary,
                                textAlign: 'center',
                                marginTop: Spacing.sm,
                            },
                        ]}
                    >
                        {emptySubLabel}
                    </Text>
                </View>
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={(item) => `${item.type}-${item.id}`}
                    stickySectionHeadersEnabled
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefetching}
                            onRefresh={refetch}
                            tintColor={palette.primary}
                        />
                    }
                    contentContainerStyle={{ paddingBottom: 100 }}
                    ListHeaderComponent={
                        <ActiveRoundsShelf items={activeRounds} palette={palette} />
                    }
                    renderSectionHeader={({ section }) => (
                        <DateSectionHeader title={section.title} palette={palette} />
                    )}
                    renderItem={({ item }) => {
                        const itemDate = new Date(item.sort_date).getTime();
                        const isOld = itemDate < compactCutoff;
                        const isExpanded = expandedItemId === item.id;

                        if (isOld && !isExpanded) {
                            return (
                                <CompactEntryRow
                                    item={item}
                                    palette={palette}
                                    onPress={() => handleToggleExpand(item.id)}
                                />
                            );
                        }

                        if (item.type === 'table_night') {
                            return (
                                <View style={styles.cardWrapper}>
                                    <TableNightCard
                                        item={item as TableNightActivity}
                                        palette={palette}
                                    />
                                </View>
                            );
                        }
                        return (
                            <View style={styles.cardWrapper}>
                                <SoloShareCard
                                    item={item as SoloShareActivity}
                                    palette={palette}
                                />
                            </View>
                        );
                    }}
                    ItemSeparatorComponent={() => (
                        <View style={{ height: Spacing.xl }} />
                    )}
                />
            )}
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
    },
    header: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    cardWrapper: {
        paddingHorizontal: Spacing.lg,
    },
});
