/**
 * Profile tab — Letterboxd-model personal profile.
 *
 * TICKET-070 Phase A rebuild:
 *   Header: Avatar (48px) · italic serif 26 display name · settings gear (top-right → /settings)
 *           kicker: "{N} meals · est. {month}"
 *   Top 4 row: components/profile/TopFour (auto-derived user top picks).
 *              FRIEND_TEST.hideTopFours is intentionally bypassed at THIS call-site only —
 *              the flag still gates top-fours everywhere else (tables grid, FoundedHero, etc).
 *   Diary: JournalList (shared with /journal route) fed by useMySoloEntries.
 *
 * ARCHITECT-REVIEW: The spec requests EditTop4Sheet alongside TopFour here.
 * EditTop4Sheet is table-scoped (takes tableId, edits a TABLE's curated top 4).
 * TopFour displays the USER's auto-derived top picks — different dataset.
 * Including EditTop4Sheet on a profile that shows auto-derived picks would be
 * confusing UX (display vs edit targeting different data).
 * Deferred until a user-level personal-top-4 edit flow is built.
 * Tracker: link to follow-up ticket.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    ActivityIndicator,
    RefreshControl,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMySoloEntries } from '@/hooks/entries';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from '@/components/feed/Avatar';
import { TopFour } from '@/components/profile/TopFour';
import { ProfileTopFourSheet } from '@/components/profile/ProfileTopFourSheet';
import { JournalList, getEstMonth } from '@/components/journal';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // Diary data (feeds JournalList)
    const {
        data: entries,
        isLoading: entriesLoading,
        isRefetching,
        refetch,
    } = useMySoloEntries(user?.id);

    // Profile data (display name, avatar, top 4)
    const { data: profileResult } = useUserProfile(user?.id);
    const profileData = profileResult?.data ?? null;

    const sortedEntries: SoloShareActivity[] = useMemo(() => {
        if (!entries) return [];
        return [...entries].sort(
            (a, b) =>
                new Date(b.visited_at ?? b.created_at).getTime() -
                new Date(a.visited_at ?? a.created_at).getTime(),
        );
    }, [entries]);

    // Server-side total, not the 50-capped diary page (review finding).
    const mealCount = profileData?.stats?.total_logs ?? sortedEntries.length;
    const estMonth = useMemo(() => getEstMonth(sortedEntries), [sortedEntries]);

    const displayName =
        profileData?.profile?.display_name ?? user?.email?.split('@')[0] ?? 'You';
    const avatarUrl = profileData?.profile?.avatar_url ?? null;
    // Memoized so the array reference is stable (avoids ListHeader re-mount on every render).
    const topFourPicks = useMemo(() => profileData?.top_four ?? [], [profileData]);
    const topFourEditPicks = useMemo(
        () => topFourPicks.map((p) => ({ restaurant_id: p.restaurant_id, name: p.name, photo_url: p.photo_url })),
        [topFourPicks],
    );
    const [editTopFourOpen, setEditTopFourOpen] = useState(false);
    const handleEditTopFour = useCallback(() => setEditTopFourOpen(true), []);

    const handleEntry = useCallback(
        (id: string) => {
            router.push({ pathname: '/entry-detail', params: { entryId: id } });
        },
        [router],
    );

    // ── Header (passed to JournalList as ListHeaderComponent) ────────────────

    const ListHeader = useMemo(
        () => (
            <View style={{ paddingTop: insets.top + Spacing.sm }}>
                {/* Profile hero */}
                <View style={styles.heroRow}>
                    {/* Gear icon top-right — settings now lives on profile */}
                    <View style={{ flex: 1 }} />
                    <Pressable
                        onPress={() => router.push('/settings')}
                        hitSlop={8}
                        style={styles.gearButton}
                        accessibilityLabel="Settings"
                    >
                        <Ionicons name="settings-outline" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>

                {/* Avatar + name row */}
                <View style={styles.identityRow}>
                    <Avatar
                        name={displayName}
                        url={avatarUrl}
                        size={48}
                        palette={palette}
                    />
                    <View style={styles.identityText}>
                        <Text style={[styles.displayName, { color: palette.text }]}>
                            {displayName}
                        </Text>
                        {mealCount > 0 && estMonth ? (
                            <Text style={[styles.kicker, { color: palette.textMuted }]}>
                                {`${mealCount} meal${mealCount !== 1 ? 's' : ''} · est. ${estMonth}`}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* Top 4 — ungated at this call-site only. Own profile → always
                    shown (empty plates + "edit" are the entry point to curate).
                    FRIEND_TEST.hideTopFours keeps gating top-fours elsewhere. */}
                <View style={styles.topFourWrap}>
                    <TopFour picks={topFourPicks} isOwner onEdit={handleEditTopFour} />
                </View>

                {/* Diary section divider */}
                <View style={styles.diaryDivider}>
                    <Text style={[styles.diaryLabel, { color: palette.textMuted }]}>
                        Journal
                    </Text>
                </View>
            </View>
        ),
        [
            insets.top,
            palette,
            displayName,
            avatarUrl,
            mealCount,
            estMonth,
            topFourPicks,
            handleEditTopFour,
            router,
        ],
    );

    if (entriesLoading) {
        return (
            <View style={[styles.root, { backgroundColor: palette.background }]}>
                {ListHeader}
                <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <JournalList
                entries={sortedEntries}
                onPressEntry={handleEntry}
                ListHeaderComponent={ListHeader}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={palette.primary}
                    />
                }
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            />
            <ProfileTopFourSheet
                visible={editTopFourOpen}
                onClose={() => setEditTopFourOpen(false)}
                userId={user?.id}
                currentPicks={topFourEditPicks}
            />
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    heroRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.xs,
    },
    gearButton: {
        padding: 4,
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    identityText: {
        flex: 1,
        gap: 4,
    },
    displayName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    topFourWrap: {
        marginBottom: Spacing.md,
    },
    diaryDivider: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: 4,
        borderTopWidth: 0,
    },
    diaryLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
});
