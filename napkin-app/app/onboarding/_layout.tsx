/**
 * Onboarding stack — first sign-in only (TICKET-107; v2 TICKET-126).
 *   index (Name) → photo (Avatar, skippable) → city (Home city, skippable)
 *   → follows (Suggestions, conditional → Done). City completes onboarding
 *   directly when there are no follow suggestions.
 *
 * Header hidden, swipe-through. State is threaded via OnboardingDraftContext (a
 * conditional terminal step + a long avatar_url made the old param chain fragile)
 * and written together on the final "Done" (one atomic completion so the gate is
 * never left half-set). RootLayoutNav gates entry on onboarded_at IS NULL.
 */
import { Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { OnboardingDraftProvider } from './OnboardingDraftContext';

export default function OnboardingLayout() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <OnboardingDraftProvider>
            <Stack
                screenOptions={{
                    headerShown: false,
                    gestureEnabled: true,
                    contentStyle: { backgroundColor: palette.background },
                }}
            >
                <Stack.Screen name="index" />
                <Stack.Screen name="photo" />
                <Stack.Screen name="city" />
                <Stack.Screen name="follows" />
            </Stack>
        </OnboardingDraftProvider>
    );
}
