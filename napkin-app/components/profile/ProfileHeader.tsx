/**
 * ProfileHeader — canvas-faithful header block.
 * TICKET-025
 *
 * Layout (from profile-canvas.jsx ProfileHero):
 *   Row: Avatar (72x72 rounded square, radius 10) | Identity block | Gear (self)
 *   Identity block: display name (serif italic 24) + @handle + bio (italic serif 13)
 *   Numbers row below: logs · places · avg
 *
 * No centering. The avatar shape stays a rounded square (radius 10), NOT a circle.
 * When `profile.avatar_url` is set, the photo layers absolutely OVER the monogram
 * plate (same 72x72 footprint) — a broken/absent image falls through to the
 * initials with no state to track. Gear renders inline, not floating.
 */
import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
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
import { profileStatSegments } from './statsLine';

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
    /**
     * TICKET-155: when false, the follower/following counts render NON-tappable
     * (no /follows tap-through). Used only on the reachable private-account stub
     * tier — follow_list still 404s a non-tablemate viewer of a private account,
     * so a tappable count would dead-end. Defaults to true (every other tier).
     */
    countsInteractive?: boolean;
}

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 1).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship, stats, social, isFollowingViewer = false, followsViewer = false, calibration, viewerRatedEntryCount, onSafetyMenu, countsInteractive = true }: Props) {
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

    // Social counts fall back stats → social → null. null → omitted from the line
    // (older cache / genuinely unknown) rather than a lying 0. PLACES / THIS YR
    // are gone (cities/countries live in the TASTE band) — TICKET-144.
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
    // meals only when stats are present (a withheld tablemate shows none, not 0).
    // TICKET-155: countsInteractive=false on the private-account stub tier keeps
    // the follow segments non-tappable (follow_list 404s that viewer).
    const statSegments = profileStatSegments(
        {
            meals: stats ? (stats.total_logs ?? 0) : null,
            following: followingCount,
            followers: followersCount,
        },
        { countsInteractive },
    );

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
                    {profile.avatar_url ? (
                        // Layer the photo OVER the monogram so a failed load falls
                        // through to the initials — no error state to track.
                        <Image
                            source={{ uri: profile.avatar_url }}
                            style={styles.avatarPhoto}
                        />
                    ) : null}
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
                    {/* TICKET-144: one quiet counts line — meals · following ·
                        follower(s). Follow segments tap → /follows (correct tab). */}
                    {statSegments.length > 0 ? (
                        <Text style={[styles.statsLine, { color: palette.textMuted }]}>
                            {statSegments.map((seg, i) => (
                                <React.Fragment key={seg.key}>
                                    {i > 0 ? <Text>{' · '}</Text> : null}
                                    {seg.tappable ? (
                                        <Text
                                            onPress={() =>
                                                openFollowList(seg.key as 'followers' | 'following')
                                            }
                                            accessibilityRole="button"
                                            accessibilityLabel={seg.text}
                                        >
                                            {seg.text}
                                        </Text>
                                    ) : (
                                        <Text>{seg.text}</Text>
                                    )}
                                </React.Fragment>
                            ))}
                        </Text>
                    ) : null}
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
    // Photo fills the monogram footprint. Hairline outline matches Avatar.tsx so
    // photos read as consistent depth on warm paper.
    avatarPhoto: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.08)',
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
    // TICKET-144: one quiet counts line under the @handle (meals · following ·
    // follower). Low-key Manrope; follow segments are tappable (no underline).
    statsLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        marginTop: 6,
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
});
