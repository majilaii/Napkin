/**
 * Onboarding S1 — Name (TICKET-107; v2 TICKET-126).
 * A single Manrope-labelled input, prefilled from the signup display_name.
 * No prose (copy-economy doctrine). Next → S2 (photo), writing the name to the
 * onboarding draft (state now lives in OnboardingDraftContext, not route params).
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';
import { OnboardingProgress } from './OnboardingProgress';

export default function OnboardingNameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { draft, patch } = useOnboardingDraft();

    const initial =
        draft.display_name ||
        (user?.user_metadata?.display_name as string | undefined) ||
        (user?.user_metadata?.full_name as string | undefined) ||
        '';
    const [name, setName] = useState(initial);

    const canContinue = name.trim().length > 0;

    const next = () => {
        if (!canContinue) return;
        patch({ display_name: name.trim() });
        router.push('/onboarding/photo');
    };

    return (
        <KeyboardAvoidingView
            style={[s.root, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <OnboardingProgress step={1} palette={palette} />
                <Text style={[s.kicker, { color: palette.textMuted }]}>welcome to napkin</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>your name</Text>

                <Text style={[s.label, { color: palette.textSecondary }]}>Name</Text>
                <TextInput
                    value={name}
                    onChangeText={(t) => setName(t.slice(0, 80))}
                    placeholder="Your name"
                    placeholderTextColor={palette.textMuted}
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={next}
                    style={[s.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                />
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={next}
                    disabled={!canContinue}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: !canContinue ? 0.4 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={s.primaryBtnText}>Continue</Text>
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}
