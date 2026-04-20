/**
 * Privacy settings screen — /settings/privacy
 * TICKET-025 rebuild: "Who sees what" visual grid over existing master-toggle data.
 *
 * Layout:
 *   1. "Who sees what" title
 *   2. Italic descriptor
 *   3. Per-section grid (read-only affordances except master toggle)
 *   4. Footer explanation ("Everything follows your account switch…")
 *   5. Reply permission segmented control (existing)
 *   6. Profile editors: display name, username, avatar URL, bio (existing)
 *
 * No new mutations, no backend rewiring. The per-section pickers are visual
 * affordances — only the master toggle (account_privacy) is actionable.
 * Lists row deep-links to the lists screen (per-list privacy managed there).
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
import { PrivacyPicker } from '@/components/profile/PrivacyPicker';
import type { PrivacyState } from '@/components/profile/PrivacyPicker';

// Per-section rows — state derived from account-level toggle
type SectionRow = {
    label: string;
    sub: string;
    state: PrivacyState;
    /** If true, tapping the row navigates somewhere (Lists) */
    deepLink?: string;
};

function deriveSections(isPublic: boolean): SectionRow[] {
    return [
        {
            label: 'Top 4',
            sub: 'Everyone can see your four picks.',
            state: isPublic ? 'public' : 'private',
        },
        {
            label: 'Regulars',
            sub: 'Your most-visited places.',
            state: isPublic ? 'public' : 'private',
        },
        {
            label: 'Diary',
            sub: 'Logs, reviews, and ratings in order.',
            state: isPublic ? 'public' : 'private',
        },
        {
            label: 'Lists',
            sub: 'Per-list — managed in Lists.',
            state: 'public',
            deepLink: '/lists',
        },
        {
            label: 'Wishlist',
            sub: 'Places saving for later.',
            state: isPublic ? 'public' : 'private',
        },
        {
            label: 'Likes',
            sub: 'Entries from others you\'ve hearted.',
            state: 'private',
        },
        {
            label: 'Stats',
            sub: 'Totals: places, logs, reviews.',
            state: isPublic ? 'public' : 'private',
        },
    ];
}

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
    const sections = deriveSections(isPublic);

    const handleMakePublic = () => {
        if (!isPublic && !profile.username) {
            router.push('/settings/privacy/make-public');
        } else if (!isPublic && profile.username) {
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
                    <Text style={[Type.body, { color: palette.primary }]}>{'← Back'}</Text>
                </Pressable>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Screen title */}
                <Text
                    style={[
                        styles.screenTitle,
                        { color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' },
                    ]}
                >
                    Who sees what
                </Text>

                {/* Descriptor */}
                <Text
                    style={[
                        Type.headlineItalic,
                        styles.descriptor,
                        { color: palette.textMuted, fontFamily: 'Newsreader_400Regular_Italic' },
                    ]}
                >
                    {isPublic
                        ? 'Your profile is public. Toggle any section below or go private to lock everything down.'
                        : 'Your profile is private — only your Tables see you.'}
                </Text>

                {/* Master toggle */}
                <Pressable
                    onPress={isPublic ? handleMakePrivate : handleMakePublic}
                    disabled={updatePrivacy.isPending}
                    style={({ pressed }) => [
                        styles.masterToggle,
                        {
                            backgroundColor: isPublic
                                ? palette.surfaceContainerLow
                                : palette.primary,
                            opacity: pressed || updatePrivacy.isPending ? 0.8 : 1,
                        },
                    ]}
                >
                    {updatePrivacy.isPending ? (
                        <ActivityIndicator color={isPublic ? palette.text : '#fff'} />
                    ) : (
                        <Text
                            style={[
                                Type.titleMedium,
                                { color: isPublic ? palette.text : '#fff' },
                            ]}
                        >
                            {isPublic ? 'Make profile private' : 'Make profile public'}
                        </Text>
                    )}
                </Pressable>

                {/* Preview link */}
                <Pressable
                    onPress={() => router.push(`/u/${user?.id}`)}
                    style={{ marginTop: Spacing.sm }}
                >
                    <Text style={[Type.bodySmall, { color: palette.primary }]}>
                        {'Preview my profile \u2192'}
                    </Text>
                </Pressable>

                {/* Per-section grid */}
                <View style={[styles.sectionGrid, { borderTopColor: palette.dividerSoft }]}>
                    {sections.map((s, i) => (
                        <Pressable
                            key={s.label}
                            onPress={s.deepLink ? () => router.push(s.deepLink as any) : undefined}
                            style={[
                                styles.sectionRow,
                                { borderTopColor: palette.dividerSoft },
                            ]}
                        >
                            <View style={styles.sectionRowContent}>
                                <Text
                                    style={{
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 15,
                                        color: palette.text,
                                    }}
                                >
                                    {s.label}
                                </Text>
                                <Text style={[Type.caption, { color: palette.textMuted, marginTop: 3, lineHeight: 16 }]}>
                                    {s.sub}
                                </Text>
                            </View>
                            <PrivacyPicker
                                state={s.state}
                                disabled
                            />
                        </Pressable>
                    ))}
                </View>

                {/* Footer explanation */}
                <Text style={[Type.caption, styles.footer, { color: palette.textMuted }]}>
                    {'Everything follows your account switch. Lists are per-list — managed in the Lists screen.'}
                </Text>

                {/* Reply permission */}
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
                                            { color: isActive ? '#fff' : palette.textSecondary },
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

                    <Text style={[Type.caption, { color: palette.textMuted }]}>Display name</Text>
                    <TextInput
                        value={displayName}
                        onChangeText={setDisplayName}
                        onBlur={handleDisplayNameBlur}
                        style={[styles.input, { color: palette.text, borderColor: palette.outlineVariant }]}
                        maxLength={80}
                        returnKeyType="done"
                    />

                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.md }]}>
                        Username {profile.username ? `(@${profile.username})` : '(not set)'}
                    </Text>
                    {profile.username && (
                        <Pressable
                            onPress={() => router.push('/settings/privacy/make-public')}
                            style={{ marginTop: 2 }}
                        >
                            <Text style={[Type.caption, { color: palette.primary }]}>
                                {'Change username \u2192'}
                            </Text>
                        </Pressable>
                    )}

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
    screenTitle: {
        fontSize: 24,
        fontWeight: '500',
        lineHeight: 28,
        marginBottom: Spacing.sm,
    },
    descriptor: {
        fontSize: 13,
        lineHeight: 20,
        marginBottom: Spacing.lg,
    },
    masterToggle: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
    },
    sectionGrid: {
        marginTop: Spacing.xl,
        borderTopWidth: 1,
    },
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderTopWidth: 1,
        gap: 14,
    },
    sectionRowContent: {
        flex: 1,
    },
    footer: {
        marginTop: Spacing.md,
        lineHeight: 18,
        fontStyle: 'italic',
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
