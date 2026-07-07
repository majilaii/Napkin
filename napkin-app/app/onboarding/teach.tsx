/**
 * Onboarding S3 — Import teach (TICKET-107; v2 TICKET-122).
 * The LAST onboarding step. A self-contained, auto-advancing 3-beat share-sheet
 * demo (benefit → in-app share-sheet replica → pro-tip), framed by the single serif
 * brandLine, then primary CTA "Done" → complete onboarding → /wishlist.
 */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCompleteOnboarding } from '@/hooks/onboarding/useCompleteOnboarding';
import { TeachShareSheetDemo } from '@/components/import-education';
import { onboardingStyles as s } from './styles';
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
                // The gate is flipped optimistically in onMutate, so navigate
                // immediately; a failure rolls the gate back to null and
                // RootLayoutNav returns the user to onboarding.
                onSettled: () => router.replace('/wishlist'),
            },
        );
    };

    return (
        <View style={[s.root, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <Text style={[s.kicker, { color: palette.textMuted }]}>the good part</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>save from anywhere</Text>

                {/* Theme-built, auto-advancing share-sheet demo (no screenshots). */}
                <TeachShareSheetDemo palette={palette} />
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={finish}
                    disabled={complete.isPending}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: complete.isPending ? 0.6 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    {complete.isPending ? (
                        <ActivityIndicator color={palette.textInverse} />
                    ) : (
                        <Text style={s.primaryBtnText}>Done</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}
