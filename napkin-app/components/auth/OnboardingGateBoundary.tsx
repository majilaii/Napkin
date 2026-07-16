import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';

export function shouldBlockOnboardingGate(
    authLoading: boolean,
    hasSession: boolean,
    onboardedAt: string | null | undefined,
    routeGroup: string | undefined,
): boolean {
    // Password recovery must survive the auth event it causes mid-form. Every
    // ordinary surface stays opaque while session restoration is unresolved;
    // signed-in surfaces then stay opaque until a real profile read wins.
    return routeGroup !== 'reset-password'
        && (authLoading || (hasSession && onboardedAt === undefined));
}

export function OnboardingGateBoundary({
    blocked,
    children,
}: {
    blocked: boolean;
    children: ReactNode;
}) {
    if (!blocked) return children;

    return (
        <View
            testID="onboarding-gate-blocker"
            style={styles.container}
            accessibilityLabel="Checking your account"
        >
            <Text style={styles.brand}>NAPKIN</Text>
            <ActivityIndicator size="small" color={Colors.light.primary} />
            <Text style={styles.status}>Checking your account…</Text>
            <StatusBar style="dark" />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        backgroundColor: Colors.light.background,
    },
    brand: {
        color: Colors.light.text,
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 3.2,
    },
    status: {
        color: Colors.light.textMuted,
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
});
