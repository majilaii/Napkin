/**
 * Settings screen — relocated from (tabs)/settings.tsx (TICKET-020).
 *
 * Reachable ONLY via the gear icon on own profile. Route: /settings.
 * Adds a "Privacy" section above "My Wishlist".
 * Existing content (Wishlist, Lists, Sign out) preserved.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { PrivacySection } from '@/components/settings/PrivacySection';
import { FRIEND_TEST } from '@/constants/flags';
import { LEGAL_URLS } from '@/constants/links';
import { useDeleteAccount } from '@/hooks/account';

export default function SettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { signOut, user } = useAuth();
    const router = useRouter();
    const deleteAccount = useDeleteAccount();

    // Two-step destructive confirm (guideline 5.1.1(v)). No typed phrase —
    // Alert-chain friction is enough at this scale, and the server does the
    // irreversible part only on the explicit second confirm.
    const confirmDelete = () => {
        Alert.alert(
            'Delete account?',
            'Every log, photo, list, and table membership goes with it.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Continue',
                    style: 'destructive',
                    onPress: () =>
                        Alert.alert(
                            'This is permanent',
                            "There's no undo and nothing is kept.",
                            [
                                { text: 'Keep my account', style: 'cancel' },
                                {
                                    text: 'Delete everything',
                                    style: 'destructive',
                                    onPress: () =>
                                        deleteAccount.mutate(undefined, {
                                            onError: () =>
                                                Alert.alert(
                                                    'Something went wrong',
                                                    "Your account was not deleted. Try again, or email us from the support page.",
                                                ),
                                        }),
                                },
                            ],
                        ),
                },
            ],
        );
    };

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

            <ScrollView
                style={styles.content}
                contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
                showsVerticalScrollIndicator={false}
            >
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

                {/* My Lists — hidden during friend-test */}
                {!FRIEND_TEST.hideLists && (
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
                )}

                {/* Blocked users (TICKET-090) */}
                <Pressable
                    onPress={() => router.push('/settings/blocked')}
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
                        <Ionicons name="hand-left-outline" size={20} color={palette.primary} />
                        <Text style={[Type.titleSmall, { color: palette.text }]}>Blocked</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                </Pressable>

                {/* Legal + support (TICKET-090) */}
                <View style={styles.linkRow}>
                    {(
                        [
                            ['Privacy', LEGAL_URLS.privacy],
                            ['Terms', LEGAL_URLS.terms],
                            ['Support', LEGAL_URLS.support],
                        ] as const
                    ).map(([label, url]) => (
                        <Pressable key={label} onPress={() => Linking.openURL(url)} hitSlop={8}>
                            <Text style={[styles.linkLabel, { color: palette.textMuted }]}>
                                {label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

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
                    <Text style={[Type.label, { color: palette.textInverse }]}>Sign out</Text>
                </Pressable>

                {/* Delete account — quiet by design; destructive confirm carries the weight */}
                <Pressable
                    onPress={confirmDelete}
                    disabled={deleteAccount.isPending}
                    style={styles.deleteRow}
                    accessibilityRole="button"
                    accessibilityLabel="Delete account"
                >
                    <Text style={[styles.deleteLabel, { color: palette.textMuted, opacity: deleteAccount.isPending ? 0.5 : 1 }]}>
                        {deleteAccount.isPending ? 'deleting…' : 'delete account'}
                    </Text>
                </Pressable>
            </ScrollView>
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
    linkRow: {
        flexDirection: 'row',
        gap: Spacing.lg,
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.xs,
    },
    linkLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.4,
    },
    deleteRow: {
        marginTop: Spacing.xl,
        alignItems: 'center',
        paddingVertical: Spacing.sm,
    },
    deleteLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.3,
    },
});
