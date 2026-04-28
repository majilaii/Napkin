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
    /** Whether the viewing user is currently following the target. Used for the Follow button. */
    isFollowingViewer?: boolean;
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
}

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 1).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship, stats, isFollowingViewer = false, calibration, viewerRatedEntryCount }: Props) {
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
    const followersCount = stats?.followers_count ?? 0;
    const followingCount = stats?.following_count ?? 0;

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
                    <FollowButton
                        targetUserId={profile.user_id}
                        initialIsFollowing={isFollowingViewer}
                    />
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

            <View style={styles.numbers}>
                <Text style={[styles.numbersText, { color: palette.textSecondary }]}>
                    <Text style={[styles.numberStrong, { color: palette.text }]}>
                        {totalLogs}
                    </Text>
                    {' logs'}
                </Text>
                <Text style={[styles.numbersText, { color: palette.textSecondary }]}>
                    <Text style={[styles.numberStrong, { color: palette.text }]}>
                        {totalPlaces}
                    </Text>
                    {' places'}
                </Text>
                {stats && (
                    <>
                        <Pressable onPress={() => openFollowList('followers')} hitSlop={6}>
                            <Text style={[styles.numbersText, { color: palette.textSecondary }]}>
                                <Text style={[styles.numberStrong, { color: palette.text }]}>
                                    {followersCount}
                                </Text>
                                {' followers'}
                            </Text>
                        </Pressable>
                        <Pressable onPress={() => openFollowList('following')} hitSlop={6}>
                            <Text style={[styles.numbersText, { color: palette.textSecondary }]}>
                                <Text style={[styles.numberStrong, { color: palette.text }]}>
                                    {followingCount}
                                </Text>
                                {' following'}
                            </Text>
                        </Pressable>
                    </>
                )}
                {stats?.average_rating != null && (
                    <Text style={[styles.numbersText, { color: palette.textSecondary }]}>
                        <Text style={[styles.numberStrong, { color: palette.text }]}>
                            {stats.average_rating.toFixed(1)}
                        </Text>
                        {' avg'}
                    </Text>
                )}
            </View>
        </View>
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
    numbers: {
        marginTop: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.md,
    },
    numbersText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
    },
    numberStrong: {
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
    },
});
