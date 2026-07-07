/**
 * Onboarding S2 — Profile photo (TICKET-126). Skippable.
 *
 * Tap the circle to pick from the library; the picked image is square-cropped to
 * 512² and uploaded to the avatars bucket (own-folder RLS), and its public URL is
 * written to the onboarding draft. Skip always visible → monogram fallback (the
 * same Avatar the rest of the app uses), avatar_url stays null. Continue/Skip → city.
 * Copy-economy: kicker + serif brandLine + one action; no prose.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/feed/Avatar';
import { compressAndUploadAvatar } from '@/lib/imageUpload';
import { onboardingStyles as s } from './styles';
import { useOnboardingDraft } from './OnboardingDraftContext';

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
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Photo access needed', 'Allow photo access to add a profile photo.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });
        if (result.canceled || !result.assets?.length) return;

        setUploading(true);
        try {
            const url = await compressAndUploadAvatar(result.assets[0].uri, user.id);
            patch({ avatar_url: url });
        } catch {
            Alert.alert("Couldn't add that photo", 'Please try another one.');
        } finally {
            setUploading(false);
        }
    };

    const goCity = () => {
        if (uploading) return;
        router.push('/onboarding/city');
    };

    const skip = () => {
        if (uploading) return;
        patch({ avatar_url: null });
        router.push('/onboarding/city');
    };

    return (
        <View style={[s.root, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[s.body, { paddingTop: insets.top + Spacing.xxl }]}>
                <Text style={[s.kicker, { color: palette.textMuted }]}>who you are</Text>
                <Text style={[s.brandLine, { color: palette.text }]}>your photo</Text>

                <View style={styles.stage}>
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
                                <View style={styles.uploadOverlay}>
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

                <Pressable onPress={skip} disabled={uploading} hitSlop={8} accessibilityRole="button">
                    <Text style={[s.skip, { color: palette.textMuted, alignSelf: 'center' }]}>Skip</Text>
                </Pressable>
            </View>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                <Pressable
                    onPress={goCity}
                    disabled={uploading}
                    style={({ pressed }) => [
                        s.primaryBtn,
                        { backgroundColor: palette.primary, opacity: uploading ? 0.5 : pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={s.primaryBtnText}>Continue</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    stage: {
        alignItems: 'center',
        gap: Spacing.lg,
        marginTop: Spacing.xl,
    },
    uploadOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 66,
        backgroundColor: 'rgba(28,28,25,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pickLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        letterSpacing: 0.2,
    },
});
