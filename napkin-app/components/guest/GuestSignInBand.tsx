/**
 * GuestSignInBand: the one compact doorway from a guest surface back to
 * `/auth` (TICKET-247). One quiet line, a terracotta pill, a text link.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function GuestSignInBand() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    return (
        <View style={styles.band} testID="guest-sign-in-band">
            <Text style={[Type.body, { color: palette.textSecondary }]}>
                sign in to log it, pin it and share it with your table.
            </Text>
            <Pressable
                onPress={() => router.push('/auth')}
                accessibilityRole="button"
                accessibilityLabel="sign in"
                style={({ pressed }) => [
                    styles.pill,
                    { backgroundColor: palette.primary },
                    pressed && styles.pressed,
                ]}
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>Sign in</Text>
            </Pressable>
            <Pressable
                onPress={() => router.push({ pathname: '/auth', params: { mode: 'sign-up' } })}
                accessibilityRole="button"
                accessibilityLabel="create an account"
                hitSlop={8}
                style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
            >
                <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>Create an account</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    band: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingVertical: Spacing.lg,
        gap: Spacing.md,
    },
    pill: {
        minHeight: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.lg,
    },
    quiet: {
        minHeight: Spacing.restaurant.quietActionHeight,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pressed: { opacity: 0.8 },
});
