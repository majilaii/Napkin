/**
 * ProfileScreenBody — shared body between (tabs)/profile.tsx and u/[identifier].tsx.
 * TICKET-025
 *
 * Composes: ProfileHeader → TopFour → RegularsRail → ProfileIndex → TablesInCommonSection
 * Handles all loading/error/not-found states.
 * Cold-start: empty TopFour slots + locked Regulars panel + first-review nudge.
 */
import React from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUserProfile } from '@/hooks/users/useUserProfile';

import { ProfileHeader } from './ProfileHeader';
import { TopFour } from './TopFour';
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

    const { data: result, isLoading, error } = useUserProfile(identifier);

    const isNotFound = result?.isNotFound ?? false;
    const profileData = result?.data ?? null;

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
                    {"Couldn\u2019t load this profile"}
                </Text>
            </View>
        );
    }

    if (isNotFound || !profileData) {
        return <NotFoundState />;
    }

    const relationship = profileData.viewer_target_relationship;
    const isSelf = profileData.is_self;
    const stats = profileData.stats;
    const totalLogs = stats?.total_logs ?? 0;

    // Build index sections
    const indexSections: IndexSection[] = [];

    const hasPalateAccess =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    // Diary — self only in Phase 1 (stranger Diary entry point is a fast-follow
    // once copy/empty-states are reviewed). Server-side gate exists either way.
    if (isSelf) {
        const latestEntry = profileData.recently_logged?.[0];
        const diaryHint = latestEntry
            ? `Latest: ${latestEntry.name}`
            : 'Your chronological log';

        indexSections.push({
            title: 'Diary',
            count: totalLogs || null,
            hint: diaryHint,
            emphasis: true,
            route: `/diary?userId=${profileData.profile.user_id}`,
        });
    }

    // Reviews — disabled placeholder
    indexSections.push({
        title: 'Reviews',
        count: null,
        hint: '— coming soon',
        emphasis: true,
        disabled: true,
    });

    // Lists — only for self or public profiles
    if (hasPalateAccess) {
        const listsCount = profileData.public_lists?.length ?? 0;
        const listHint =
            profileData.public_lists && profileData.public_lists.length > 0
                ? profileData.public_lists
                    .slice(0, 3)
                    .map((l) => l.title)
                    .join(' · ')
                : 'Your curated collections';

        indexSections.push({
            title: 'Lists',
            count: listsCount || null,
            hint: listHint,
            route: '/lists',
        });
    }

    // Wishlist — only for self
    if (isSelf) {
        indexSections.push({
            title: 'Wishlist',
            count: null,
            hint: 'Places saving for later',
            route: '/wishlist',
        });
    }

    // Likes — disabled placeholder
    indexSections.push({
        title: 'Likes',
        count: null,
        hint: '— coming soon',
        emphasis: true,
        disabled: true,
    });

    // Cold-start: user has no reviewed entries yet
    const isColdStart = totalLogs === 0;

    // Should show first-review nudge: self + cold start or very few logs with no notes
    const showFirstReviewNudge = isSelf && isColdStart;

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: palette.background }]}
            contentContainerStyle={{ paddingBottom: (inTab ? 100 : 40) + insets.bottom }}
            showsVerticalScrollIndicator={false}
        >
            <ProfileHeader
                profile={profileData.profile}
                isSelf={isSelf}
                relationship={relationship}
                stats={stats}
                isFollowingViewer={profileData.is_following_viewer ?? false}
                calibration={profileData.calibration}
                viewerRatedEntryCount={profileData.viewer_rated_entry_count}
            />

            {/* Hairline divider */}
            <View style={[styles.hairline, { backgroundColor: palette.dividerSoft }]} />

            {/* Top 4 */}
            {hasPalateAccess && (
                <TopFour picks={profileData.top_four ?? []} />
            )}

            {/* Cold-start nudge under top 4 */}
            {isColdStart && isSelf && (
                <Text
                    style={[
                        Type.headlineItalic,
                        styles.coldStartNudge,
                        { color: palette.textMuted, fontFamily: 'Newsreader_400Regular_Italic' },
                    ]}
                >
                    Log four places you love and they&apos;ll appear here.
                </Text>
            )}

            {/* Regulars rail */}
            {hasPalateAccess && (
                <RegularsRail
                    regulars={profileData.regulars_preview ?? []}
                    userId={profileData.profile.user_id}
                    showSeeAll={isSelf}
                />
            )}

            {/* First-review nudge — cold start only */}
            {showFirstReviewNudge && (
                <View style={[styles.nudgeCard, { backgroundColor: palette.surfaceContainerLow, borderColor: palette.outlineVariant }]}>
                    <Text
                        style={[
                            Type.headlineItalic,
                            { fontSize: 14, color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' },
                        ]}
                    >
                        Write your first review.
                    </Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 4, lineHeight: 18 }]}>
                        Reviews are the long-form ones — a paragraph or two about a meal worth remembering.
                    </Text>
                </View>
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
                    targetUserId={profileData.profile.user_id}
                    isSelf={isSelf}
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
    hairline: {
        height: 1,
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.xs,
    },
    coldStartNudge: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.sm,
        fontSize: 12,
        lineHeight: 17,
    },
    nudgeCard: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.lg,
        padding: Spacing.md,
        borderRadius: Radius.sm,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
});
