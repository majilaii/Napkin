/**
 * /settings/photo — change or remove the profile photo.
 *
 * Tap the circle (or "Change photo") to pick from the library; the pick is
 * square-cropped to 512² and uploaded to the avatars bucket, then written to
 * the profile via useUpdateProfile. Changes apply immediately — no Save button.
 * "Remove photo" clears avatar_url (→ monogram) and deletes the stored file.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { Avatar } from '@/components/feed/Avatar';
import { EditorScreen } from '@/components/settings';
import { compressAndUploadAvatar, removeUploadedAvatar } from '@/lib/imageUpload';

export default function EditPhotoScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const update = useUpdateProfile(user?.id);

    const [busy, setBusy] = useState(false);
    const avatarUrl = profile?.avatar_url ?? null;
    const name = profile?.display_name || 'You';

    const pick = async () => {
        if (busy || !user?.id) return;
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Photo access needed', 'Allow photo access to add a profile photo.');
            return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });
        if (picked.canceled || !picked.assets?.length) return;

        setBusy(true);
        try {
            const previous = avatarUrl;
            const url = await compressAndUploadAvatar(picked.assets[0].uri, user.id);
            update.mutate(
                { avatar_url: url },
                {
                    onSuccess: () => {
                        // Best-effort: the replaced upload is now orphaned.
                        if (previous && previous !== url) {
                            void removeUploadedAvatar(previous).catch(() => {});
                        }
                    },
                    onError: () => {
                        // Save failed — don't leave the fresh upload orphaned.
                        void removeUploadedAvatar(url).catch(() => {});
                        Alert.alert("Couldn't save that photo", 'Please try again.');
                    },
                },
            );
        } catch {
            Alert.alert("Couldn't add that photo", 'Please try another one.');
        } finally {
            setBusy(false);
        }
    };

    const remove = () => {
        if (busy || !avatarUrl) return;
        Alert.alert('Remove photo?', 'Your monogram will show instead.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => {
                    const previous = avatarUrl;
                    update.mutate(
                        { avatar_url: null },
                        {
                            onSuccess: () => {
                                void removeUploadedAvatar(previous).catch(() => {});
                            },
                            onError: () => {
                                Alert.alert("Couldn't remove that photo", 'Please try again.');
                            },
                        },
                    );
                },
            },
        ]);
    };

    const working = busy || update.isPending;

    return (
        <EditorScreen title="Photo">
            <View style={styles.stage}>
                <Pressable
                    onPress={pick}
                    disabled={working}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a profile photo"
                >
                    <View>
                        <Avatar name={name} url={avatarUrl} size={132} palette={palette} />
                        {working ? (
                            <View style={[styles.overlay, { backgroundColor: palette.scrimDark }]}>
                                <ActivityIndicator color={palette.textInverse} />
                            </View>
                        ) : null}
                    </View>
                </Pressable>

                <Pressable onPress={pick} disabled={working} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.action, { color: palette.primary }]}>
                        {avatarUrl ? 'Change photo' : 'Add a photo'}
                    </Text>
                </Pressable>

                {avatarUrl ? (
                    <Pressable onPress={remove} disabled={working} hitSlop={8} accessibilityRole="button">
                        <Text style={[styles.action, { color: palette.textMuted }]}>Remove photo</Text>
                    </Pressable>
                ) : null}
            </View>
        </EditorScreen>
    );
}

const styles = StyleSheet.create({
    stage: {
        alignItems: 'center',
        gap: Spacing.lg,
        marginTop: Spacing.xxl,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 66,
        alignItems: 'center',
        justifyContent: 'center',
    },
    action: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        letterSpacing: 0.2,
    },
});
