/**
 * Onboarding S3 — Home city (TICKET-107; v2 TICKET-126).
 * Plain free-text (places-search is a restaurant Text Search — no cheap
 * `(cities)` autocomplete, so per the spec we take the free-text fallback).
 * Stored as the free-text profiles.home_city on completion. Skippable.
 *
 * Also the branch point for the conditional Follows step: co-diner candidates are
 * prefetched on entry (useCoDiners, 5-min stale) so that on Continue/Skip we can
 * route candidates>0 → follows, else → teach. If the fetch hasn't resolved yet we
 * await it (isFetched gate) before branching, so we never mis-skip; follows.tsx
 * self-advances to teach as a second safety net.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';

export default function OnboardingCityScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { draft, patch } = useOnboardingDraft();

    const [city, setCity] = useState(draft.home_city ?? '');
    const [branching, setBranching] = useState(false);

    // Prefetch on entry — populates queryKeys.feed.coDiners so the branch below
    // (and the follows screen) reads a warm cache.
    const coDiners = useCoDiners(user?.id);

    const proceed = async (homeCity: string | null) => {
        if (branching) return;
        patch({ home_city: homeCity });

        // Resolve candidates before branching. Almost always already fetched
        // (fast RPC, 5-min stale) — only await on the rare cold race.
        let candidates = coDiners.data ?? [];
        if (!coDiners.isFetched) {
            setBranching(true);
            try {
                // 4s cap: a hung network must never wedge onboarding — on timeout
                // fall through to teach (worst case: the follows step is skipped).
                const r = await Promise.race([
                    coDiners.refetch(),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
                ]);
                candidates = r?.data ?? [];
            } catch {
                candidates = [];
            } finally {
                setBranching(false);
            }
        }

        router.push(candidates.length > 0 ? '/onboarding/follows' : '/onboarding/teach');
    };

    return (
        <KeyboardAvoidingView
            style={[s.root, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <Text style={[s.kicker, { color: palette.textMuted }]}>where you eat</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>your home city</Text>

                <Text style={[s.label, { color: palette.textSecondary }]}>Home city</Text>
                <TextInput
                    value={city}
                    onChangeText={(t) => setCity(t.slice(0, 120))}
                    placeholder="e.g. Hong Kong"
                    placeholderTextColor={palette.textMuted}
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={() => proceed(city.trim() || null)}
                    style={[s.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                />

                <Pressable onPress={() => proceed(null)} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.skip, { color: palette.textMuted }]}>Skip</Text>
                </Pressable>
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={() => proceed(city.trim() || null)}
                    disabled={branching}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: branching ? 0.6 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    {branching ? (
                        <ActivityIndicator color={palette.textInverse} />
                    ) : (
                        <Text style={s.primaryBtnText}>Continue</Text>
                    )}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}
