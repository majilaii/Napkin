/**
 * /settings/photo — change or remove the profile photo.
 *
 * Tap the circle (or "Change photo") to pick from the library; the pick is
 * square-cropped to 512² and uploaded to the avatars bucket, then written to
 * the profile via useUpdateProfile. The write is optimistic — the new photo
 * appears instantly on every surface (this circle, the settings list, the
 * profile header) without waiting on a refetch. Changes apply immediately —
 * no Save button. "Remove photo" clears avatar_url (→ monogram) and deletes
 * the stored file.
 */
import React, { useState } from 'react';
import { View, Text, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { Avatar } from '@/components/feed/Avatar';
import { PillButton, PressableScale } from '@/components/ui/napkin';
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

    // busy covers the upload span (before the save's isPending kicks in);
    // update.isPending covers the save POST for BOTH pick and remove. Gating
    // every control on the union serializes mutations — you can't start a
    // second write (e.g. re-add) while a remove's save is still in flight, so
    // two optimistic patches / rollbacks can never race the same cache key.
    const working = busy || update.isPending;

    const pick = async () => {
        if (working || !user?.id) return;
        // SDK 54: the system library picker (PHPicker / Android Photo Picker) is
        // out-of-process and needs NO permission — awaiting a pre-gate was pure
        // latency. Launch straight away; a throw is the only failure to catch.
        let picked;
        try {
            picked = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85, // recompressed to 512² @0.8 on upload — no need for max here
            });
        } catch {
            Alert.alert("Couldn't open your library", 'Please try again.');
            return;
        }
        if (picked.canceled || !picked.assets?.length) return;

        // busy spans the whole op (upload + save) so the spinner never clears
        // early. mutateAsync's optimistic patch flips the avatar the moment the
        // save starts — the photo shows without waiting on a refetch.
        setBusy(true);
        const previous = avatarUrl;
        let uploaded: string | null = null;
        try {
            uploaded = await compressAndUploadAvatar(picked.assets[0].uri, user.id);
            await update.mutateAsync({ avatar_url: uploaded });
            // Saved — the replaced upload is now orphaned. Best-effort cleanup.
            if (previous && previous !== uploaded) {
                void removeUploadedAvatar(previous).catch(() => {});
            }
        } catch {
            // Upload OR save failed. If we uploaded but the save threw, the fresh
            // file is orphaned — clean it up (the hook already rolled the cache back).
            if (uploaded) void removeUploadedAvatar(uploaded).catch(() => {});
            Alert.alert("Couldn't save that photo", 'Please try again.');
        } finally {
            setBusy(false);
        }
    };

    const remove = () => {
        if (working || !avatarUrl) return;
        Alert.alert('Remove photo?', 'Your monogram will show instead.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    const previous = avatarUrl;
                    try {
                        await update.mutateAsync({ avatar_url: null });
                        void removeUploadedAvatar(previous).catch(() => {});
                    } catch {
                        Alert.alert("Couldn't remove that photo", 'Please try again.');
                    }
                },
            },
        ]);
    };

    return (
        <EditorScreen title="Photo">
            <View style={styles.stage}>
                {/* Portrait mounted on a warm vellum plate — the centerpiece.
                    Structure comes from the background shift + ambient shadow,
                    never a border. Tapping the plate opens the library. */}
                <PressableScale
                    onPress={pick}
                    disabled={working}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel="Choose a profile photo"
                    style={[styles.plate, { backgroundColor: palette.surfaceJournalLow }]}
                >
                    <View>
                        <Avatar name={name} url={avatarUrl} size={132} palette={palette} />
                        {working ? (
                            <View style={[styles.overlay, { backgroundColor: palette.scrimDark }]}>
                                <ActivityIndicator color={palette.textInverse} />
                            </View>
                        ) : (
                            <View
                                style={[
                                    styles.badge,
                                    { backgroundColor: palette.primary, borderColor: palette.surfaceJournalLow },
                                ]}
                            >
                                <Ionicons name="camera-outline" size={18} color={palette.textInverse} />
                            </View>
                        )}
                    </View>
                </PressableScale>

                <View style={styles.actions}>
                    <PillButton filled={false} onPress={pick} disabled={working}>
                        {avatarUrl ? 'Change photo' : 'Add a photo'}
                    </PillButton>

                    {avatarUrl ? (
                        <PressableScale onPress={remove} disabled={working} haptic="selection" accessibilityRole="button">
                            <Text style={[styles.remove, { color: palette.textMuted }]}>Remove photo</Text>
                        </PressableScale>
                    ) : null}
                </View>
            </View>
        </EditorScreen>
    );
}

const styles = StyleSheet.create({
    stage: {
        alignItems: 'center',
        gap: Spacing.xl,
        marginTop: Spacing.xxl,
    },
    plate: {
        padding: Spacing.xl,
        borderRadius: Radius.xxxl,
        alignItems: 'center',
        justifyContent: 'center',
        ...Shadow.ambient,
    },
    actions: {
        alignItems: 'center',
        gap: Spacing.md,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 66,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badge: {
        position: 'absolute',
        right: 2,
        bottom: 2,
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    remove: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        letterSpacing: 0.2,
    },
});
