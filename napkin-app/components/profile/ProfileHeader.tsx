/**
 * ProfileHeader — canvas-faithful header block.
 * TICKET-025
 *
 * Layout (from profile-canvas.jsx ProfileHero):
 *   Row: Avatar (72x72 rounded square, radius 10) | Identity block | Gear (self)
 *   Identity block: display name (serif italic 24) + @handle + bio (italic serif 13)
 *   Numbers row below: logs · places · avg
 *
 * No centering. No circle avatar. Gear renders inline, not floating.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type {
    Calibration,
    SocialCounts,
    UserProfileRow,
    UserStats,
    ViewerRelationship,
} from '@/hooks/users/useUserProfile';
import { FollowButton } from './FollowButton';
import { CalibrationChip } from './CalibrationChip';
import { RateMoreToUnlockPrompt } from './RateMoreToUnlockPrompt';
import { NotifBell } from '@/components/notifications/NotifBell';
import { useUnreadCount } from '@/hooks/notifications';
import { useAuth } from '@/providers/AuthProvider';

interface Props {
    profile: UserProfileRow;
    isSelf: boolean;
    relationship: ViewerRelationship;
    stats?: UserStats | null;
    /**
     * Follower/following counts when `stats` is withheld (private tablemate).
     * Falls back through stats → social → placeholder so a real count never
     * renders as a lying 0.
     */
    social?: SocialCounts | null;
    /** Whether the viewing user is currently following the target. Used for the Follow button. */
    isFollowingViewer?: boolean;
    /** Whether the target follows the viewing user back. Drives the relationship meta line. */
    followsViewer?: boolean;
    /**
     * Calibration result from user-profile endpoint.
     * undefined = still loading, null = hidden (insufficient overlap / Tablemate / error).
     * Only passed when relationship === 'public_only'.
     */
    calibration?: Calibration | null;
    /**
     * Viewer's own rated-entry count — used to decide whether to show the
     * "rate more" prompt instead of the calibration chip.
     * Only meaningful when relationship === 'public_only'.
     */
    viewerRatedEntryCount?: number;
    /** TICKET-090: opens the report/block menu. Rendered as a quiet ⋯ beside
     * the follow button on non-self profiles. */
    onSafetyMenu?: () => void;
}

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 1).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship, stats, social, isFollowingViewer = false, followsViewer = false, calibration, viewerRatedEntryCount, onSafetyMenu }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const unreadCount = useUnreadCount(isSelf ? user?.id : null);
    const hasUnread = unreadCount > 0;

    const showUsername =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    const totalLogs = stats?.total_logs ?? 0;
    const totalPlaces = stats?.total_restaurants ?? 0;
    // Social counts fall back stats → social → null. null renders a '·' placeholder
    // (older cache, genuinely unknown) rather than a lying 0.
    const followersCount: number | null = stats
        ? stats.followers_count
        : social
          ? social.followers_count
          : null;
    const followingCount: number | null = stats
        ? stats.following_count
        : social
          ? social.following_count
          : null;

    // One terse relationship meta line (non-self only). 'follows you' wins when
    // the target follows back; otherwise flag an unreciprocated outbound follow.
    const relationshipNote = isSelf
        ? null
        : followsViewer
          ? 'follows you'
          : isFollowingViewer
            ? "doesn't follow you back yet"
            : null;

    const openFollowList = (kind: 'followers' | 'following') =>
        router.push({
            pathname: '/follows',
            params: { userId: profile.user_id, kind },
        });

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: palette.primaryContainer }]}>
                    <Text style={styles.avatarInitials}>
                        {initials(profile.display_name)}
                    </Text>
                </View>

                <View style={styles.identity}>
                    <Text
                        style={[styles.displayName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {profile.display_name}
                    </Text>
                    {showUsername && profile.username && (
                        <Text style={[styles.handle, { color: palette.textMuted }]}>
                            @{profile.username}
                        </Text>
                    )}
                    {profile.bio ? (
                        <Text style={[styles.bio, { color: palette.textSecondary }]}>
                            {profile.bio}
                        </Text>
                    ) : null}
                    {relationshipNote ? (
                        <Text style={[styles.relationshipNote, { color: palette.textMuted }]}>
                            {relationshipNote}
                        </Text>
                    ) : null}
                </View>

                {isSelf ? (
                    <View style={styles.selfActions}>
                        <NotifBell
                            unread={hasUnread}
                            onPress={() => router.push('/notifications')}
                            ringColor={palette.background}
                        />
                        <Pressable
                            onPress={() => router.push('/settings')}
                            hitSlop={10}
                            style={styles.gear}
                        >
                            <Ionicons
                                name="settings-outline"
                                size={20}
                                color={palette.textMuted}
                            />
                        </Pressable>
                    </View>
                ) : (
                    <View style={styles.selfActions}>
                        <FollowButton
                            targetUserId={profile.user_id}
                            initialIsFollowing={isFollowingViewer}
                        />
                        {onSafetyMenu ? (
                            <Pressable
                                onPress={onSafetyMenu}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel="Report or block"
                            >
                                <Ionicons
                                    name="ellipsis-horizontal"
                                    size={18}
                                    color={palette.textMuted}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                )}
            </View>

            {/* Calibration chip row — only for public_only, and only when there's something to show.
                 Outer row is gated so its margin collapses when both the chip and the prompt would be empty. */}
            {(() => {
                if (relationship !== 'public_only') return null;
                const showPrompt =
                    viewerRatedEntryCount !== undefined && viewerRatedEntryCount < 5;
                const showChip = !showPrompt && calibration !== null;
                if (!showPrompt && !showChip) return null;
                return (
                    <View style={[styles.calibrationRow, { paddingHorizontal: 0 }]}>
                        {showPrompt ? (
                            <RateMoreToUnlockPrompt viewerRatedEntryCount={viewerRatedEntryCount!} />
                        ) : (
                            <CalibrationChip calibration={calibration} />
                        )}
                    </View>
                );
            })()}

            {/* TICKET-092: stats strip in the ScoreBand grammar — ledger counts
                first, social last (the Letterboxd move). One identity-counts
                surface; the old inline sans row is gone. */}
            <View style={[styles.statsStrip, { borderColor: 'rgba(28,28,25,0.07)' }]}>
                <StatCell label="meals" value={totalLogs} palette={palette} />
                <View style={styles.statRule} />
                <StatCell label="places" value={totalPlaces} palette={palette} />
                <View style={styles.statRule} />
                <StatCell
                    label="this yr"
                    value={stats?.logs_this_year ?? 0}
                    palette={palette}
                />
                <View style={styles.statRule} />
                <StatCell
                    label="followers"
                    value={followersCount}
                    palette={palette}
                    onPress={() => openFollowList('followers')}
                />
                <View style={styles.statRule} />
                <StatCell
                    label="following"
                    value={followingCount}
                    palette={palette}
                    onPress={() => openFollowList('following')}
                />
            </View>
        </View>
    );
}

function StatCell({
    label,
    value,
    palette,
    onPress,
}: {
    /** null → count genuinely unknown (withheld / older cache): render '·', not 0. */
    value: number | null;
    label: string;
    palette: typeof Colors.light;
    onPress?: () => void;
}) {
    const dimmed = value === null || value === 0;
    const display = value === null ? '·' : value === 0 ? '—' : value;
    const body = (
        <>
            <Text style={[styles.statValue, { color: palette.text, opacity: dimmed ? 0.4 : 1 }]}>
                {display}
            </Text>
            <Text style={[styles.statLabel, { color: palette.textMuted }]}>{label}</Text>
        </>
    );
    if (!onPress) return <View style={styles.statCell}>{body}</View>;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.statCell, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`${value ?? 0} ${label}`}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingTop: Spacing.sm,
        paddingHorizontal: 22,
        paddingBottom: Spacing.md,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.md,
    },
    avatar: {
        width: 72,
        height: 72,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    avatarInitials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 22,
        letterSpacing: 0.5,
    },
    identity: {
        flex: 1,
        paddingTop: 4,
        minWidth: 0,
    },
    displayName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        fontWeight: '500',
        lineHeight: 28,
    },
    handle: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 2,
        letterSpacing: 0.2,
    },
    bio: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        marginTop: 8,
        lineHeight: 19,
    },
    relationshipNote: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        marginTop: 6,
        letterSpacing: 0.2,
    },
    gear: {
        width: 32,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: -2,
    },
    selfActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: -4,
    },
    calibrationRow: {
        marginTop: Spacing.sm,
        paddingHorizontal: 0,
    },
    statsStrip: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'stretch',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 10,
    },
    statRule: {
        width: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(28,28,25,0.07)',
    },
    statCell: {
        flex: 1,
        alignItems: 'center',
        gap: 2,
    },
    statValue: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 21,
        lineHeight: 25,
    },
    statLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 8.5,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
    },
});
