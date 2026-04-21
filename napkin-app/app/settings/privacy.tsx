/**
 * Privacy settings screen — /settings/privacy
 *
 * Shows:
 *   - Current account visibility state
 *   - "Preview my profile" link (always routes to /u/[currentUserId])
 *   - Toggle action button (goes public / goes private)
 *   - Reply permission segmented control
 *   - Inline editors: display name, username, avatar URL, bio
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    TextInput,
    Alert,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useUserProfile,
    useUpdatePrivacy,
    useUpdateProfile,
    useUpdateReplyPermission,
} from '@/hooks/users';

export default function PrivacyScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: result, isLoading } = useUserProfile(user?.id);
    const profile = result?.data?.profile;

    const updatePrivacy = useUpdatePrivacy(user?.id);
    const updateProfile = useUpdateProfile(user?.id);
    const updateReplyPermission = useUpdateReplyPermission(user?.id);

    // Local editor state (saved on blur)
    const [displayName, setDisplayName] = useState('');
    const [bio, setBio] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    // Sync local state when profile loads
    React.useEffect(() => {
        if (profile) {
            setDisplayName(profile.display_name ?? '');
            setBio(profile.bio ?? '');
            setAvatarUrl(profile.avatar_url ?? '');
        }
    }, [profile?.user_id]);

    if (isLoading || !profile) {
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    const isPublic = profile.account_privacy === 'public';

    const handleMakePublic = () => {
        if (!isPublic && !profile.username) {
            // First flip: needs username — route to make-public screen
            router.push('/settings/privacy/make-public');
        } else if (!isPublic && profile.username) {
            // Subsequent public flip: lightweight confirm
            Alert.alert(
                'Make profile public again?',
                'Your public lists, recently logged restaurants, and stats will become visible.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Make public',
                        onPress: () => updatePrivacy.mutate({ account_privacy: 'public' }),
                    },
                ],
            );
        }
    };

    const handleMakePrivate = () => {
        Alert.alert(
            'Make your profile private?',
            'Your public lists will be hidden and your reviews will no longer appear on restaurant pages.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Make private',
                    style: 'destructive',
                    onPress: () => updatePrivacy.mutate({ account_privacy: 'private' }),
                },
            ],
        );
    };

    const handleDisplayNameBlur = () => {
        const trimmed = displayName.trim();
        if (trimmed && trimmed !== profile.display_name) {
            updateProfile.mutate({ display_name: trimmed });
        }
    };

    const handleBioBlur = () => {
        const trimmed = bio.trim() || null;
        if (trimmed !== profile.bio) {
            updateProfile.mutate({ bio: trimmed });
        }
    };

    const handleAvatarUrlBlur = () => {
        const trimmed = avatarUrl.trim() || null;
        if (trimmed !== profile.avatar_url) {
            updateProfile.mutate({ avatar_url: trimmed });
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top + Spacing.sm }]}>
            {/* Top bar */}
            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12}>
                    <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                </Pressable>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                <Text style={[Type.displaySmall, { color: palette.text }]}>Privacy</Text>

                {/* Current state banner */}
                <View style={[styles.stateBanner, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[Type.body, { color: palette.text }]}>
                        {isPublic
                            ? 'Your profile is public — anyone with the link can browse your palate.'
                            : 'Your profile is private — only your Tables see you.'}
                    </Text>
                    {/* Preview link */}
                    <Pressable
                        onPress={() => router.push(`/u/${user?.id}`)}
                        style={{ marginTop: Spacing.sm }}
                    >
                        <Text style={[Type.bodySmall, { color: palette.primary }]}>
                            Preview my profile →
                        </Text>
                    </Pressable>
                </View>

                {/* Toggle action */}
                <Pressable
                    onPress={isPublic ? handleMakePrivate : handleMakePublic}
                    disabled={updatePrivacy.isPending}
                    style={({ pressed }) => [
                        styles.toggleButton,
                        {
                            backgroundColor: isPublic
                                ? palette.surfaceContainerLow
                                : palette.primary,
                            opacity: pressed || updatePrivacy.isPending ? 0.8 : 1,
                        },
                    ]}
                >
                    {updatePrivacy.isPending ? (
                        <ActivityIndicator color={isPublic ? palette.text : palette.textInverse} />
                    ) : (
                        <Text
                            style={[
                                Type.titleMedium,
                                { color: isPublic ? palette.text : palette.textInverse },
                            ]}
                        >
                            {isPublic ? 'Make profile private' : 'Make profile public'}
                        </Text>
                    )}
                </Pressable>

                {/* Reply permission segmented control */}
                <View style={styles.section}>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                        Who can reply to my public reviews?
                    </Text>
                    {!isPublic && (
                        <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                            Turn on public profile to change this
                        </Text>
                    )}
                    <View style={[styles.segmentedControl, { marginTop: Spacing.sm }]}>
                        {(['false', 'true'] as const).map((val) => {
                            const isActive =
                                val === 'true'
                                    ? profile.allow_public_replies === true
                                    : profile.allow_public_replies !== true;
                            const label = val === 'false' ? 'Nobody (emoji only)' : 'Anyone';
                            return (
                                <Pressable
                                    key={val}
                                    disabled={!isPublic || updateReplyPermission.isPending}
                                    onPress={() => {
                                        if (isPublic) {
                                            updateReplyPermission.mutate(val === 'true');
                                        }
                                    }}
                                    style={[
                                        styles.segment,
                                        {
                                            backgroundColor: isActive
                                                ? palette.primary
                                                : palette.surfaceContainerLow,
                                            opacity: !isPublic ? 0.5 : 1,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            Type.caption,
                                            { color: isActive ? palette.textInverse : palette.textSecondary },
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* Profile editors */}
                <View style={styles.section}>
                    <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                        Profile info
                    </Text>

                    {/* Display name */}
                    <Text style={[Type.caption, { color: palette.textMuted }]}>Display name</Text>
                    <TextInput
                        value={displayName}
                        onChangeText={setDisplayName}
                        onBlur={handleDisplayNameBlur}
                        style={[styles.input, { color: palette.text, borderColor: palette.outlineVariant }]}
                        maxLength={80}
                        returnKeyType="done"
                    />

                    {/* Username */}
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.md }]}>
                        Username {profile.username ? `(@${profile.username})` : '(not set)'}
                    </Text>
                    {profile.username && (
                        <Pressable
                            onPress={() => router.push('/settings/privacy/make-public')}
                            style={{ marginTop: 2 }}
                        >
                            <Text style={[Type.caption, { color: palette.primary }]}>
                                Change username →
                            </Text>
                        </Pressable>
                    )}

                    {/* Avatar URL */}
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.md }]}>
                        Avatar URL
                    </Text>
                    <TextInput
                        value={avatarUrl}
                        onChangeText={setAvatarUrl}
                        onBlur={handleAvatarUrlBlur}
                        style={[styles.input, { color: palette.text, borderColor: palette.outlineVariant }]}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder="https://..."
                        placeholderTextColor={palette.textMuted}
                        returnKeyType="done"
                    />

                    {/* Bio */}
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.md }]}>
                        Bio ({bio.length}/160)
                    </Text>
                    <TextInput
                        value={bio}
                        onChangeText={(t) => setBio(t.slice(0, 160))}
                        onBlur={handleBioBlur}
                        style={[styles.input, styles.bioInput, { color: palette.text, borderColor: palette.outlineVariant }]}
                        multiline
                        maxLength={160}
                        returnKeyType="default"
                    />
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    scrollContent: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    stateBanner: {
        marginTop: Spacing.lg,
        padding: Spacing.md,
        borderRadius: Radius.md,
    },
    toggleButton: {
        marginTop: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
    section: {
        marginTop: Spacing.xl,
    },
    segmentedControl: {
        flexDirection: 'row',
        borderRadius: Radius.md,
        overflow: 'hidden',
        gap: 1,
    },
    segment: {
        flex: 1,
        paddingVertical: Spacing.sm,
        alignItems: 'center',
        borderRadius: Radius.sm,
    },
    input: {
        marginTop: Spacing.xs,
        borderWidth: 1,
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.sm,
        fontSize: 15,
    },
    bioInput: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
});
