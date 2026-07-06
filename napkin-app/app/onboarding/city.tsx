/**
 * Onboarding S2 — Home city (TICKET-107).
 * Plain free-text (places-search is a restaurant Text Search — no cheap
 * `(cities)` autocomplete, so per the spec we take the free-text fallback).
 * Stored as the free-text profiles.home_city on completion. Skippable.
 * Next → S3 (import teach), carrying name + city.
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
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { onboardingStyles as s } from './styles';

export default function OnboardingCityScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { name } = useLocalSearchParams<{ name?: string }>();

    const [city, setCity] = useState('');

    const goTeach = (homeCity: string | null) => {
        router.push({
            pathname: '/onboarding/teach',
            params: { name: name ?? '', city: homeCity ?? '' },
        });
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
                    onSubmitEditing={() => goTeach(city.trim() || null)}
                    style={[s.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                />

                <Pressable onPress={() => goTeach(null)} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.skip, { color: palette.textMuted }]}>Skip</Text>
                </Pressable>
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={() => goTeach(city.trim() || null)}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={s.primaryBtnText}>Continue</Text>
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}
