/** Name stays in the setup draft until final, atomic completion. */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Colors, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { SetupFrame } from '@/components/onboarding/SetupFrame';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';

export default function OnboardingNameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const { draft, patch } = useOnboardingDraft();
    const initial =
        draft.display_name ||
        (user?.user_metadata?.display_name as string | undefined) ||
        (user?.user_metadata?.full_name as string | undefined) ||
        '';
    const [name, setName] = useState(initial);
    const [focused, setFocused] = useState(false);
    const canContinue = name.trim().length > 0;

    const next = () => {
        if (!canContinue) return;
        patch({ display_name: name.trim() });
        router.push('/onboarding/photo');
    };

    return (
        <SetupFrame
            palette={palette}
            step={1}
            footer={
                <Pressable
                    onPress={next}
                    disabled={!canContinue}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: !canContinue ? 0.5 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canContinue }}
                >
                    <Text style={[s.primaryBtnText, { color: palette.textInverse }]}>Continue</Text>
                </Pressable>
            }
        >
            <Stack.Screen options={{ headerShown: false }} />
            <Text style={[s.heading, { color: palette.text }]}>A place for your good taste.</Text>
            <Text style={[s.description, { color: palette.textSecondary }]}>
                Keep the meals you loved and the places you want to try.
            </Text>
            <View style={[s.paper, Shadow.note, { backgroundColor: palette.surfaceNote }]}>
                <Text style={[s.label, { color: palette.textSecondary }]}>Your name</Text>
                <TextInput
                    value={name}
                    onChangeText={(t) => setName(t.slice(0, 80))}
                    maxLength={80}
                    placeholder="Name"
                    placeholderTextColor={palette.textMuted}
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="name"
                    textContentType="name"
                    returnKeyType="next"
                    onSubmitEditing={next}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    accessibilityLabel="Your name"
                    style={[s.input, { color: palette.text, borderBottomColor: focused ? palette.primary : palette.ruleInkSoft }]}
                />
            </View>
        </SetupFrame>
    );
}
