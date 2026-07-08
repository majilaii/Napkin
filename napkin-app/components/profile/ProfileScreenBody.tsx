/**
 * ProfileScreenBody — shared body between (tabs)/profile.tsx and u/[identifier].tsx.
 * TICKET-025, rebuilt for TICKET-092 (the Letterboxd/Beli revamp).
 *
 * One profile grammar for self AND public — the own tab no longer auto-expands
 * the journal; everything lives behind the index:
 *
 *   ProfileHeader (identity + ScoreBand stats strip)
 *   → TopFour (self: editable; public: read view)
 *   → TasteBand (top cuisines · cities · countries — Beli)
 *   → DiningMapPreview (been-pins → /dining-map — Beli)
 *   → RegularsRail
 *   → ProfileIndex (Journal · Spots · Reviews · Lists · Wishlist · Likes)
 *   → TablesInCommonSection
 *
 * Doctrine: Tables never public; logs surface publicly only with real review
 * content (server-gated); lists per-list privacy.
 */
import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import { useUserSpots, deriveTaste, deriveEpithetInput } from '@/hooks/users/useUserSpots';
import { epithetFor } from '@/lib/engraving';
import { useReportContent, useBlockUser, useUnblockUser } from '@/hooks/account';

import { ProfileHeader } from './ProfileHeader';
import { TopFour } from './TopFour';
import { ProfileTopFourSheet } from './ProfileTopFourSheet';
import { TasteBand } from './TasteBand';
import { DiningMapPreview } from './DiningMapPreview';
import { RegularsRail } from './RegularsRail';
import { ProfileIndex } from './ProfileIndex';
import { TablesInCommonSection } from './TablesInCommonSection';
import { NotFoundState } from './NotFoundState';
import type { IndexSection } from './ProfileIndex';

interface Props {
    identifier: string | null | undefined;
    /** True when mounted inside the (tabs) tab — adds extra bottom padding */
    inTab?: boolean;
}

export function ProfileScreenBody({ identifier, inTab = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { data: result, isLoading, error, refetch, isRefetching } = useUserProfile(identifier);

    const isNotFound = result?.isNotFound ?? false;
    const profileData = result?.data ?? null;

    const relationship = profileData?.viewer_target_relationship ?? 'none';
    const isSelf = profileData?.is_self ?? false;
    const hasPalateAccess =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    // Spots feed the taste band + map preview (server-gated same as regulars).
    const { data: spots, refetch: refetchSpots } = useUserSpots(
        hasPalateAccess ? profileData?.profile.user_id : null,
    );
    const taste = useMemo(() => deriveTaste(spots ?? []), [spots]);
    // TICKET-145: the Taste Relic epithet — derived from the SAME spots payload,
    // no server change. Null below the 10-meal floor (band renders as before).
    const epithet = useMemo(
        () => epithetFor(deriveEpithetInput(spots ?? [], taste.topCuisines[0] ?? null)),
        [spots, taste.topCuisines],
    );

    const [editTopFourOpen, setEditTopFourOpen] = useState(false);

    // ── Viewer safety actions (TICKET-090, guideline 1.2) ────────────────────
    const reportContent = useReportContent();
    const blockUser = useBlockUser();
    const unblockUser = useUnblockUser();

    const handleSafetyMenu = () => {
        if (!profileData) return;
        const targetId = profileData.profile.user_id;
        const name = profileData.profile.display_name ?? 'this person';
        const fileReport = (reason: string) => {
            reportContent.mutate(
                { targetType: 'profile', targetId, reason },
                {
                    onSuccess: () => Alert.alert('Reported', 'Thanks — we review reports within 24 hours.'),
                    onError: () => Alert.alert('Something went wrong', 'Try again in a moment.'),
                },
            );
        };
        Alert.alert(name, undefined, [
            {
                text: 'Report',
                style: 'destructive',
                onPress: () =>
                    Alert.alert('Report this profile', undefined, [
                        { text: 'Spam or misleading', onPress: () => fileReport('spam') },
                        { text: 'Offensive or abusive', onPress: () => fileReport('offensive') },
                        { text: 'Something else', onPress: () => fileReport('other') },
                        { text: 'Cancel', style: 'cancel' },
                    ]),
            },
            {
                text: `Block ${name}`,
                style: 'destructive',
                onPress: () =>
                    Alert.alert(
                        `Block ${name}?`,
                        "You won't see each other's reviews, comments, or profiles.",
                        [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Block', style: 'destructive', onPress: () => blockUser.mutate(targetId) },
                        ],
                    ),
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    if (isLoading || !identifier) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (error && !isNotFound) {
        return (
            <View style={styles.center}>
                <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center', paddingHorizontal: 20 }]}>
                    {"Couldn’t load this profile"}
                </Text>
            </View>
        );
    }

    if (isNotFound || !profileData) {
        return <NotFoundState />;
    }

    // ── Blocked stub (TICKET-090) — the one surface a blocked profile keeps ──
    if (profileData.blocked_by_viewer) {
        return (
            <View style={styles.center}>
                <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                    {profileData.profile.display_name ?? 'Someone'}
                </Text>
                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.sm }]}>
                    {"You've blocked this person."}
                </Text>
                <Pressable
                    onPress={() => unblockUser.mutate(profileData.profile.user_id)}
                    disabled={unblockUser.isPending}
                    style={[styles.unblockPill, { borderColor: 'rgba(160,63,40,0.35)' }]}
                    accessibilityRole="button"
                    accessibilityLabel="Unblock"
                >
                    <Text style={[styles.unblockLabel, { color: palette.primary }]}>
                        {unblockUser.isPending ? 'unblocking…' : 'unblock'}
                    </Text>
                </Pressable>
            </View>
        );
    }

    const stats = profileData.stats;
    const totalLogs = stats?.total_logs ?? 0;
    const targetUserId = profileData.profile.user_id;

    // ── Index (the Letterboxd tabs, as an editorial TOC) ─────────────────────
    const indexSections: IndexSection[] = [];

    if (hasPalateAccess) {
        const latestEntry = profileData.recently_logged?.[0];
        indexSections.push({
            title: 'Journal',
            count: totalLogs || null,
            hint: latestEntry ? `Latest: ${latestEntry.name}` : 'The chronological log',
            emphasis: true,
            route: `/diary?userId=${targetUserId}`,
        });

        indexSections.push({
            title: 'Spots',
            count: stats?.total_restaurants || null,
            hint: 'Every place, rated',
            route: `/spots?userId=${targetUserId}`,
        });

        indexSections.push({
            title: 'Reviews',
            count: stats?.reviews_count || null,
            hint: 'The written ones',
            emphasis: true,
            route: `/reviews?userId=${targetUserId}`,
        });

        const publicLists = profileData.public_lists ?? [];
        if (isSelf) {
            indexSections.push({
                title: 'Lists',
                count: publicLists.length || null,
                hint:
                    publicLists.length > 0
                        ? publicLists.slice(0, 3).map((l) => l.title).join(' · ')
                        : 'Curated collections',
                route: '/lists',
            });
        } else if (publicLists.length > 0) {
            // Stranger list browsing is a fast-follow — quiet inventory for now.
            indexSections.push({
                title: 'Lists',
                count: publicLists.length,
                hint: publicLists.slice(0, 3).map((l) => l.title).join(' · '),
                disabled: true,
            });
        }
    }

    if (isSelf) {
        indexSections.push({
            title: 'Wishlist',
            count: null,
            hint: 'Places saving for later',
            route: '/wishlist',
        });
    }

    indexSections.push({
        title: 'Likes',
        count: null,
        hint: '— coming soon',
        emphasis: true,
        disabled: true,
    });

    const isColdStart = totalLogs === 0;

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: palette.background }]}
            contentContainerStyle={{ paddingBottom: (inTab ? 100 : 40) + insets.bottom }}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={() => {
                        refetch();
                        refetchSpots();
                    }}
                    tintColor={palette.primary}
                />
            }
        >
            <ProfileHeader
                profile={profileData.profile}
                isSelf={isSelf}
                relationship={relationship}
                stats={stats}
                social={profileData.social}
                isFollowingViewer={profileData.is_following_viewer ?? false}
                followsViewer={profileData.follows_viewer ?? false}
                calibration={profileData.calibration}
                viewerRatedEntryCount={profileData.viewer_rated_entry_count}
                onSafetyMenu={!isSelf ? handleSafetyMenu : undefined}
            />

            {/* Top 4 — identity leads (Letterboxd: favorites before any feed).
                FRIEND_TEST.hideTopFours deliberately bypassed on the profile
                surface (was already bypassed on the own tab). */}
            {hasPalateAccess && (
                <TopFour
                    picks={profileData.top_four ?? []}
                    isOwner={isSelf}
                    onEdit={isSelf ? () => setEditTopFourOpen(true) : undefined}
                />
            )}

            {isColdStart && isSelf && (
                <Text
                    style={[
                        styles.coldStartNudge,
                        { color: palette.textMuted },
                    ]}
                >
                    Log four places you love and they&apos;ll appear here.
                </Text>
            )}

            {/* Taste + geography — the Beli modules, Heirloom voice */}
            {hasPalateAccess && (
                <TasteBand
                    topCuisines={taste.topCuisines}
                    cityCount={taste.cityCount}
                    countryCount={taste.countryCount}
                    palette={palette}
                    epithet={epithet}
                    // TICKET-112: own profile → tappable drill-in. Non-empty
                    // guard is TasteBand's own (it returns null on empty), so
                    // wiring the handler here is enough.
                    onPress={isSelf ? () => router.push('/taste') : undefined}
                />
            )}
            {hasPalateAccess && (
                <DiningMapPreview
                    spots={spots ?? []}
                    palette={palette}
                    onPress={() =>
                        router.push({
                            pathname: '/dining-map',
                            params: isSelf ? {} : { userId: targetUserId },
                        } as never)
                    }
                />
            )}

            {/* Regulars rail */}
            {hasPalateAccess && (
                <RegularsRail
                    regulars={profileData.regulars_preview ?? []}
                    userId={targetUserId}
                    showSeeAll={isSelf}
                />
            )}

            {/* ProfileIndex */}
            {indexSections.length > 0 && (
                <ProfileIndex sections={indexSections} />
            )}

            {/* Tables section — self, tables_in_common, public_and_tables */}
            {(relationship === 'self' ||
                relationship === 'tables_in_common' ||
                relationship === 'public_and_tables') && (
                <TablesInCommonSection
                    previews={profileData.tables_in_common}
                    targetUserId={targetUserId}
                    isSelf={isSelf}
                />
            )}

            {isSelf && (
                <ProfileTopFourSheet
                    visible={editTopFourOpen}
                    onClose={() => setEditTopFourOpen(false)}
                    userId={targetUserId}
                    currentPicks={(profileData.top_four ?? []).map((p) => ({
                        restaurant_id: p.restaurant_id,
                        name: p.name,
                        photo_url: p.photo_url,
                        hero_entry_photo_id: p.hero_entry_photo_id ?? null,
                        hero_photo_url: p.hero_photo_url ?? null,
                    }))}
                />
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    coldStartNudge: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.sm,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 17,
    },
    unblockPill: {
        marginTop: Spacing.lg,
        borderWidth: 1.5,
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 8,
    },
    unblockLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        textTransform: 'lowercase',
    },
});
