/**
 * Settings tab — placeholder with sign-out (the one real thing we need day one).
 * Also hosts the "My Wishlist" entry point.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';

export default function SettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { signOut, user } = useAuth();
    const router = useRouter();

    return (
        <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top + Spacing.xxl, paddingHorizontal: Spacing.lg }}>
            <Text style={[Type.displaySmall, { color: palette.text }]}>Settings</Text>
            <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.sm }]}>
                {user?.email ?? 'Signed in'}
            </Text>

            {/* My Wishlist */}
            <Pressable
                onPress={() => router.push('/wishlist')}
                style={({ pressed }) => ({
                    marginTop: Spacing.xl,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.lg,
                    borderRadius: Radius.md,
                    backgroundColor: palette.surfaceContainerLow,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: pressed ? 0.8 : 1,
                })}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                    <Ionicons name="heart-outline" size={20} color={palette.primary} />
                    <Text style={[Type.titleSmall, { color: palette.text }]}>My Wishlist</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
            </Pressable>

            {/* My Lists */}
            <Pressable
                onPress={() => router.push('/lists')}
                style={({ pressed }) => ({
                    marginTop: Spacing.md,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.lg,
                    borderRadius: Radius.md,
                    backgroundColor: palette.surfaceContainerLow,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: pressed ? 0.8 : 1,
                })}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                    <Ionicons name="list-outline" size={20} color={palette.primary} />
                    <Text style={[Type.titleSmall, { color: palette.text }]}>My Lists</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
            </Pressable>

            {/* Sign out */}
            <Pressable
                onPress={signOut}
                style={({ pressed }) => ({
                    marginTop: Spacing.md,
                    paddingVertical: Spacing.md,
                    paddingHorizontal: Spacing.lg,
                    borderRadius: Radius.full,
                    backgroundColor: palette.primary,
                    alignItems: 'center',
                    opacity: pressed ? 0.9 : 1,
                })}
            >
                <Text style={[Type.label, { color: '#fff' }]}>Sign out</Text>
            </Pressable>
        </View>
    );
}
