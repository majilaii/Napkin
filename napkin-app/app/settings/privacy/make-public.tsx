/**
 * /settings/privacy/make-public — first-flip warning + username claim.
 *
 * Shows two lists (what becomes visible / what stays private) and a
 * username field. On confirm, atomically writes account_privacy='public'
 * and username in a single server call.
 *
 * TICKET-126: onboarding now completes accounts as public with NO username
 * (public-by-default doctrine, no handle captured in onboarding). Such a user
 * still needs to claim a handle later — so the mount guard only bounces when
 * ALREADY public AND a username is set (nothing left to do). When public but
 * handleless, this screen becomes a pure username-claim (the "what becomes
 * public" explainer is dropped — that flip already happened).
 */
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Pressable,
    TextInput,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdatePrivacy, useCheckUsername } from '@/hooks/users';
import { FirstFlipBody } from '@/components/settings/FirstFlipBody';

type UsernameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function MakePublicScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const updatePrivacy = useUpdatePrivacy(user?.id);
    const checkUsername = useCheckUsername();

    const [username, setUsername] = useState('');
    const [usernameState, setUsernameState] = useState<UsernameState>('idle');

    // Public with a handle already set → nothing to do here (guard).
    // Public WITHOUT a handle (post-onboarding) → stay, this becomes a claim.
    const alreadyPublic = profile?.account_privacy === 'public';
    useEffect(() => {
        if (profile?.account_privacy === 'public' && profile?.username) {
            router.replace('/settings/privacy');
        }
    }, [profile?.account_privacy, profile?.username]);

    // Reset username state when username field changes
    const handleUsernameChange = (text: string) => {
        // Force lowercase and strip invalid chars
        const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
        setUsername(clean);
        setUsernameState('idle');
    };

    const handleUsernameBlur = async () => {
        if (!username) {
            setUsernameState('idle');
            return;
        }
        const usernameFormat = /^[a-z][a-z0-9_]{2,23}$/;
        if (!usernameFormat.test(username)) {
            setUsernameState('invalid');
            return;
        }
        setUsernameState('checking');
        try {
            const res = await checkUsername.mutateAsync(username);
            setUsernameState(res.available ? 'available' : 'taken');
        } catch {
            setUsernameState('idle');
        }
    };

    const canConfirm =
        usernameState === 'available' && username.length >= 3 && !updatePrivacy.isPending;

    const handleConfirm = async () => {
        if (!canConfirm) return;
        try {
            await updatePrivacy.mutateAsync({ account_privacy: 'public', username });
            router.replace('/settings/privacy');
        } catch {
            // Error is surfaced via updatePrivacy.error if needed
        }
    };

    const usernameHint = () => {
        switch (usernameState) {
            case 'checking': return 'Checking…';
            case 'available': return 'Username available';
            case 'taken': return 'Already taken';
            case 'invalid': return 'Must be 3–24 chars, start with a letter, lowercase letters / numbers / underscores only';
            default: return '';
        }
    };

    const hintColor = () => {
        switch (usernameState) {
            case 'available': return palette.success;
            case 'taken':
            case 'invalid': return palette.error;
            default: return palette.textMuted;
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
                {/* Title */}
                <Text
                    style={[
                        Type.displaySmall,
                        {
                            color: palette.text,
                            fontFamily: 'Newsreader_400Regular_Italic',
                            marginBottom: Spacing.lg,
                        },
                    ]}
                >
                    {alreadyPublic ? 'Your username' : 'Make your profile public?'}
                </Text>

                {/* Two-list body — only for the actual private→public flip. */}
                {!alreadyPublic && <FirstFlipBody />}

                {/* Username field */}
                <View style={styles.usernameSection}>
                    <Text style={[Type.titleSmall, { color: palette.text, marginBottom: Spacing.sm }]}>
                        Choose a username
                    </Text>
                    <Text style={[Type.caption, { color: palette.textMuted, marginBottom: Spacing.sm }]}>
                        Your public profile will be at napkin.app/u/username
                    </Text>
                    <View style={[styles.usernameInputRow, { borderColor: palette.outlineVariant }]}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>@</Text>
                        <TextInput
                            value={username}
                            onChangeText={handleUsernameChange}
                            onBlur={handleUsernameBlur}
                            style={[styles.usernameInput, { color: palette.text }]}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="yourname"
                            placeholderTextColor={palette.textMuted}
                            returnKeyType="done"
                            onSubmitEditing={handleUsernameBlur}
                        />
                        {usernameState === 'checking' && (
                            <ActivityIndicator size="small" color={palette.textMuted} />
                        )}
                    </View>
                    {usernameHint() ? (
                        <Text style={[Type.caption, { color: hintColor(), marginTop: Spacing.xs }]}>
                            {usernameHint()}
                        </Text>
                    ) : null}
                </View>

                {/* Error from mutation */}
                {updatePrivacy.error && (
                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.sm }]}>
                        {updatePrivacy.error.message}
                    </Text>
                )}

                {/* Action buttons */}
                <View style={styles.buttons}>
                    <Pressable
                        onPress={() => router.back()}
                        style={({ pressed }) => [
                            styles.cancelButton,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerHigh
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        <Text style={[Type.titleMedium, { color: palette.text }]}>
                            {alreadyPublic ? 'Cancel' : 'Keep it private'}
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={handleConfirm}
                        disabled={!canConfirm}
                        style={({ pressed }) => [
                            styles.confirmButton,
                            {
                                backgroundColor: canConfirm
                                    ? pressed
                                        ? palette.primaryContainer
                                        : palette.primary
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        {updatePrivacy.isPending ? (
                            <ActivityIndicator color={palette.textInverse} />
                        ) : (
                            <Text
                                style={[
                                    Type.titleMedium,
                                    {
                                        color: canConfirm ? palette.textInverse : palette.textMuted,
                                    },
                                ]}
                            >
                                {alreadyPublic ? 'Save username' : 'Make public'}
                            </Text>
                        )}
                    </Pressable>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
    usernameSection: {
        marginTop: Spacing.xl,
    },
    usernameInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.sm,
        gap: Spacing.xs,
    },
    usernameInput: {
        flex: 1,
        fontSize: 15,
    },
    buttons: {
        marginTop: Spacing.xl,
        gap: Spacing.sm,
    },
    cancelButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
    confirmButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
});
