/**
 * ProfileHeader — avatar, display name, @username, bio.
 * Renders a gear icon (44x44) top-right when is_self=true.
 * No inline-edit affordances — edit lives under the gear.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { UserProfileRow, ViewerRelationship } from '@/hooks/users/useUserProfile';

interface Props {
    profile: UserProfileRow;
    isSelf: boolean;
    relationship: ViewerRelationship;
}

/**
 * Generates initials from display_name for the avatar fallback.
 */
function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 2).toUpperCase();
}

export function ProfileHeader({ profile, isSelf, relationship }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    // @username line is shown when target is public or is self
    const showUsername =
        relationship === 'self' ||
        relationship === 'public_only' ||
        relationship === 'public_and_tables';

    return (
        <View style={styles.container}>
            {/* Gear icon — top-right, self only */}
            {isSelf && (
                <Pressable
                    onPress={() => router.push('/settings')}
                    hitSlop={12}
                    style={styles.gearButton}
                >
                    <Ionicons name="settings-outline" size={22} color={palette.textSecondary} />
                </Pressable>
            )}

            {/* Avatar */}
            <View style={[styles.avatarContainer, { backgroundColor: palette.surfaceContainerHigh }]}>
                {profile.avatar_url ? (
                    // If we had an Image component set up, we'd use it here.
                    // For now render initials even when avatar_url is set —
                    // a future Image component can replace this.
                    // ARCHITECT-REVIEW: Should this use expo-image for performance?
                    <Text style={[Type.headlineMedium, { color: palette.textSecondary }]}>
                        {initials(profile.display_name)}
                    </Text>
                ) : (
                    <Text style={[Type.headlineMedium, { color: palette.textSecondary }]}>
                        {initials(profile.display_name)}
                    </Text>
                )}
            </View>

            {/* Display name */}
            <Text
                style={[
                    Type.displaySmall,
                    styles.displayName,
                    {
                        color: palette.text,
                        fontFamily: 'Newsreader_400Regular_Italic',
                    },
                ]}
            >
                {profile.display_name}
            </Text>

            {/* @username — only when public or self */}
            {showUsername && profile.username && (
                <Text style={[Type.bodySmall, styles.username, { color: palette.textMuted }]}>
                    @{profile.username}
                </Text>
            )}

            {/* Bio */}
            {profile.bio && (
                <Text style={[Type.body, styles.bio, { color: palette.textSecondary }]}>
                    {profile.bio}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingTop: Spacing.md,
        paddingHorizontal: Spacing.lg,
        alignItems: 'center',
        position: 'relative',
    },
    gearButton: {
        position: 'absolute',
        top: Spacing.md,
        right: Spacing.lg,
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarContainer: {
        width: 88,
        height: 88,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    displayName: {
        textAlign: 'center',
        marginBottom: Spacing.xs,
    },
    username: {
        textAlign: 'center',
        marginBottom: Spacing.xs,
    },
    bio: {
        textAlign: 'center',
        marginTop: Spacing.sm,
        maxWidth: 300,
    },
});
