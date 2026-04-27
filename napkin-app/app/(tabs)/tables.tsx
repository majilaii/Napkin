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
import { AtlasCityIndex } from '@/components/atlas';
import { useTableAtlas } from '@/hooks/tables/useTableAtlas';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useLastSeenAt, useMarkSeen } from '@/hooks/tables/useLastSeenAt';
import {
    useTableActivity,
    flattenActivity,
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
} from '@/hooks/tables/useTableActivity';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { TableNightCard } from '@/components/feed/TableNightCard';
import { SoloShareCard } from '@/components/feed/SoloShareCard';
import { DateSectionHeader } from '@/components/feed/DateSectionHeader';
import { useRouter } from 'expo-router';
import {
    TableHeader,
    EmptyChairInvitation,
    FoundedHero,
    TableSwitcherSheet,
    ActiveGatherBanner,
    SubsetCard,
    TickRow,
    WelcomeBanner,
} from '@/components/tables';
import { useTableDetail } from '@/hooks/tables/useTableDetail';

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
    const router = useRouter();
    const { user } = useAuth();

    // Real data
    const { data: tables, isLoading: tablesLoading } = useTables(user?.id);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<'activity' | 'wishlist' | 'atlas'>('activity');
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

    const {
        data: activityData,
        isLoading: feedLoading,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id);

    const items: ActivityItem[] = useMemo(
        () => flattenActivity(activityData),
        [activityData],
    );

    // Table detail — includes caller_welcomed_at for the welcome banner (TICKET-029)
    const { data: tableDetail } = useTableDetail(activeTable?.id);

    // Atlas data — only fetched when the active table is a social table
    // is_personal is a runtime DB field not reflected in the Table type
    const isSocialTable = activeTable && !(activeTable as any).is_personal;
    const {
        data: atlasData,
        isLoading: atlasLoading,
        isRefetching: atlasRefetching,
        refetch: atlasRefetch,
    } = useTableAtlas(isSocialTable ? activeTable?.id : null);

    // Welcome banner: show when caller_welcomed_at IS NULL and role !== 'admin'
    const showWelcomeBanner =
        !(activeTable as any)?.is_personal &&
        tableDetail?.caller_welcomed_at === null &&
        tableDetail?.caller_role !== 'admin' &&
        tableDetail?.caller_role != null;

    // Find the owner's display name to use in banner copy
    const ownerMember = tableDetail?.members?.find((m) => m.role === 'admin');
    const ownerName = ownerMember?.profiles?.display_name ?? null;

    // ── Grouping logic ─────────────────────────────────────────────────
    const { data: members } = useTableMembers(activeTable?.id);

    const activeRounds = useMemo(
        () =>
            items.filter(
                (i) =>
                    i.type === 'table_night' &&
                    (i as TableNightActivity).status === 'rating',
            ) as TableNightActivity[],
        [items],
    );

    const totalRoundCount = useMemo(
        () => items.filter((i) => i.type === 'table_night').length,
        [items],
    );

    const timelineItems = useMemo(
        () =>
            items.filter(
                (i) =>
                    !(
                        i.type === 'table_night' &&
                        (i as TableNightActivity).status === 'rating'
                    ),
            ),
        [items],
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

    // Brand-new table with no entries yet
    const isFoundedEmpty = isEmpty && !feedLoading;

    const handleSettingsPress = () => {
        if (activeTable?.id) {
            router.push({ pathname: '/table/[id]/settings', params: { id: activeTable.id } });
        }
    };

    // Shared header + segmented control (rendered above both tabs)
    const headerAndControl = (
        <>
            {/* TableHeader masthead — replaces old inline header block */}
            <TableHeader
                tableName={tableName}
                memberCount={members?.length ?? 0}
                roundCount={totalRoundCount}
                memberNames={memberNames}
                hasMultipleTables={hasMultipleTables}
                onSwitcherPress={() => setShowTablePicker(true)}
                palette={palette}
                onSettingsPress={!(activeTable as any).is_personal ? handleSettingsPress : undefined}
            />

            {/* Welcome banner — shown once when a user is added to a table (TICKET-029) */}
            {showWelcomeBanner && activeTable?.id && (
                <WelcomeBanner
                    tableId={activeTable.id}
                    tableName={tableName}
                    adderName={ownerName}
                    palette={palette}
                />
            )}

            {/* Activity | Wishlist | Atlas — editorial section-label style */}
            <View style={styles.tabRow}>
                {(['activity', 'wishlist', ...(isSocialTable ? ['atlas'] : [])] as ('activity' | 'wishlist' | 'atlas')[]).map((tab) => {
                    const isActive = activeTab === tab;
                    const tabLabel =
                        tab === 'activity'
                            ? 'Activity'
                            : tab === 'wishlist'
                            ? 'Wishlist'
                            : 'Atlas';
                    return (
                        <Pressable
                            key={tab}
                            onPress={() => setActiveTab(tab)}
                            style={styles.tabButton}
                        >
                            <Text
                                style={[
                                    styles.tabLabel,
                                    {
                                        color: isActive
                                            ? palette.text
                                            : palette.textMuted,
                                    },
                                ]}
                            >
                                {tabLabel}
                            </Text>
                            <View
                                style={[
                                    styles.tabUnderline,
                                    {
                                        backgroundColor: isActive
                                            ? palette.primary
                                            : 'transparent',
                                    },
                                ]}
                            />
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
            ) : activeTab === 'atlas' ? (
                /* Atlas tab — AtlasCityIndex owns its own ScrollView */
                <View style={{ flex: 1, paddingTop: insets.top + Spacing.sm }}>
                    {headerAndControl}
                    {atlasLoading && !atlasData ? (
                        <ActivityIndicator
                            color={palette.primary}
                            style={{ marginTop: Spacing.xxl }}
                        />
                    ) : atlasData ? (
                        <AtlasCityIndex
                            data={atlasData}
                            onCityPress={(cityName) => {
                                if (activeTable?.id) {
                                    router.push({
                                        pathname: '/table/[id]/atlas/[city]',
                                        params: {
                                            id: activeTable.id,
                                            city: cityName,
                                        },
                                    });
                                }
                            }}
                            onRefresh={atlasRefetch}
                            isRefreshing={atlasRefetching}
                            palette={palette}
                        />
                    ) : null}
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

                    {/* Empty-chair invitation — users with a single table, dismissable */}
                    {(tables?.length ?? 0) <= 1 && !invitationDismissed && (
                        <EmptyChairInvitation
                            palette={palette}
                            onGatherPress={() =>
                                router.push({
                                    pathname: '/seed-from-solo',
                                    params: { tableName: 'Your new table' },
                                })
                            }
                            onDismiss={() => setInvitationDismissed(true)}
                        />
                    )}

                    {/* Feed */}
                    {feedLoading ? (
                        <ActivityIndicator
                            color={palette.primary}
                            style={{ marginTop: Spacing.xxl }}
                        />
                    ) : isFoundedEmpty ? (
                        /* Brand-new table — founding moment */
                        <FoundedHero
                            tableName={tableName}
                            foundedAt={activeTable.created_at}
                            palette={palette}
                            memberCount={members?.length ?? 0}
                            onInvite={() =>
                                Alert.alert(
                                    'Coming soon',
                                    'Inviting members will be available in a future update.',
                                )
                            }
                        />
                    ) : isEmpty ? (
                        /* Empty table after filtering */
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
                            {/* Active Gather banner — voting on where to eat next */}
                            {activeRounds.length > 0 &&
                                activeRounds.slice(0, 1).map((gatherItem) => {
                                    const totalMembers = members?.length ?? 0;
                                    const votedCount =
                                        gatherItem.participants?.filter(
                                            (p) => p.rating != null,
                                        ).length ?? 0;
                                    const when = new Date(
                                        gatherItem.sort_date || gatherItem.created_at,
                                    ).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                    });
                                    const leader =
                                        gatherItem.restaurants?.name ?? 'In progress';
                                    return (
                                        <ActiveGatherBanner
                                            key={`gather-${gatherItem.id}`}
                                            when={`${when} \u00B7 live`}
                                            leaderBy={`${
                                                gatherItem.participants?.[0]?.profiles
                                                    ?.display_name ?? 'Someone'
                                            } leads`}
                                            votedCount={votedCount}
                                            totalCount={Math.max(
                                                totalMembers,
                                                gatherItem.participants?.length ?? 0,
                                            )}
                                            candidates={[
                                                {
                                                    name: leader,
                                                    pct: 58,
                                                    leading: true,
                                                },
                                                { name: 'Nearby pin', pct: 32 },
                                                { name: 'Wishlist', pct: 10 },
                                            ]}
                                            onCastVote={() =>
                                                router.push({
                                                    pathname: '/table-night',
                                                    params: { nightId: gatherItem.id },
                                                })
                                            }
                                            palette={palette}
                                        />
                                    );
                                })}

                            {/* Anniversary tick — fires only within a 2-week
                                window around the table's actual anniversary.
                                This is the ONLY entry to Looking Back; we do
                                not surface it daily on the hero. */}
                            {(() => {
                                if (
                                    !activeTable?.created_at
                                ) {
                                    return null;
                                }
                                const founded = new Date(activeTable.created_at);
                                const now = new Date();
                                const years =
                                    now.getFullYear() - founded.getFullYear();
                                if (years < 1) return null;
                                const anniversaryThisYear = new Date(
                                    now.getFullYear(),
                                    founded.getMonth(),
                                    founded.getDate(),
                                );
                                const daysFromAnniversary =
                                    Math.abs(
                                        now.getTime() -
                                            anniversaryThisYear.getTime(),
                                    ) / 86_400_000;
                                if (daysFromAnniversary > 14) return null;
                                return (
                                    <TickRow
                                        kind="anniversary"
                                        what={`${years} year${
                                            years === 1 ? '' : 's'
                                        } at the table — `}
                                        who="Looking back"
                                        when={founded.toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                        palette={palette}
                                        onPress={() =>
                                            router.push({
                                                pathname: '/looking-back',
                                                params: { tableId: activeTable.id },
                                            })
                                        }
                                    />
                                );
                            })()}

                            {/* Date-grouped timeline */}
                            {feedSections.map((section) => (
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
                                                      const tn = item as TableNightActivity;
                                                      const participantCount =
                                                          tn.participants?.length ?? 0;
                                                      const totalMembers =
                                                          members?.length ?? 0;
                                                      const isSubset =
                                                          totalMembers > 1 &&
                                                          participantCount > 0 &&
                                                          participantCount < totalMembers;
                                                      if (isSubset) {
                                                          const presentIds = new Set(
                                                              tn.participants.map(
                                                                  (p) => p.user_id,
                                                              ),
                                                          );
                                                          const present =
                                                              tn.participants.map(
                                                                  (p) =>
                                                                      p.profiles
                                                                          ?.display_name ??
                                                                      '?',
                                                              );
                                                          const missing =
                                                              (members ?? [])
                                                                  .filter(
                                                                      (m) =>
                                                                          !presentIds.has(
                                                                              m.member_id,
                                                                          ),
                                                                  )
                                                                  .map(
                                                                      (m) =>
                                                                          m.profiles
                                                                              ?.display_name ??
                                                                          '?',
                                                                  );
                                                          const d = new Date(
                                                              tn.revealed_at ??
                                                                  tn.created_at,
                                                          ).toLocaleDateString(
                                                              'en-GB',
                                                              {
                                                                  weekday: 'short',
                                                                  day: '2-digit',
                                                                  month: 'short',
                                                              },
                                                          );
                                                          return (
                                                              <View
                                                                  key={`subset-${tn.id}`}
                                                                  style={{
                                                                      marginBottom: 14,
                                                                  }}
                                                              >
                                                                  <SubsetCard
                                                                      id={tn.id}
                                                                      photoUrl={
                                                                          tn.restaurants
                                                                              ?.photo_url ??
                                                                          null
                                                                      }
                                                                      restaurantName={
                                                                          tn.restaurants
                                                                              ?.name ??
                                                                          'Unknown'
                                                                      }
                                                                      subLabel={
                                                                          tn.restaurants
                                                                              ?.city ??
                                                                          undefined
                                                                      }
                                                                      date={d}
                                                                      present={present}
                                                                      missing={missing}
                                                                      averageRating={
                                                                          tn.average_rating
                                                                      }
                                                                      palette={palette}
                                                                  />
                                                              </View>
                                                          );
                                                      }
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
                                  ))}
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
                    router.push({
                        pathname: '/seed-from-solo',
                        params: { tableName: 'Your new table' },
                    });
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
        paddingHorizontal: 20,
        paddingTop: Spacing.sm,
        gap: 20,
    },
    tabRow: {
        flexDirection: 'row',
        gap: Spacing.lg,
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xs,
        alignItems: 'center',
    },
    tabButton: {
        alignItems: 'flex-start',
    },
    tabLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        paddingVertical: 4,
    },
    tabUnderline: {
        height: 2,
        alignSelf: 'stretch',
        marginTop: 2,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        paddingTop: 14,
        paddingBottom: 8,
    },
});
