/**
 * GuestPlate (TICKET-247): the one-line sign-in plate a guest sees on the
 * account-based tabs (FEED / TABLE / PROFILE). Warm paper, centred, two
 * affordances: the terracotta Sign in pill and a quiet Create an account line.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type GuestPlateSurface = 'feed' | 'tables' | 'profile';

const COPY: Record<GuestPlateSurface, { kicker: string; line: string }> = {
    feed: { kicker: 'Feed', line: "friends' meals, once you're in." },
    tables: { kicker: 'Table', line: 'a private table for your crew.' },
    profile: { kicker: 'Profile', line: 'your journal, lists and taste.' },
};

export function GuestPlate({ surface }: { surface: GuestPlateSurface }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const copy = COPY[surface];

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <Text style={[Type.labelSmall, styles.centered, { color: palette.textMuted }]}>
                {copy.kicker}
            </Text>
            <Text style={[Type.body, styles.centered, styles.line, { color: palette.textSecondary }]}>
                {copy.line}
            </Text>
            <Pressable
                onPress={() => router.push('/auth')}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                style={({ pressed }) => [
                    styles.cta,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                ]}
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>Sign in</Text>
            </Pressable>
            <Pressable
                onPress={() => router.push({ pathname: '/auth', params: { mode: 'sign-up' } })}
                accessibilityRole="button"
                accessibilityLabel="Create an account"
                hitSlop={12}
                style={styles.secondary}
            >
                <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>Create an account</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        // Room for the floating bottom nav pill.
        paddingBottom: 96,
    },
    centered: {
        textAlign: 'center',
    },
    line: {
        marginTop: Spacing.sm,
    },
    cta: {
        marginTop: Spacing.xl,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.xl,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 52,
        alignSelf: 'stretch',
    },
    secondary: {
        marginTop: Spacing.lg,
        alignItems: 'center',
    },
});
