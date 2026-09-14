/**
 * Onboarding S1 — the name step. OPTIONAL, and skipped outright when a provider
 * already told us the name.
 *
 * App Store Guideline 4, rejection 2026-09-14: "users are required to provide
 * their name and/or email address after using Sign in with Apple even though
 * that information is already provided by the Authentication Services
 * framework." Two things had to change, and both matter:
 *
 *   1. USE WHAT APPLE GAVE US. auth.tsx now captures the native credential's
 *      fullName (Apple sends it exactly once, out-of-band, never in the identity
 *      token) and persists it. When useProvidedDisplayName resolves a name, this
 *      screen never renders — it seeds the draft and moves straight to the photo
 *      step.
 *   2. NEVER BLOCK ON IT. Apple only sends the name on the FIRST authorization,
 *      so a reviewer whose Apple ID already authorized Napkin gets null and no
 *      persistence can recover it. The old `canContinue = name.trim().length > 0`
 *      made Continue conditional on typing a name, which Guideline 5.1.1(x)
 *      forbids: a contact-info request is allowed only when it is "optional for
 *      the user" and "features and services are not conditional on providing the
 *      information". Continue is now always enabled and there is a skip.
 *
 * An empty name reaches complete_onboarding as NULL, never '' —
 * fn_complete_onboarding leaves profiles.display_name untouched on NULL and
 * RAISES invalid_display_name on a non-null blank.
 *
 * Do NOT pass SetupFrame's `optional` prop here. It is not a generic "this step
 * may be skipped" flag — OnboardingProgress uses it as the follows-step COPY
 * switch, and it relabels the header "People you know / Optional". The city step
 * is skippable too and likewise does not pass it; a skippable step signals
 * itself with "Maybe later", which is all this one needs.
 *
 * Name stays in the setup draft until final, atomic completion.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Colors, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SetupFrame } from '@/components/onboarding/SetupFrame';
import { useProvidedDisplayName } from '@/hooks/onboarding/useProvidedDisplayName';
import { MAX_DISPLAY_NAME } from '@/lib/onboardingName';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';

export default function OnboardingNameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { draft, patch } = useOnboardingDraft();
    const provided = useProvidedDisplayName();
    const [name, setName] = useState(draft.display_name);
    const [focused, setFocused] = useState(false);

    // A provider already gave us the name — take it and go. Never ask.
    useEffect(() => {
        if (!provided) return;
        patch({ display_name: provided });
        router.replace('/onboarding/photo');
    }, [provided, patch, router]);

    const next = () => {
        patch({ display_name: name.trim() });
        router.push('/onboarding/photo');
    };

    // Distinct from `next`: Maybe later DISCARDS whatever is in the field. Sharing
    // next's handler would quietly save a half-typed name the user just declined
    // to give, which is the opposite of what the control says.
    const skip = () => {
        patch({ display_name: '' });
        router.push('/onboarding/photo');
    };

    // `undefined` = still resolving; `string` = skipping. Either way, do not
    // flash a form asking for something we are about to fill in ourselves.
    if (provided !== null) return null;

    return (
        <SetupFrame
            palette={palette}
            step={1}
            footer={
                <>
                    <Pressable
                        onPress={next}
                        style={({ pressed }) => [
                            s.primaryBtn,
                            { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                        ]}
                        accessibilityRole="button"
                    >
                        <Text style={[s.primaryBtnText, { color: palette.textInverse }]}>Continue</Text>
                    </Pressable>
                    <Pressable
                        onPress={skip}
                        style={s.skipButton}
                        accessibilityRole="button"
                        accessibilityLabel="Skip your name"
                    >
                        <Text style={[s.skip, { color: palette.textSecondary }]}>Maybe later</Text>
                    </Pressable>
                </>
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
                    onChangeText={(t) => setName(t.slice(0, MAX_DISPLAY_NAME))}
                    maxLength={MAX_DISPLAY_NAME}
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
