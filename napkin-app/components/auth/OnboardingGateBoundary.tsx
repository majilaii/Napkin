import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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

/**
 * Keeps signed-in surfaces unmounted until the gate resolves. The wait itself
 * is presented by the launch screen (components/launch), which covers this
 * blocker; the blocker is only the paper underneath it.
 */
export function OnboardingGateBoundary({
    blocked,
    children,
}: {
    blocked: boolean;
    children: ReactNode;
}) {
    if (!blocked) return children;

    return <View testID="onboarding-gate-blocker" style={styles.container} />;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.light.background,
    },
});
