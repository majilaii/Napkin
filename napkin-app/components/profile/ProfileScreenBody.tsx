/**
 * ProfileScreenBody — shared body between (tabs)/profile.tsx and u/[identifier].tsx.
 * TICKET-025, rebuilt for TICKET-092 (the Letterboxd/Beli revamp).
 *
 * One profile grammar for self AND public — identity → taste → collections →
 * the record → tables, seven sections in one scroll (TICKET-191 rev 2:
 * imports live up top — a header tray affordance + an attention-only card —
 * while the hub owns history):
 *
 *   ProfileHeader (identity + stats; self actions row carries the imports tray)
 *   → ImportAttentionCard (self, ONLY when the import slot owes an action)
 *   → TopFour (self: editable; public: read view)
 *   → QuickTakes (prompt-led, owner-curated opinions)
 *   → TasteSignature (cuisines · geography · overall rating distribution —
 *     the sole carrier of eating-geography since the dining map was removed)
 *   → ListsShelf (the "Lists" section — cover-plate rail + see-all)
 *   → ProfileIndex (Journal · Spots · Reviews · Wishlist[self])
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
import { useUpdateProfile } from '@/hooks/users/useUpdateProfile';
import { useUserSpots, deriveTaste } from '@/hooks/users/useUserSpots';
import { useReportContent, useBlockUser, useUnblockUser } from '@/hooks/account';
import { useImportSlot } from '@/hooks/imports/useImportSlot';

import { ProfileHeader } from './ProfileHeader';
import { ImportAttentionCard } from './ImportAttentionCard';
import { TopFour } from './TopFour';
import { ProfileTopFourSheet } from './ProfileTopFourSheet';
import { QuickTakes } from './QuickTakes';
import { QuickTakesSheet } from './QuickTakesSheet';
import { TasteSignature } from './TasteSignature';
import { ListsShelf } from './ListsShelf';
import { ProfileIndex } from './ProfileIndex';
import { TablesInCommonSection } from './TablesInCommonSection';
import { NotFoundState } from './NotFoundState';
import type { IndexSection } from './ProfileIndex';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import {
    chooseAndSaveNewProfilePhoto,
    shouldBlockProfilePhotoPicker,
} from '@/lib/profilePhoto';

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
    const profileUserId = profileData?.profile.user_id ?? null;
    const updateProfile = useUpdateProfile(profileUserId);
    const { status: connectivityStatus } = useConnectivity();

    const relationship = profileData?.viewer_target_relationship ?? 'none';
    const isSelf = profileData?.is_self ?? false;
    const hasPalateAccess =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    // Spots feed the quiet taste signature (server-gated same as regulars).
    const { data: spots, refetch: refetchSpots } = useUserSpots(
        hasPalateAccess ? profileData?.profile.user_id : null,
    );
    const taste = useMemo(() => deriveTaste(spots ?? []), [spots]);
    // Live import slot (TICKET-191 rev 2) — powers the header tray affordance
    // + the attention-only card. RENDER-gated on isSelf below: useActiveImports
    // reads the viewer's own queue regardless of the userId arg, so the value
    // must never reach a stranger-profile surface.
    const importSlot = useImportSlot(isSelf ? profileUserId : null);
    const [editTopFourOpen, setEditTopFourOpen] = useState(false);
    const [editQuickTakesOpen, setEditQuickTakesOpen] = useState(false);
    const [isAddingProfilePhoto, setIsAddingProfilePhoto] = useState(false);
    const profilePhotoWorking = isAddingProfilePhoto || updateProfile.isPending;

    const handleAddProfilePhoto = async () => {
        if (shouldBlockProfilePhotoPicker(connectivityStatus)) {
            Alert.alert(
                'No connection',
                'Connect to the internet to add a profile photo.',
            );
            return;
        }
        if (
            profilePhotoWorking ||
            !profileUserId ||
            !profileData?.is_self ||
            profileData.profile.avatar_url
        ) {
            return;
        }

        try {
            await chooseAndSaveNewProfilePhoto({
                userId: profileUserId,
                onSourceChosen: () => setIsAddingProfilePhoto(true),
                saveAvatarUrl: (avatarUrl) =>
                    updateProfile.mutateAsync({ avatar_url: avatarUrl }),
            });
        } catch {
            Alert.alert("Couldn't save that photo", 'Please try again.');
        } finally {
            setIsAddingProfilePhoto(false);
        }
    };

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

    // ── Reachable private-account stub (TICKET-155) ──────────────────────────
    // An existing private account the viewer doesn't share a Table with. Not a
    // 404, not a request-to-follow form — the header (avatar + name + working
    // follow button + NON-interactive counts) plus one quiet line where the
    // palate would go. Following resolves immediately; no approve step anywhere.
    if (profileData.private_stub) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <ProfileHeader
                    profile={profileData.profile}
                    isSelf={false}
                    relationship={relationship}
                    stats={null}
                    social={profileData.social}
                    isFollowingViewer={profileData.is_following_viewer ?? false}
                    followsViewer={profileData.follows_viewer ?? false}
                    countsInteractive={false}
                    onSafetyMenu={handleSafetyMenu}
                />
                <Text style={[Type.bodySmall, styles.privateState, { color: palette.textMuted }]}>
                    their journal is private
                </Text>
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
            route: `/reviews?userId=${targetUserId}`,
        });
        // Lists + Imports live in the Collections rails above the index
        // (TICKET-185/191) — no text TOC rows here, for self or stranger.
    }

    if (isSelf) {
        indexSections.push({
            title: 'Wishlist',
            count: null,
            hint: 'Places saving for later',
            route: '/wishlist',
        });
    }

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
                onAddPhoto={isSelf ? handleAddProfilePhoto : undefined}
                isAddingPhoto={profilePhotoWorking}
                importSlot={isSelf ? importSlot : null}
            />

            {/* Imports, above the fold (TICKET-191 rev 2): the card renders ONLY
                when the slot owes an action; calm states leave the body clean. */}
            {isSelf && <ImportAttentionCard slot={importSlot} />}

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

            {hasPalateAccess && (
                <QuickTakes
                    takes={profileData.quick_takes ?? []}
                    isOwner={isSelf}
                    onEdit={isSelf ? () => setEditQuickTakesOpen(true) : undefined}
                    onOpenRestaurant={(restaurantId) =>
                        router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } })
                    }
                />
            )}

            {/* One quiet signature: cuisine + geography + overall rating use.
                The generated emblem stays inside the /taste drill-in. */}
            {hasPalateAccess && (
                <TasteSignature
                    topCuisines={taste.topCuisines}
                    cityCount={taste.cityCount}
                    countryCount={taste.countryCount}
                    histogram={stats?.rating_histogram}
                    averageRating={stats?.average_rating}
                    isSelf={isSelf}
                    onPress={() =>
                        router.push({
                            pathname: '/taste',
                            params: { userId: targetUserId },
                        })
                    }
                />
            )}
            {/* Lists — cover-plate rail with its own "Lists" header (rev 2
                un-merged Collections); hides for a stranger with no public lists */}
            {hasPalateAccess && (
                <ListsShelf
                    isSelf={isSelf}
                    userId={targetUserId}
                    publicLists={profileData.public_lists ?? []}
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
                <>
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
                    <QuickTakesSheet
                        visible={editQuickTakesOpen}
                        onClose={() => setEditQuickTakesOpen(false)}
                        userId={targetUserId}
                        profileIdentifier={identifier!}
                        currentTakes={profileData.quick_takes ?? []}
                    />
                </>
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
        ...Type.bodySmall,
        marginHorizontal: Spacing.lg,
        marginTop: 12,
    },
    // TICKET-155: the one quiet private-account line, sitting where palate
    // sections would go (directly under the header). Aligns to the header's
    // 22pt horizontal padding.
    privateState: {
        paddingHorizontal: 22,
        marginTop: Spacing.sm,
    },
    unblockPill: {
        marginTop: Spacing.lg,
        minHeight: 40,
        borderWidth: 1.5,
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 8,
        justifyContent: 'center',
    },
    unblockLabel: {
        ...Type.label,
        textTransform: 'lowercase',
    },
});
