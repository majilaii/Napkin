/**
 * Tables tab — activity feed for the active table.
 * Real data via useTables + useTableActivity hooks.
 * Features: TableHeader masthead, TableSwitcherSheet (bottom sheet),
 * EmptyChairInvitation slab for solo-only users, FoundedHero for brand-new tables,
 * PulseDot on live banner, Table Night cards, solo share rows.
 *
 * TICKET-024: visual reskin to Heirloom UI kit. Hooks, state, and filter
 * logic are unchanged.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Pressable,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { WishlistGrid } from '@/components/wishlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useLastSeenAt, useMarkSeen } from '@/hooks/tables/useLastSeenAt';
import {
    useTableActivity,
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
} from '@/hooks/tables/useTableActivity';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { TableNightCard } from '@/components/feed/TableNightCard';
import { SoloShareCard } from '@/components/feed/SoloShareCard';
import { JournalNoteCard } from '@/components/feed/JournalNoteCard';
import { FilterChipRow, type FilterChip } from '@/components/feed/FilterChipRow';
import { DateSectionHeader } from '@/components/feed/DateSectionHeader';

// ── Helpers ────────────────────────────────────────────────────────────────

function getDateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'This Week';
    if (diff < 14) return 'Last Week';
    if (diff < 30) return 'This Month';
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

interface FeedSection {
    label: string;
    items: ActivityItem[];
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TablesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    // Real data
    const { data: tables, isLoading: tablesLoading } = useTables(user?.id);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<'activity' | 'wishlist'>('activity');
    const activeTable = tables?.[selectedIndex]?.tables ?? tables?.[0]?.tables;
    const hasMultipleTables = (tables?.length ?? 0) > 1;
    const [showTablePicker, setShowTablePicker] = useState(false);
    const [invitationDismissed, setInvitationDismissed] = useState(false);

    // Unseen dot system (TICKET-010)
    const { data: lastSeenAt } = useLastSeenAt(activeTable?.id, user?.id);
    const markSeen = useMarkSeen();

    // Fire mark_seen when the tab gains focus or activeTable changes.
    // The 30s debounce in useMarkSeen collapses rapid tab-switches.
    // markSeen.mutate is intentionally omitted from deps — it's stable across
    // renders (React Query memoizes it) and we only want to re-fire on table switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useFocusEffect(
        useCallback(() => {
            if (activeTable?.id) {
                markSeen.mutate({ tableId: activeTable.id });
            }
        }, [activeTable?.id])
    );

    // Unseen dot system (TICKET-010)
    const { data: lastSeenAt } = useLastSeenAt(activeTable?.id, user?.id);
    const markSeen = useMarkSeen();

    // Fire mark_seen when the tab gains focus or activeTable changes.
    // The 30s debounce in useMarkSeen collapses rapid tab-switches.
    // markSeen.mutate is intentionally omitted from deps — it's stable across
    // renders (React Query memoizes it) and we only want to re-fire on table switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useFocusEffect(
        useCallback(() => {
            if (activeTable?.id) {
                markSeen.mutate({ tableId: activeTable.id });
            }
        }, [activeTable?.id])
    );

    const {
        data: activityData,
        isLoading: feedLoading,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id);

    const items: ActivityItem[] = useMemo(
        () => activityData?.pages?.flat() ?? [],
        [activityData],
    );

    // ── Filter / group logic ───────────────────────────────────────────
    const [activeFilter, setActiveFilter] = useState<string | null>(null);
    const { data: members } = useTableMembers(activeTable?.id);

    const filterChips = useMemo<FilterChip[]>(() => {
        const chips: FilterChip[] = [{ key: 'rounds', label: 'Rounds' }];
        if (members) {
            for (const m of members) {
                chips.push({
                    key: `user:${m.member_id}`,
                    label: m.profiles?.display_name ?? 'Unknown',
                });
            }
        }
        return chips;
    }, [members]);

    const filteredItems = useMemo(() => {
        if (!activeFilter) return items;
        if (activeFilter === 'rounds')
            return items.filter((i) => i.type === 'table_night');
        if (activeFilter.startsWith('user:')) {
            const userId = activeFilter.slice(5);
            return items.filter((i) => {
                if (i.type === 'solo_share')
                    return (i as SoloShareActivity).user_id === userId;
                if (i.type === 'table_night')
                    return (i as TableNightActivity).participants?.some(
                        (p) => p.user_id === userId,
                    );
                return false;
            });
        }
        return items;
    }, [items, activeFilter]);

    const activeRounds = useMemo(
        () =>
            items.filter(
                (i) =>
                    i.type === 'table_night' &&
                    (i as TableNightActivity).status === 'rating',
            ) as TableNightActivity[],
        [items],
    );

    const timelineItems = useMemo(
        () =>
            filteredItems.filter(
                (i) =>
                    !(
                        i.type === 'table_night' &&
                        (i as TableNightActivity).status === 'rating'
                    ),
            ),
        [filteredItems],
    );

    const feedSections = useMemo<FeedSection[]>(() => {
        const sections: FeedSection[] = [];
        let current: FeedSection | null = null;
        for (const item of timelineItems) {
            const label = getDateLabel(item.sort_date || item.created_at);
            if (!current || current.label !== label) {
                current = { label, items: [] };
                sections.push(current);
            }
            current.items.push(item);
        }
        return sections;
    }, [timelineItems]);

    // Member names for avatar stack in TableHeader (must be before early returns)
    const memberNames = useMemo(
        () => members?.map((m) => m.profiles?.display_name ?? '?') ?? [],
        [members],
    );

    // Table IDs that have a live round — used by the switcher sheet (must be before early returns)
    const liveRoundTableIds = useMemo(() => {
        const ids = new Set<string>();
        if (activeTable?.id && activeRounds.length > 0) {
            ids.add(activeTable.id);
        }
        return ids;
    }, [activeTable?.id, activeRounds.length]);

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
    const isEmpty = !feedLoading && items.length === 0;

    // Shared header + segmented control (rendered above both tabs)
    // paddingTop is applied by the parent: contentContainerStyle for ScrollView, inline for wishlist
    const headerAndControl = (
        <>
            {/* Header */}
            <View style={styles.header}>
                <Pressable
                    onPress={() => hasMultipleTables && setShowTablePicker(true)}
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

            {/* Activity | Wishlist segmented control */}
            <View style={styles.segmentedControl}>
                {(['activity', 'wishlist'] as const).map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                        <Pressable
                            key={tab}
                            onPress={() => setActiveTab(tab)}
                            style={[
                                styles.segmentButton,
                                isActive && { backgroundColor: palette.primary },
                            ]}
                        >
                            <Text
                                style={[
                                    Type.label,
                                    {
                                        color: isActive ? '#fff' : palette.textSecondary,
                                        fontSize: 10,
                                    },
                                ]}
                            >
                                {tab === 'activity' ? 'Activity' : 'Wishlist'}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            {/* Wishlist tab — FlatList owns its own scrolling, so render outside ScrollView */}
            {activeTab === 'wishlist' ? (
                <View style={{ flex: 1, paddingTop: insets.top + Spacing.sm }}>
                    {headerAndControl}
                    {activeTable && (
                        <WishlistGrid mode="table" tableId={activeTable.id} />
                    )}
                </View>
            ) : (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
                paddingTop: insets.top + Spacing.sm,
                paddingBottom: 100,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
        >
            {headerAndControl}

            {/* Filter chips — activity tab only */}
            {items.length > 0 && (
                <FilterChipRow
                    chips={filterChips}
                    activeKey={activeFilter}
                    onSelect={setActiveFilter}
                    palette={palette}
                />
            )}

    // Shared header + segmented control (rendered above both tabs)
    const headerAndControl = (
        <>
            {/* TableHeader masthead — replaces old inline header block */}
            <TableHeader
                tableName={tableName}
                isPersonal={activeTable.is_personal ?? false}
                memberCount={members?.length ?? 0}
                memberNames={memberNames}
                hasMultipleTables={hasMultipleTables}
                onSwitcherPress={() => setShowTablePicker(true)}
                palette={palette}
            />

            {/* Activity | Wishlist segmented control */}
            <View style={styles.segmentedControl}>
                {(['activity', 'wishlist'] as const).map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                        <Pressable
                            key={tab}
                            onPress={() => setActiveTab(tab)}
                            style={[
                                styles.segmentButton,
                                isActive && { backgroundColor: palette.primary },
                            ]}
                        >
                            <Text
                                style={[
                                    Type.label,
                                    {
                                        color: isActive ? '#fff' : palette.textSecondary,
                                        fontSize: 10,
                                    },
                                ]}
                            >
                                {tab === 'activity' ? 'Activity' : 'Wishlist'}
                            </Text>
                            {activeRounds.map((item) => (
                                <TableNightCard
                                    key={`active-${item.id}`}
                                    item={item}
                                    palette={palette}
                                    tableId={activeTable?.id}
                                    lastSeenAt={lastSeenAt ?? null}
                                />
                            ))}
                        </View>
                    )}

                    {/* Date-grouped timeline */}
                    {feedSections.length > 0
                        ? feedSections.map((section) => (
                              <View
                                  key={section.label}
                                  style={{ marginBottom: Spacing.md }}
                              >
                                  <DateSectionHeader
                                      title={section.label}
                                      palette={palette}
                                  />
                                  <View style={styles.feedList}>
                                      {section.items.map((item) => {
                                          if (item.type === 'table_night') {
                                              return (
                                                  <TableNightCard
                                                      key={`tn-${item.id}`}
                                                      item={item}
                                                      palette={palette}
                                                      tableId={activeTable?.id}
                                                      lastSeenAt={lastSeenAt ?? null}
                                                  />
                                              );
                                          }
                                          const solo = item as SoloShareActivity;
                                          if (solo.rating == null) {
                                              return (
                                                  <JournalNoteCard
                                                      key={`note-${item.id}`}
                                                      item={solo}
                                                      palette={palette}
                                                      tableId={activeTable?.id}
                                                      lastSeenAt={lastSeenAt ?? null}
                                                  />
                                              );
                                          }
                                          return (
                                              <SoloShareCard
                                                  key={`solo-${item.id}`}
                                                  item={solo}
                                                  palette={palette}
                                                  tableId={activeTable?.id}
                                                  lastSeenAt={lastSeenAt ?? null}
                                              />
                                          );
                                      })}
                                  </View>
                              </View>
                          ))
                        : activeFilter && (
                              <View
                                  style={{
                                      padding: Spacing.xl,
                                      alignItems: 'center',
                                      marginTop: Spacing.lg,
                                  }}
                              >
                                  <Text
                                      style={[
                                          Type.body,
                                          {
                                              color: palette.textMuted,
                                              textAlign: 'center',
                                          },
                                      ]}
                                  >
                                      No entries match this filter.
                                  </Text>
                              </View>
                          )}
                </View>
            )}
        </ScrollView>
            )}

                    {/* Feed */}
                    {feedLoading ? (
                        <ActivityIndicator
                            color={palette.primary}
                            style={{ marginTop: Spacing.xxl }}
                        />
                    ) : isFoundedEmpty ? (
                        /* Brand-new non-personal table — founding moment */
                        <FoundedHero
                            tableName={tableName}
                            foundedAt={activeTable.created_at}
                            palette={palette}
                        />
                    ) : isEmpty && !isSoloOnly ? (
                        /* Empty personal table (or named table after filtering) */
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
                                Nothing here yet
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
                                Log a meal or start a Table Night to get the conversation going.
                            </Text>
                        </View>
                    ) : (
                        <View style={{ paddingTop: Spacing.sm }}>
                            {/* Active rounds shelf */}
                            {activeRounds.length > 0 && (
                                <View
                                    style={{
                                        paddingHorizontal: Spacing.lg,
                                        gap: Spacing.md,
                                        marginBottom: Spacing.lg,
                                    }}
                                >
                                    <Text
                                        style={[
                                            Type.label,
                                            { color: palette.textMuted },
                                        ]}
                                    >
                                        IN PROGRESS
                                    </Text>
                                    {activeRounds.map((item) => (
                                        <TableNightCard
                                            key={`active-${item.id}`}
                                            item={item}
                                            palette={palette}
                                            tableId={activeTable?.id}
                                            lastSeenAt={lastSeenAt ?? null}
                                        />
                                    ))}
                                </View>
                            )}

                            {/* Date-grouped timeline */}
                            {feedSections.length > 0
                                ? feedSections.map((section) => (
                                      <View
                                          key={section.label}
                                          style={{ marginBottom: Spacing.md }}
                                      >
                                          <DateSectionHeader
                                              title={section.label}
                                              palette={palette}
                                          />
                                          <View style={styles.feedList}>
                                              {section.items.map((item) => {
                                                  if (item.type === 'table_night') {
                                                      return (
                                                          <TableNightCard
                                                              key={`tn-${item.id}`}
                                                              item={item}
                                                              palette={palette}
                                                              tableId={activeTable?.id}
                                                              lastSeenAt={lastSeenAt ?? null}
                                                          />
                                                      );
                                                  }
                                                  const solo = item as SoloShareActivity;
                                                  if (solo.rating == null) {
                                                      return (
                                                          <JournalNoteCard
                                                              key={`note-${item.id}`}
                                                              item={solo}
                                                              palette={palette}
                                                              tableId={activeTable?.id}
                                                              lastSeenAt={lastSeenAt ?? null}
                                                          />
                                                      );
                                                  }
                                                  return (
                                                      <SoloShareCard
                                                          key={`solo-${item.id}`}
                                                          item={solo}
                                                          palette={palette}
                                                          tableId={activeTable?.id}
                                                          lastSeenAt={lastSeenAt ?? null}
                                                      />
                                                  );
                                              })}
                                          </View>
                                      </View>
                                  ))
                                : activeFilter && (
                                      <View
                                          style={{
                                              padding: Spacing.xl,
                                              alignItems: 'center',
                                              marginTop: Spacing.lg,
                                          }}
                                      >
                                          <Text
                                              style={[
                                                  Type.body,
                                                  {
                                                      color: palette.textMuted,
                                                      textAlign: 'center',
                                                  },
                                              ]}
                                          >
                                              No entries match this filter.
                                          </Text>
                                      </View>
                                  )}
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Table switcher — bottom sheet replacing old top-dropdown Modal */}
            <TableSwitcherSheet
                tables={tables ?? []}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                visible={showTablePicker}
                onClose={() => setShowTablePicker(false)}
                palette={palette}
                liveRoundTableIds={liveRoundTableIds}
                onGatherNew={() => {
                    setShowTablePicker(false);
                    Alert.alert(
                        'Coming soon',
                        'Gathering a table will be available in a future update.',
                    );
                }}
            />
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
    feedList: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        gap: Spacing.xl + Spacing.md,
    },
    segmentedControl: {
        flexDirection: 'row',
        marginHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.06)',
        padding: 3,
        gap: 2,
    },
    segmentButton: {
        flex: 1,
        paddingVertical: 6,
        borderRadius: 17,
        alignItems: 'center',
    },
});
