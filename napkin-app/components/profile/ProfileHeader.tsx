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
    UserProfileRow,
    UserStats,
    ViewerRelationship,
} from '@/hooks/users/useUserProfile';

interface Props {
    profile: UserProfileRow;
    isSelf: boolean;
    relationship: ViewerRelationship;
    stats?: UserStats | null;
}

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 1).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship, stats }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const showUsername =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    const totalLogs = stats?.total_logs ?? 0;
    const totalPlaces = stats?.total_restaurants ?? 0;

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

                {isSelf && (
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
                )}
            </View>

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
