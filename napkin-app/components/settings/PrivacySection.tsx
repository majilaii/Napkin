/**
 * PrivacySection — two-line row on the Settings index that routes to /settings/privacy.
 * Shows current account_privacy state as secondary text.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import { useAuth } from '@/providers/AuthProvider';

export function PrivacySection() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const privacy = result?.data?.profile?.account_privacy ?? 'private';

    const secondaryText =
        privacy === 'public'
            ? 'Public — anyone with the link can browse your palate'
            : 'Private — only your Tables see you';

    return (
        <Pressable
            onPress={() => router.push('/settings/privacy')}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: pressed
                        ? palette.surfaceContainerHigh
                        : palette.surfaceContainerLow,
                    marginTop: Spacing.xl,
                },
            ]}
        >
            <View style={styles.left}>
                <Ionicons name="lock-closed-outline" size={20} color={palette.primary} />
                <View style={styles.textStack}>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                        Account visibility
                    </Text>
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={2}>
                        {secondaryText}
                    </Text>
                </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    left: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
    },
    textStack: {
        flex: 1,
    },
});
