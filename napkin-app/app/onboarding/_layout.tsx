/**
 * Onboarding stack (TICKET-107) — three screens, first sign-in only:
 *   index (Name) → city (Home city) → teach (Import teach → Done).
 *
 * Header hidden, swipe-through. Name + city are threaded forward via route
 * params and written together on the final "Done" (one atomic completion so the
 * gate is never left half-set). RootLayoutNav gates entry on onboarded_at IS NULL.
 */
import { Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function OnboardingLayout() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                contentStyle: { backgroundColor: palette.background },
            }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="city" />
            <Stack.Screen name="teach" />
        </Stack>
    );
}
