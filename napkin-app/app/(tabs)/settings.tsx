/**
 * Settings tab — placeholder with sign-out (the one real thing we need day one).
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';

export default function SettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { signOut, user } = useAuth();

    return (
        <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top + Spacing.xxl, paddingHorizontal: Spacing.lg }}>
            <Text style={[Type.displaySmall, { color: palette.text }]}>Settings</Text>
            <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.sm }]}>
                {user?.email ?? 'Signed in'}
            </Text>

            <Pressable
                onPress={signOut}
                style={({ pressed }) => ({
                    marginTop: Spacing.xl,
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
