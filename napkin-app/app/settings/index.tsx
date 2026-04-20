/**
 * Settings screen — relocated from (tabs)/settings.tsx (TICKET-020).
 *
 * Reachable ONLY via the gear icon on own profile. Route: /settings.
 * Adds a "Privacy" section above "My Wishlist".
 * Existing content (Wishlist, Lists, Sign out) preserved.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { PrivacySection } from '@/components/settings/PrivacySection';

export default function SettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { signOut, user } = useAuth();
    const router = useRouter();

    return (
        <View style={[
            styles.container,
            {
                backgroundColor: palette.background,
                paddingTop: insets.top + Spacing.sm,
            },
        ]}>
            {/* Top bar with back nav */}
            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12}>
                    <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                </Pressable>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                <Text style={[Type.displaySmall, { color: palette.text }]}>Settings</Text>
                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.sm }]}>
                    {user?.email ?? 'Signed in'}
                </Text>

                {/* Privacy section — routes to /settings/privacy */}
                <PrivacySection />

                {/* My Wishlist */}
                <Pressable
                    onPress={() => router.push('/wishlist')}
                    style={({ pressed }) => [
                        styles.row,
                        {
                            backgroundColor: pressed
                                ? palette.surfaceContainerHigh
                                : palette.surfaceContainerLow,
                        },
                    ]}
                >
                    <View style={styles.rowLeft}>
                        <Ionicons name="heart-outline" size={20} color={palette.primary} />
                        <Text style={[Type.titleSmall, { color: palette.text }]}>My Wishlist</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Pressable>

                {/* My Lists */}
                <Pressable
                    onPress={() => router.push('/lists')}
                    style={({ pressed }) => [
                        styles.row,
                        {
                            backgroundColor: pressed
                                ? palette.surfaceContainerHigh
                                : palette.surfaceContainerLow,
                        },
                    ]}
                >
                    <View style={styles.rowLeft}>
                        <Ionicons name="list-outline" size={20} color={palette.primary} />
                        <Text style={[Type.titleSmall, { color: palette.text }]}>My Lists</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Pressable>

                {/* Sign out */}
                <Pressable
                    onPress={signOut}
                    style={({ pressed }) => [
                        styles.signOut,
                        {
                            backgroundColor: palette.primary,
                            opacity: pressed ? 0.9 : 1,
                        },
                    ]}
                >
                    <Text style={[Type.label, { color: '#fff' }]}>Sign out</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    content: {
        flex: 1,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    row: {
        marginTop: Spacing.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    signOut: {
        marginTop: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
    },
});
