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

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Pressable,
    ActivityIndicator,
    Alert,
    Share,
} from 'react-native';
import { WishlistGrid } from '@/components/wishlist';
import { AtlasCityIndex } from '@/components/atlas';
import { useTableAtlas } from '@/hooks/tables/useTableAtlas';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { FRIEND_TEST } from '@/constants/flags';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { track } from '@/lib/track';
import { useTables } from '@/hooks/tables/useTables';
import { useUnreadCount } from '@/hooks/notifications';
import { useCreateInvite } from '@/hooks/tables/useCreateInvite';
import { useLastSeenAt, useMarkSeen } from '@/hooks/tables/useLastSeenAt';
import {
    useTableActivity,
    flattenActivity,
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
    type TopFourEditedActivity,
    type SharedSaveActivityItem,
    type ShareDigestActivityItem,
    type RestaurantFloatActivityItem,
    type SupperCardActivity,
    type GatheringCardActivity,
    type ListAddActivityItem,
} from '@/hooks/tables/useTableActivity';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { TableNightCard } from '@/components/feed/TableNightCard';
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
    TableTopFourGrid,
    TableTopFourPlaceholder,
    EditTop4Sheet,
    StartRoundPill,
    AddMemberSheet,
    TableListsBlock,
} from '@/components/tables';
import { Top4EditedCard } from '@/components/tables/Top4EditedCard';
import { useTableDetail } from '@/hooks/tables/useTableDetail';
import { useTableTopFour } from '@/hooks/tables/useTableTopFour';
// TICKET-060: new feed cards
import { SharedSaveCard } from '@/components/feed/SharedSaveCard';
import { ShareDigestCard } from '@/components/feed/ShareDigestCard';
import { RestaurantFloatCard } from '@/components/feed/RestaurantFloatCard';
// TICKET-069: canvas-faithful table entry card
import { TableEntryCard } from '@/components/journal';
// TICKET-082 v2: the empty-table supper card + in-app nudge
import { SupperCard, SupperNudgeBanner } from '@/components/suppers';
// TICKET-095: the gather-the-table proposal card
// TICKET-128: the "what's booked" upcoming strip under the masthead
import { GatheringCard, UpcomingStrip } from '@/components/gatherings';
// TICKET-115: quiet ledger line for table-list adds
import { ListAddLedgerLine } from '@/components/feed/ListAddLedgerLine';
// TICKET-121: murmur + retry when a primary query fails with no cached data
import { ErrorState } from '@/components/ErrorState';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format a date string as a relative time label for card timestamps. */
function formatRelTime(dateStr: string): string {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
    if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d`;
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
}

/** Format visited_at as "neighborhood · weekday" for tick meta line. */
function fmtTickMeta(city: string | null | undefined, visitedAt: string): string {
    const day = new Date(visitedAt).toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return [city, day].filter(Boolean).join(' · ');
}

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

// TICKET-044: receipt whisper for merged rounds.
// Participant copy: "you and Clara's entries became a round." (when viewer is one of the two)
// Non-participant copy: "Thomas and Clara's entries became a round."
function buildMergedReceiptWhisper(item: TableNightActivity, viewerUserId: string | undefined): string | null {
    const participants = item.participants ?? [];
    if (participants.length < 2) return null;
    const [p1, p2] = participants;
    const viewerIsP1 = !!viewerUserId && p1.user_id === viewerUserId;
    const viewerIsP2 = !!viewerUserId && p2.user_id === viewerUserId;
    const name1 = p1.display_name ?? p1.profiles?.display_name ?? 'someone';
    const name2 = p2.display_name ?? p2.profiles?.display_name ?? 'someone';
    if (viewerIsP1) return `you and ${name2}'s entries became a round.`;
    if (viewerIsP2) return `you and ${name1}'s entries became a round.`;
    return `${name1} and ${name2}'s entries became a round.`;
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TablesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const hasUnread = useUnreadCount(user?.id) > 0;

    // Real data
    const {
        data: tables,
        isLoading: tablesLoading,
        isError: tablesError,
        refetch: tablesRefetch,
    } = useTables(user?.id);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<'activity' | 'wishlist' | 'lists' | 'atlas'>('activity');

    // Deep-link: notifications screen passes `selected` (tableId) when tapping a
    // table_invite row. Auto-select the matching table on mount/focus.
    const { selected: selectedTableId } = useLocalSearchParams<{ selected?: string }>();
    useEffect(() => {
        if (!selectedTableId || !tables) return;
        const idx = tables.findIndex((t) => t.tables?.id === selectedTableId);
        if (idx !== -1) setSelectedIndex(idx);
    }, [selectedTableId, tables]);
    const activeTable = tables?.[selectedIndex]?.tables ?? tables?.[0]?.tables;
    const [showTablePicker, setShowTablePicker] = useState(false);
    const [showAddMember, setShowAddMember] = useState(false);
    const [invitationDismissed, setInvitationDismissed] = useState(false);

    // Unseen dot system (TICKET-010)
    const { data: lastSeenAt } = useLastSeenAt(activeTable?.id, user?.id);
    const markSeen = useMarkSeen();
    const createInvite = useCreateInvite();

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
        isError: feedError,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id);

    const items: ActivityItem[] = useMemo(
        () => flattenActivity(activityData),
        [activityData],
    );

    // Supper v2: the in-app nudge. Surface ONE gentle banner when the viewer has a
    // pending seat in a supper (a supper card with viewer_filled === false). Dismissible
    // per-supper for the session. Derived from the feed — no extra backend.
    const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
    const pendingSupper = useMemo(() => {
        if (FRIEND_TEST.hideSuppers) return null;
        return (
            (items.find(
                (i) => i.type === 'supper' && !i.viewer_filled && !dismissedNudges.has(i.id),
            ) as SupperCardActivity | undefined) ?? null
        );
    }, [items, dismissedNudges]);

    // Table detail — includes caller_welcomed_at for the welcome banner (TICKET-029)
    const { data: tableDetail } = useTableDetail(activeTable?.id);

    // Top 4 state
    const [editTopFourOpen, setEditTopFourOpen] = useState(false);
    const [editTopFourFocusPos, setEditTopFourFocusPos] = useState<1 | 2 | 3 | 4>(1);
    const { data: topFourData } = useTableTopFour(activeTable?.id ?? null);

    const handleOpenEditTopFour = (position?: 1 | 2 | 3 | 4) => {
        setEditTopFourFocusPos(position ?? 1);
        setEditTopFourOpen(true);
    };

    // Atlas data — only fetched when the active table is a social table
    // is_personal is a runtime DB field not reflected in the Table type
    const isSocialTable = activeTable && !(activeTable as any).is_personal;

    // Lists/Atlas segments only exist on social tables — clamp back to
    // Activity when the active table can't show the current segment, so the
    // tab row never renders with no segment underlined.
    useEffect(() => {
        if (!isSocialTable && (activeTab === 'lists' || activeTab === 'atlas')) {
            setActiveTab('activity');
        }
    }, [isSocialTable, activeTab]);
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
                    ) &&
                    // Supper v2 kill-switch: drop supper cards from the DATA (not just the
                    // leaf render) so a date whose only item is a supper never forms an
                    // empty/orphan DateSectionHeader when the curtain is on.
                    !(i.type === 'supper' && FRIEND_TEST.hideSuppers) &&
                    // TICKET-095: gatherings terminate in a supper — same curtain,
                    // same orphan-header rationale.
                    !(i.type === 'gathering' && FRIEND_TEST.hideSuppers),
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
        if (tablesError && !tables) {
            return (
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ErrorState onRetry={tablesRefetch} />
                </View>
            );
        }
        // Launch-readiness (2026-07-03): this was a dead end — copy with no
        // affordance, and every create-table entry point unreachable at zero
        // tables. One quiet CTA; solo stays a complete product (emergence arc).
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <Text style={[Type.displaySmall, { color: palette.text }]}>
                    No table yet
                </Text>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 15,
                        lineHeight: 22,
                        color: palette.textSecondary,
                        marginTop: Spacing.sm,
                        textAlign: 'center',
                    }}
                >
                    {"— when your crew's ready, gather one."}
                </Text>
                <Pressable
                    onPress={() => router.push('/create-table')}
                    style={({ pressed }) => ({
                        borderWidth: 1.5,
                        borderColor: 'rgba(160,63,40,0.35)',
                        borderRadius: 9999,
                        paddingVertical: 10,
                        paddingHorizontal: 22,
                        marginTop: Spacing.lg,
                        opacity: pressed ? 0.7 : 1,
                    })}
                    accessibilityRole="button"
                >
                    <Text style={{ fontFamily: 'Manrope_700Bold', fontSize: 13, color: palette.primary }}>
                        gather your table
                    </Text>
                </Pressable>
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

    const handleStartRound = () => {
        if (activeTable?.id) {
            router.push({
                pathname: '/create-entry',
                params: { mode: 'round', tableId: activeTable.id },
            });
        }
    };

    // Show the "start a round" pill only when:
    //   - there is an active social table (not personal)
    //   - the table has ≥2 members
    //   - no Round is currently in progress (ActiveGatherBanner covers that state)
    //   - the Activity tab is active (pill is masthead chrome for the activity surface only)
    const showStartRoundPill =
        !!activeTable &&
        !(activeTable as any).is_personal &&
        (members?.length ?? 0) >= 2 &&
        activeRounds.length === 0 &&
        activeTab === 'activity';

    // Shared header + segmented control (rendered above both tabs)
    const headerAndControl = (
        <>
            {/* TableHeader masthead — replaces old inline header block */}
            <TableHeader
                tableName={tableName}
                memberCount={members?.length ?? 0}
                roundCount={totalRoundCount}
                memberNames={memberNames}
                onSwitcherPress={() => setShowTablePicker(true)}
                palette={palette}
                onSettingsPress={!(activeTable as any).is_personal ? handleSettingsPress : undefined}
                // Designated + — the invite path no longer hides behind the gear
                // (founder, 2026-07-03). Owner-only: add_member is owner-gated
                // server-side; showing it to members would be a dead button.
                onInvitePress={
                    activeTable.owner_id === user?.id
                        ? () => setShowAddMember(true)
                        : undefined
                }
                onBellPress={() => router.push('/notifications')}
                bellUnread={hasUnread}
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

            {/* Start a round pill — visible on Activity tab for social tables with ≥2 members
                and no active Round in progress. Mutually exclusive with ActiveGatherBanner. */}
            {!FRIEND_TEST.hideRounds && showStartRoundPill && activeTable && (
                <StartRoundPill
                    palette={palette}
                    onPress={handleStartRound}
                    accessibilityLabel={`Start a round at ${tableName}`}
                />
            )}

            {/* Activity | Wishlist | Lists | Atlas — editorial section-label style.
                Atlas hidden during friend-test. */}
            <View style={styles.tabRow}>
                {(['activity', 'wishlist', ...(isSocialTable ? ['lists'] : []), ...(!FRIEND_TEST.hideAtlas && isSocialTable ? ['atlas'] : [])] as ('activity' | 'wishlist' | 'lists' | 'atlas')[]).map((tab) => {
                    const isActive = activeTab === tab;
                    const tabLabel =
                        tab === 'activity'
                            ? 'Activity'
                            : tab === 'wishlist'
                            ? 'Wishlist'
                            : tab === 'lists'
                            ? 'Lists'
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
            ) : activeTab === 'lists' && activeTable && isSocialTable ? (
                /* Lists tab — TICKET-115 shared Table lists. Social tables only;
                   switching to a personal table falls through to activity. */
                <View style={{ flex: 1, paddingTop: insets.top + Spacing.sm }}>
                    {headerAndControl}
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingTop: Spacing.sm, paddingBottom: 100 }}
                    >
                        <TableListsBlock
                            tableId={activeTable.id}
                            tableName={activeTable.name}
                            hideLabel
                        />
                    </ScrollView>
                </View>
            ) : !FRIEND_TEST.hideAtlas && activeTab === 'atlas' ? (
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

                    {/* TICKET-128: upcoming strip — what's booked/brewing for this
                        table, under the masthead. Renders null when there's nothing
                        upcoming. Social tables only (personal tables have no gatherings);
                        curtained alongside suppers during the friend test. */}
                    {!FRIEND_TEST.hideSuppers && isSocialTable && activeTable && (
                        <UpcomingStrip tableId={activeTable.id} tableName={activeTable.name} />
                    )}

                    {/* Empty-chair invitation — users with a single table, dismissable.
                        Curtained during friend-test as part of the emergence-arc nudge;
                        its CTA opens the /create-table flow. */}
                    {!FRIEND_TEST.hideEmergenceArc && (tables?.length ?? 0) <= 1 && !invitationDismissed && (
                        <EmptyChairInvitation
                            palette={palette}
                            onGatherPress={() => router.push('/create-table')}
                            onDismiss={() => setInvitationDismissed(true)}
                        />
                    )}

                    {/* Feed */}
                    {feedLoading ? (
                        <ActivityIndicator
                            color={palette.primary}
                            style={{ marginTop: Spacing.xxl }}
                        />
                    ) : feedError && items.length === 0 ? (
                        <ErrorState onRetry={refetch} />
                    ) : isFoundedEmpty ? (
                        /* Brand-new table — founding moment */
                        <FoundedHero
                            tableName={tableName}
                            foundedAt={activeTable.created_at}
                            palette={palette}
                            memberCount={members?.length ?? 0}
                            onInvite={async () => {
                                // One invite flow (2026-07-03): the AddMemberSheet
                                // sends PENDING invitations to mutuals (TICKET-133 —
                                // they seat themselves on accept) and carries the
                                // share-link row for friends not on Napkin yet.
                                // Founder = owner on a brand-new table; non-owner
                                // members mint + share the real join link (any
                                // member can mint).
                                if (activeTable.owner_id === user?.id) {
                                    setShowAddMember(true);
                                    return;
                                }
                                track('invite_sent', { surface: 'founded_hero' });
                                try {
                                    const { join_url } = await createInvite.mutateAsync(activeTable.id);
                                    await Share.share({
                                        message: TESTFLIGHT_INVITE_URL
                                            ? `join "${tableName}" on Napkin — ${join_url}\n\n${TESTFLIGHT_INVITE_URL}`
                                            : `join "${tableName}" on Napkin — ${join_url}`,
                                    });
                                } catch {
                                    void Share.share({
                                        message: TESTFLIGHT_INVITE_URL
                                            ? `come join "${tableName}" on Napkin — ${TESTFLIGHT_INVITE_URL}`
                                            : `come join "${tableName}" on Napkin`,
                                    });
                                }
                            }}
                            onEditTopFour={FRIEND_TEST.hideTopFours ? undefined : () => handleOpenEditTopFour()}
                        />
                    ) : isEmpty ? (
                        /* Empty table — canvas E·TABLE slab */
                        <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
                            <View
                                style={{
                                    backgroundColor: palette.surfaceJournalLow,
                                    borderRadius: 24,
                                    padding: 30,
                                    gap: 12,
                                    alignItems: 'flex-start',
                                }}
                            >
                                <Text style={{ fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase', color: palette.primary }}>
                                    The table
                                </Text>
                                <Text style={{ fontFamily: 'Newsreader_400Regular', fontSize: 23, lineHeight: 30, color: palette.text }}>
                                    A private table for those you trust.
                                </Text>
                                <Text style={{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15, lineHeight: 22, color: palette.textMuted }}>
                                    {'— quiet so far. what you log lands here.'}
                                </Text>
                                <Pressable
                                    onPress={() => router.push('/search')}
                                    style={({ pressed }) => ({
                                        borderWidth: 1.5,
                                        borderColor: 'rgba(160,63,40,0.35)',
                                        borderRadius: 9999,
                                        paddingVertical: 10,
                                        paddingHorizontal: 20,
                                        marginTop: 4,
                                        opacity: pressed ? 0.7 : 1,
                                    })}
                                >
                                    <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: palette.primary }}>
                                        Find a place
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : (
                        <View style={{ paddingTop: Spacing.sm }}>
                            {/* Active Gather banner — voting on where to eat next.
                                Hidden during friend-test (TICKET-069). */}
                            {!FRIEND_TEST.hideRounds && activeRounds.length > 0 &&
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
                                not surface it daily on the hero.
                                Hidden during friend-test. */}
                            {!FRIEND_TEST.hideEmergenceArc && (() => {
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

                            {/* Top 4 — shown when at least one slot is filled;
                                placeholder shown when empty (0/4) for social tables.
                                Hidden during friend-test. */}
                            {!FRIEND_TEST.hideTopFours && isSocialTable && (
                                topFourData && topFourData.slots.length > 0 ? (
                                    <TableTopFourGrid
                                        slots={topFourData.slots}
                                        lastEvent={topFourData.last_event}
                                        currentUserId={user?.id}
                                        onEdit={() => handleOpenEditTopFour()}
                                        onTapEmptySlot={(pos) => handleOpenEditTopFour(pos)}
                                        palette={palette}
                                    />
                                ) : (
                                    <TableTopFourPlaceholder
                                        palette={palette}
                                        onStart={() => handleOpenEditTopFour()}
                                    />
                                )
                            )}

                            {/* Supper v2 — in-app nudge: your turn at the table */}
                            {pendingSupper ? (() => {
                                const filledNames = pendingSupper.seats
                                    .filter((s) => s.filled)
                                    .map((s) => s.display_name)
                                    .filter(Boolean) as string[];
                                const othersLine =
                                    filledNames.length === 0
                                        ? null
                                        : filledNames.length === 1
                                          ? `${filledNames[0]} is in.`
                                          : filledNames.length === 2
                                            ? `${filledNames[0]} & ${filledNames[1]} are in.`
                                            : `${filledNames[0]}, ${filledNames[1]} & ${filledNames.length - 2} more are in.`;
                                return (
                                    <View style={styles.feedList}>
                                        <SupperNudgeBanner
                                            restaurantName={pendingSupper.restaurant?.name ?? 'a spot'}
                                            filledCount={pendingSupper.filled_count}
                                            seatCount={pendingSupper.seat_count}
                                            othersLine={othersLine}
                                            palette={palette}
                                            onDismiss={() =>
                                                setDismissedNudges((prev) => new Set(prev).add(pendingSupper.id))
                                            }
                                            onPress={() =>
                                                router.push({
                                                    pathname: '/log-meal',
                                                    params: {
                                                        supperTakeId: pendingSupper.id,
                                                        restaurant: JSON.stringify({
                                                            id: pendingSupper.restaurant?.id,
                                                            name: pendingSupper.restaurant?.name ?? 'Restaurant',
                                                        }),
                                                    },
                                                })
                                            }
                                        />
                                    </View>
                                );
                            })() : null}

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
                                                      // TICKET-069: round cards hidden during friend-test.
                                                      if (FRIEND_TEST.hideRounds) return null;
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
                                                              receiptWhisper={
                                                                  item.round_kind === 'merged'
                                                                      ? buildMergedReceiptWhisper(item, user?.id)
                                                                      : null
                                                              }
                                                          />
                                                      );
                                                  }
                                                  if (item.type === 'top_4_edited') {
                                                      return (
                                                          <Top4EditedCard
                                                              key={`tt4-${item.id}`}
                                                              item={item as TopFourEditedActivity}
                                                              palette={palette}
                                                              currentUserId={user?.id}
                                                          />
                                                      );
                                                  }
                                                  // TICKET-060: shared restaurant cards
                                                  // [H-6 FIX] Use typed ActivityItem variants — no more `as any`.
                                                  // The edge fn now returns camelCase SharedSaveCardProps-shaped
                                                  // children for digests (see table-activity hydration fix).
                                                  if (item.type === 'shared_save') {
                                                      const s = item as SharedSaveActivityItem;
                                                      return (
                                                          <SharedSaveCard
                                                              key={`share-${s.id}`}
                                                              shareId={(s as any).shareId ?? s.id}
                                                              tableId={s.table_id ?? activeTable?.id ?? ''}
                                                              author={s.author ?? { user_id: '', display_name: null, avatar_url: null }}
                                                              restaurant={s.restaurant}
                                                              note={(s as any).note}
                                                              extractionStatus={s.extraction_status}
                                                              reactionCount={s.reaction_count ?? 0}
                                                              commentCount={(s as any).comment_count ?? 0}
                                                              topEmojis={s.top_emojis ?? []}
                                                              myReactions={s.my_reactions ?? []}
                                                              createdAt={s.created_at ?? s.sort_date}
                                                              currentUserId={user?.id}
                                                          />
                                                      );
                                                  }
                                                  if (item.type === 'share_digest') {
                                                      const d = item as ShareDigestActivityItem;
                                                      return (
                                                          <ShareDigestCard
                                                              key={`digest-${d.id}`}
                                                              id={d.id}
                                                              tableId={d.table_id ?? activeTable?.id ?? ''}
                                                              author={d.author ?? { user_id: '', display_name: null, avatar_url: null }}
                                                              shareCount={d.share_count ?? 0}
                                                              childIds={d.child_ids ?? []}
                                                              childShares={d.childShares}
                                                              createdAt={d.sort_date}
                                                              currentUserId={user?.id}
                                                          />
                                                      );
                                                  }
                                                  if (item.type === 'restaurant_float') {
                                                      const f = item as RestaurantFloatActivityItem;
                                                      if (!f.restaurant) return null;
                                                      return (
                                                          <RestaurantFloatCard
                                                              key={`float-${f.id}`}
                                                              floatId={f.float_id ?? f.id}
                                                              tableId={f.table_id ?? activeTable?.id ?? ''}
                                                              restaurant={f.restaurant}
                                                              distinctCount={f.distinct_count ?? 0}
                                                              members={f.members ?? []}
                                                          />
                                                      );
                                                  }
                                                  // TICKET-082 v2: the empty-table supper card
                                                  if (item.type === 'supper') {
                                                      if (FRIEND_TEST.hideSuppers) return null;
                                                      const sup = item as SupperCardActivity;
                                                      return (
                                                          <SupperCard
                                                              key={`supper-${sup.id}`}
                                                              supper={sup}
                                                              viewerId={user?.id}
                                                              onOpen={() =>
                                                                  router.push({
                                                                      pathname: '/supper/[id]',
                                                                      params: { id: sup.id },
                                                                  })
                                                              }
                                                              onAddTake={() =>
                                                                  router.push({
                                                                      pathname: '/log-meal',
                                                                      params: {
                                                                          supperTakeId: sup.id,
                                                                          restaurant: JSON.stringify({
                                                                              id: sup.restaurant?.id,
                                                                              name: sup.restaurant?.name ?? 'Restaurant',
                                                                          }),
                                                                      },
                                                                  })
                                                              }
                                                          />
                                                      );
                                                  }
                                                  // TICKET-095: the gather-the-table proposal card. RSVP +
                                                  // host-cancel mutations live inside the card (RestaurantFloatCard
                                                  // precedent); it navigates to /restaurant and /supper itself.
                                                  if (item.type === 'gathering') {
                                                      if (FRIEND_TEST.hideSuppers) return null;
                                                      const g = item as GatheringCardActivity;
                                                      return (
                                                          <GatheringCard
                                                              key={`gathering-${g.id}`}
                                                              gathering={g}
                                                              viewerId={user?.id}
                                                          />
                                                      );
                                                  }
                                                  // TICKET-115: table-list add — a quiet ledger line, not a card.
                                                  if (item.type === 'list_add') {
                                                      const la = item as ListAddActivityItem;
                                                      return (
                                                          <ListAddLedgerLine
                                                              key={`listadd-${la.id}`}
                                                              item={la}
                                                              palette={palette}
                                                              currentUserId={user?.id}
                                                          />
                                                      );
                                                  }
                                                  // SoloShareActivity — canvas EntryCard with author attribution
                                                  const solo = item as SoloShareActivity;
                                                  const companions = (solo.companions ?? [])
                                                      .map((c) => c.display_name)
                                                      .filter(Boolean);
                                                  const dishMeta = [
                                                      solo.dish_description,
                                                      companions.length > 0
                                                          ? companions.length === 1
                                                              ? `with ${companions[0]}`
                                                              : `with ${companions[0]} & ${companions.length - 1} more`
                                                          : null,
                                                  ]
                                                      .filter(Boolean)
                                                      .join(' · ') || null;
                                                  return (
                                                      <TableEntryCard
                                                          key={`solo-${item.id}`}
                                                          authorName={solo.profiles?.display_name ?? null}
                                                          verb="tried"
                                                          restaurantName={solo.restaurants?.name ?? 'Unknown'}
                                                          relativeTime={formatRelTime(solo.sort_date ?? solo.created_at)}
                                                          rating={solo.rating}
                                                          liked={solo.liked}
                                                          metaLine={fmtTickMeta(solo.restaurants?.city, solo.visited_at ?? solo.created_at)}
                                                          photoUrl={solo.photo_url}
                                                          note={solo.content}
                                                          dishMeta={dishMeta}
                                                          reactionCount={solo.reaction_count}
                                                          commentCount={solo.comment_count}
                                                          supper={(solo as any).supper ?? null}
                                                          onPress={() => {
                                                              router.push({
                                                                  pathname: '/entry-detail',
                                                                  params: { entryId: solo.id },
                                                              });
                                                          }}
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

            {/* Edit Top 4 sheet — hidden during friend-test */}
            {!FRIEND_TEST.hideTopFours && activeTable && (
                <EditTop4Sheet
                    visible={editTopFourOpen}
                    onClose={() => setEditTopFourOpen(false)}
                    tableId={activeTable.id}
                    currentSlots={topFourData?.slots ?? []}
                    suggested={topFourData?.suggested ?? []}
                    initialFocusPosition={editTopFourFocusPos}
                    palette={palette}
                    userId={user?.id}
                />
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
                    // Deliberate create-table path — stays visible during the
                    // friend test (it is the ONLY creation entry point in the
                    // UI). Only unsolicited emergence NUDGES are curtained.
                    setShowTablePicker(false);
                    router.push('/create-table');
                }}
            />

            {/* Invite — the designated + on the masthead (owner only) */}
            {activeTable?.id ? (
                <AddMemberSheet
                    visible={showAddMember}
                    onClose={() => setShowAddMember(false)}
                    tableId={activeTable.id}
                    palette={palette}
                    userId={user?.id}
                    tableName={tableName}
                />
            ) : null}
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
