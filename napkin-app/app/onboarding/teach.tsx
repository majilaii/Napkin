/**
 * Onboarding S3 — Import teach (TICKET-107; v2 TICKET-122).
 * The LAST onboarding step. A full-screen, interaction-gated simulator that
 * teaches the real flow (reel → platform share → iOS share → Napkin → saved),
 * then completes onboarding from its terminal CTA.
 */
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TeachShareSheetDemo } from '@/components/import-education';
import { useFinishOnboarding } from './useFinishOnboarding';

export default function OnboardingTeachScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { finish, isPending, completionError } = useFinishOnboarding();

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <TeachShareSheetDemo
                palette={palette}
                topInset={insets.top}
                bottomInset={insets.bottom}
                onDone={finish}
                isPending={isPending}
                completionError={completionError}
            />
        </View>
    );
}
