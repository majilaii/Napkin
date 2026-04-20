/**
 * ProfileHeader — avatar left + identity block right.
 * TICKET-025 repaint: matches canvas layout: avatar left, serif italic
 * display name, @username, bio, identity numbers row (logs · places).
 *
 * Self: gear icon top-right.
 * Stranger: identity + counts only — no follow CTA (follow graph not shipped).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { UserProfileRow, ViewerRelationship, UserStats } from '@/hooks/users/useUserProfile';

interface Props {
    profile: UserProfileRow;
    isSelf: boolean;
    relationship: ViewerRelationship;
    stats?: UserStats | null;
}

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 2).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship, stats }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const showUsername =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    return (
        <View style={styles.container}>
            {/* Row: avatar left + identity block right */}
            <View style={styles.row}>
                {/* Avatar */}
                <View style={[styles.avatar, { backgroundColor: palette.surfaceContainerHigh }]}>
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.textSecondary, fontFamily: 'Newsreader_400Regular_Italic' },
                        ]}
                    >
                        {initials(profile.display_name)}
                    </Text>
                </View>

                {/* Identity block */}
                <View style={styles.identity}>
                    <Text
                        style={[
                            styles.displayName,
                            { color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' },
                        ]}
                        numberOfLines={2}
                    >
                        {profile.display_name}
                    </Text>

                    {showUsername && profile.username && (
                        <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]}>
                            @{profile.username}
                        </Text>
                    )}

                    {profile.bio ? (
                        <Text
                            style={[
                                styles.bio,
                                { color: palette.textSecondary, fontFamily: 'Newsreader_400Regular_Italic' },
                            ]}
                            numberOfLines={3}
                        >
                            {profile.bio}
                        </Text>
                    ) : null}
                </View>

                {/* Gear — self only */}
                {isSelf && (
                    <Pressable
                        onPress={() => router.push('/settings')}
                        hitSlop={12}
                        style={styles.gear}
                    >
                        <Ionicons name="settings-outline" size={20} color={palette.textMuted} />
                    </Pressable>
                )}
            </View>

            {/* Identity numbers — single row */}
            {stats && (
                <View style={styles.countsRow}>
                    <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                        <Text style={{ color: palette.text, fontWeight: '600' }}>
                            {stats.total_logs}
                        </Text>
                        {' logs'}
                    </Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>{' · '}</Text>
                    <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                        <Text style={{ color: palette.text, fontWeight: '600' }}>
                            {stats.total_restaurants}
                        </Text>
                        {' places'}
                    </Text>
                    {stats.average_rating != null && (
                        <>
                            <Text style={[Type.bodySmall, { color: palette.textMuted }]}>{' · '}</Text>
                            <Text
                                style={{
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 13,
                                    color: palette.tertiary,
                                }}
                            >
                                {stats.average_rating.toFixed(1)}
                                <Text style={{ color: palette.textMuted }}>{' avg'}</Text>
                            </Text>
                        </>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
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
    identity: {
        flex: 1,
        paddingTop: 4,
    },
    displayName: {
        fontSize: 24,
        lineHeight: 28,
        fontWeight: '500',
    },
    bio: {
        fontSize: 13,
        lineHeight: 19,
        marginTop: Spacing.sm,
    },
    gear: {
        width: 32,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 6,
        marginTop: 4,
    },
    countsRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: Spacing.sm,
        flexWrap: 'wrap',
    },
});
