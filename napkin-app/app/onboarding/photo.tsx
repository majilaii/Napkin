/**
 * Onboarding S2 — MANDATORY moderated profile photo (TICKET-196 B-1).
 *
 * Tap the circle to pick from the library; the picked image is square-cropped to
 * 512², privately staged, moderated, and its approved public URL is written to
 * the onboarding draft. Continue stays blocked until an approved photo exists.
 *
 * NO SKIP — founder call 2026-07-25: faces are what make the app feel alive, so
 * nobody reaches the feed without one.
 *
 * History worth keeping: Skip existed because the Vision moderation credential
 * was never provisioned, so `action=moderate` 503'd (`VISION_UNAVAILABLE`) on
 * EVERY upload and a mandatory avatar hard-walled signup for everyone (#318).
 * The credential is now live, so the wall is safe to re-arm — but that is the
 * single dependency this screen has. If Vision ever goes down again, this
 * screen blocks all new accounts. Downtime is therefore reported as a
 * RETRYABLE error, never as a silent pass-through: the user is told to try
 * again, and the mandate holds.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/feed/Avatar';
import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { isModerationRejected, stageAndModerate } from '@/lib/imageStaging';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';
import { OnboardingProgress } from './OnboardingProgress';

function isVisionUnavailable(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 3 && current; depth += 1) {
        const candidate = current as { code?: unknown; cause?: unknown };
        if (candidate.code === 'VISION_UNAVAILABLE') return true;
        current = candidate.cause;
    }
    return false;
}

export default function OnboardingPhotoScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { draft, patch } = useOnboardingDraft();

    const [uploading, setUploading] = useState(false);

    const pick = async () => {
        if (uploading || !user?.id) return;
        // Instant source sheet (Take photo / Choose from library); uploading
        // goes up the moment a source is chosen so the spinner covers the
        // system picker's presentation gap.
        const asset = await chooseAvatarAsset(() => setUploading(true));
        if (!asset) {
            setUploading(false);
            return;
        }

        try {
            const approved = await stageAndModerate(asset.uri, 'avatar');
            patch({ avatar_url: approved.approved_url });
        } catch (error) {
            if (isVisionUnavailable(error)) {
                // Retryable, NOT a pass — the mandate holds through downtime.
                Alert.alert('Photo check is down right now', 'Please try again in a moment.');
                return;
            }
            Alert.alert(
                isModerationRejected(error) ? "That photo can't be used" : "Couldn't add that photo",
                isModerationRejected(error) ? 'Choose another photo.' : 'Please try again.',
            );
        } finally {
            setUploading(false);
        }
    };

    const goCity = () => {
        if (uploading || !draft.avatar_url) return;
        router.push('/onboarding/city');
    };

    return (
        <View style={[s.root, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <OnboardingProgress step={2} palette={palette} />
                <Text style={[s.kicker, { color: palette.textMuted }]}>who you are</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>your photo</Text>

                <View
                    style={[
                        styles.stage,
                        { backgroundColor: palette.surfaceJournal },
                        Shadow.ambient,
                    ]}
                >
                    <Pressable
                        onPress={pick}
                        disabled={uploading}
                        accessibilityRole="button"
                        accessibilityLabel="Choose a profile photo"
                    >
                        <View>
                            <Avatar
                                name={draft.display_name || 'You'}
                                url={draft.avatar_url}
                                size={132}
                                palette={palette}
                            />
                            {uploading && (
                                <View style={[styles.uploadOverlay, { backgroundColor: palette.scrimDark }]}>
                                    <ActivityIndicator color={palette.textInverse} />
                                </View>
                            )}
                        </View>
                    </Pressable>

                    <Pressable onPress={pick} disabled={uploading} hitSlop={8} accessibilityRole="button">
                        <Text style={[styles.pickLabel, { color: palette.primary }]}>
                            {draft.avatar_url ? 'Change photo' : 'Add a photo'}
                        </Text>
                    </Pressable>
                </View>

            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={goCity}
                    disabled={uploading || !draft.avatar_url}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        {
                            backgroundColor: palette.primary,
                            opacity: uploading || !draft.avatar_url ? 0.5 : pressed ? 0.85 : 1,
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Continue"
                    accessibilityState={{ disabled: uploading || !draft.avatar_url }}
                >
                    <Text style={s.primaryBtnText}>Continue</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    /**
     * A warm plate under the avatar. Without it the circle floated on bare
     * cream and the screen read as unfinished — which is the wrong feel for the
     * one step you cannot skip. Same card language as Settings.
     */
    stage: {
        alignItems: 'center',
        gap: Spacing.lg,
        marginTop: Spacing.md,
        paddingVertical: Spacing.xxl,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.xl,
    },
    uploadOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 66,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pickLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        letterSpacing: 0.2,
    },
});
