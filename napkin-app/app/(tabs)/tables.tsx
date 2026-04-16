/**
 * Tables tab — activity feed for the active table.
 * Real data via useTables + useTableActivity hooks.
 * Features: table switcher, PulseDot on live banner, Table Night cards, solo share rows.
 */

import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Pressable,
    ActivityIndicator,
    Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
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

type Palette = typeof Colors.light;

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
    const activeTable = tables?.[selectedIndex]?.tables ?? tables?.[0]?.tables;
    const hasMultipleTables = (tables?.length ?? 0) > 1;
    const [showTablePicker, setShowTablePicker] = useState(false);

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

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
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

            {/* Filter chips */}
            {items.length > 0 && (
                <FilterChipRow
                    chips={filterChips}
                    activeKey={activeFilter}
                    onSelect={setActiveFilter}
                    palette={palette}
                />
            )}

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
                                                  />
                                              );
                                          }
                                          return (
                                              <SoloShareCard
                                                  key={`solo-${item.id}`}
                                                  item={solo}
                                                  palette={palette}
                                                  tableId={activeTable?.id}
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

            {/* Table picker dropdown */}
            <Modal
                visible={showTablePicker}
                transparent
                animationType="fade"
                onRequestClose={() => setShowTablePicker(false)}
            >
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-start' }}
                    onPress={() => setShowTablePicker(false)}
                >
                    <View
                        style={{
                            marginTop: insets.top + 60,
                            marginHorizontal: Spacing.lg,
                            backgroundColor: palette.surfaceContainerLow,
                            borderRadius: 16,
                            paddingVertical: Spacing.sm,
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.15,
                            shadowRadius: 12,
                            elevation: 8,
                        }}
                    >
                        {tables?.map((t, i) => {
                            const tbl = t.tables;
                            if (!tbl) return null;
                            const isActive = i === selectedIndex;
                            return (
                                <Pressable
                                    key={tbl.id}
                                    onPress={() => {
                                        setSelectedIndex(i);
                                        setShowTablePicker(false);
                                    }}
                                    style={({ pressed }) => ({
                                        paddingHorizontal: Spacing.lg,
                                        paddingVertical: Spacing.md,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        backgroundColor: isActive ? palette.primaryMuted : 'transparent',
                                        opacity: pressed ? 0.7 : 1,
                                    })}
                                >
                                    <View>
                                        <Text
                                            style={[
                                                Type.titleSmall,
                                                {
                                                    color: isActive ? palette.primary : palette.text,
                                                    fontFamily: 'Newsreader_400Regular_Italic',
                                                    fontSize: 18,
                                                },
                                            ]}
                                        >
                                            {tbl.name}
                                        </Text>
                                        {tbl.is_personal && (
                                            <Text style={[Type.caption, { color: palette.textMuted }]}>
                                                Personal journal
                                            </Text>
                                        )}
                                    </View>
                                    {isActive && (
                                        <Text style={{ color: palette.primary, fontSize: 16 }}>✓</Text>
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>
                </Pressable>
            </Modal>
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
    feedList: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        gap: Spacing.xl + Spacing.md,
    },
});
