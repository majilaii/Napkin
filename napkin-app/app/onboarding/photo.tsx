/**
 * Onboarding S2 — moderated profile photo (TICKET-196 B-1), skippable.
 *
 * Tap the circle to pick from the library; the picked image is square-cropped to
 * 512², privately staged, moderated, and its approved public URL is written to
 * the onboarding draft. Continue needs an approved photo; "Maybe later" moves on
 * without one (avatar_url stays null, which complete_onboarding accepts).
 *
 * TICKET-250 reversed the 2026-07-25 no-skip call for App Review: Guideline
 * 5.1.1(v) (the rule behind rejection #4) forbids requiring personal information
 * the app does not need to function, and a mandatory photo also forced every new
 * user to send a picture of themselves to Google Cloud Vision (5.1.2(i)). To
 * restore the mandate, remove the Maybe later control; the server-side
 * avatar_required check stays flag-gated either way.
 *
 * Back is conditional: when a provider already supplied the name, S1 skips itself
 * with `router.replace`, which leaves this screen alone in the onboarding stack.
 * SetupFrame renders a spacer instead of a dead arrow when `onBack` is undefined.
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
import { useRouter, Stack } from 'expo-router';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/feed/Avatar';
import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { isModerationRejected, stageAndModerate } from '@/lib/imageStaging';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';
import { SetupFrame } from '@/components/onboarding/SetupFrame';
import { Ionicons } from '@expo/vector-icons';

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

    const skip = () => {
        if (uploading) return;
        router.push('/onboarding/city');
    };

    return (
        <SetupFrame
            palette={palette}
            step={2}
            onBack={router.canGoBack() ? () => router.back() : undefined}
            backDisabled={uploading}
            footer={
                <>
                    <Pressable
                        onPress={goCity}
                        disabled={uploading || !draft.avatar_url}
                        style={({ pressed }) => [
                            s.primaryBtn,
                            { backgroundColor: palette.primary, opacity: uploading || !draft.avatar_url ? 0.5 : pressed ? 0.85 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Continue"
                        accessibilityState={{ disabled: uploading || !draft.avatar_url }}
                    >
                        <Text style={[s.primaryBtnText, { color: palette.textInverse }]}>Continue</Text>
                    </Pressable>
                    {!draft.avatar_url ? (
                        <Pressable
                            onPress={skip}
                            disabled={uploading}
                            style={s.skipButton}
                            accessibilityRole="button"
                            accessibilityLabel="Skip profile photo"
                            accessibilityState={{ disabled: uploading }}
                        >
                            <Text style={[s.skip, { color: palette.textSecondary }]}>Maybe later</Text>
                        </Pressable>
                    ) : null}
                </>
            }
        >
            <Stack.Screen options={{ headerShown: false }} />
            <Text style={[s.heading, { color: palette.text }]}>Put a face to your taste.</Text>
            <Text style={[s.description, { color: palette.textSecondary }]}>
                A photo helps your friends find you.
            </Text>
            <View style={[styles.stage, Shadow.note, { backgroundColor: palette.surfaceNote }]}>
                <Text style={[s.label, { color: palette.textMuted }]}>Your journal</Text>
                <Pressable
                    onPress={pick}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a profile photo"
                    accessibilityState={{ disabled: uploading, busy: uploading }}
                    style={styles.avatarControl}
                >
                    <Avatar name={draft.display_name || 'You'} url={draft.avatar_url} size={128} palette={palette} />
                    {uploading ? (
                        <View style={[styles.uploadOverlay, { backgroundColor: palette.scrimDark }]}>
                            <ActivityIndicator color={palette.textOnImage} />
                        </View>
                    ) : (
                        <View style={[styles.cameraBadge, { backgroundColor: palette.primary }]}>
                            <Ionicons name="camera-outline" size={Spacing.lg} color={palette.textInverse} />
                        </View>
                    )}
                </Pressable>
                <Text style={[styles.name, { color: palette.text }]}>{draft.display_name || 'Your journal'}</Text>
                <Pressable
                    onPress={pick}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: uploading }}
                    style={({ pressed }) => [styles.pickButton, { backgroundColor: palette.primaryMuted, opacity: uploading ? 0.5 : pressed ? 0.85 : 1 }]}
                >
                    <Text style={[styles.pickLabel, { color: palette.primary }]}>
                        {uploading ? 'Checking photo…' : draft.avatar_url ? 'Change photo' : 'Add a photo'}
                    </Text>
                </Pressable>
                <Text style={[styles.checkNote, { color: palette.textMuted }]}>
                    Google Cloud Vision checks each photo before anyone sees it.
                </Text>
            </View>
        </SetupFrame>
    );
}

const styles = StyleSheet.create({
    stage: {
        alignItems: 'center',
        padding: Spacing.lg,
        paddingVertical: Spacing.xl,
        borderRadius: Radius.xl,
    },
    avatarControl: { marginTop: Spacing.md },
    uploadOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cameraBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: Spacing.hitTarget,
        height: Spacing.hitTarget,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    name: { ...Type.headlineLarge, textAlign: 'center', marginTop: Spacing.lg },
    pickButton: {
        minHeight: Spacing.hitTarget,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        marginTop: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pickLabel: { ...Type.titleMedium },
    checkNote: { ...Type.metadata, textAlign: 'center', marginTop: Spacing.md },
});
