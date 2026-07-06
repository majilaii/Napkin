/**
 * Onboarding S3 — Import teach (TICKET-107).
 * ONE card, a theme-built static illustration of the share-sheet flow (NO
 * TikTok screenshots — built from theme components), the single allowed
 * sentence of copy, primary CTA "Done" → complete onboarding → /wishlist.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCompleteOnboarding } from '@/hooks/onboarding/useCompleteOnboarding';
import { onboardingStyles as s } from './styles';

export default function OnboardingTeachScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { name, city } = useLocalSearchParams<{ name?: string; city?: string }>();
    const complete = useCompleteOnboarding();

    const finish = () => {
        if (complete.isPending) return;
        const display_name =
            (name && name.trim()) ||
            (user?.user_metadata?.display_name as string | undefined) ||
            'New User';
        complete.mutate(
            { display_name, home_city: city && city.trim() ? city.trim() : null },
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

                {/* Theme-built share-sheet illustration — no external screenshots. */}
                <View style={[styles.card, { backgroundColor: palette.surfaceNote }, Shadow.note]}>
                    <View style={styles.flowRow}>
                        <View style={[styles.chip, { backgroundColor: palette.surfaceJournalHi }]}>
                            <Ionicons name="play-circle-outline" size={22} color={palette.textSecondary} />
                            <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>a video</Text>
                        </View>
                        <Ionicons name="arrow-forward" size={16} color={palette.textMuted} />
                        <View style={[styles.chip, { backgroundColor: palette.surfaceJournalHi }]}>
                            <Ionicons name="share-outline" size={22} color={palette.textSecondary} />
                            <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>share</Text>
                        </View>
                        <Ionicons name="arrow-forward" size={16} color={palette.textMuted} />
                        <View style={[styles.chip, { backgroundColor: palette.primaryMuted }]}>
                            <Ionicons name="bookmark" size={20} color={palette.primary} />
                            <Text style={[styles.chipLabel, { color: palette.primary }]}>napkin</Text>
                        </View>
                    </View>
                    <Text style={[styles.sentence, { color: palette.textSecondary }]}>
                        Saw a spot on TikTok? Share it to Napkin.
                    </Text>
                </View>
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
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={s.primaryBtnText}>Done</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.xl,
        padding: 22,
        gap: 18,
    },
    flowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
    },
    chip: {
        alignItems: 'center',
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderRadius: Radius.md,
        flex: 1,
    },
    chipLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.2,
    },
    sentence: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 26,
        textAlign: 'center',
    },
});
