/**
 * Onboarding S3 — Import teach (TICKET-107; v2 TICKET-122).
 * The LAST onboarding step. A full-screen, interaction-gated simulator that
 * teaches the real flow (reel → platform share → iOS share → Napkin → saved),
 * then completes onboarding from its terminal CTA.
 */
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCompleteOnboarding } from '@/hooks/onboarding/useCompleteOnboarding';
import { TeachShareSheetDemo } from '@/components/import-education';
import { useOnboardingDraft } from './OnboardingDraftContext';

export default function OnboardingTeachScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { draft } = useOnboardingDraft();
    const complete = useCompleteOnboarding();

    const finish = () => {
        if (complete.isPending) return;
        const display_name =
            (draft.display_name && draft.display_name.trim()) ||
            (user?.user_metadata?.display_name as string | undefined) ||
            'New User';
        complete.mutate(
            {
                display_name,
                home_city: draft.home_city && draft.home_city.trim() ? draft.home_city.trim() : null,
                avatar_url: draft.avatar_url,
            },
            {
                // Navigate only after the server confirms onboarding. Using
                // onSettled here also navigates on failure and races the route
                // gate rollback, which can strand the user between screens.
                onSuccess: () => router.replace('/wishlist'),
            },
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <TeachShareSheetDemo
                palette={palette}
                topInset={insets.top}
                bottomInset={insets.bottom}
                onDone={finish}
                isPending={complete.isPending}
                completionError={
                    complete.isError
                        ? "We couldn't finish setup. Check your connection and try again."
                        : null
                }
            />
        </View>
    );
}
