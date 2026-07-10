/**
 * /settings/privacy — account visibility.
 *
 * The state is the hero: a note card with the current mode in italic serif
 * (public = terracotta, private = olive — the screen's two accents), one
 * quiet line beneath, a preview link, and a single lowercase toggle pill.
 * Replies live under a ghosted REPLIES label as two segment chips.
 *
 * Flip mechanics unchanged: first private→public flip (no handle) routes to
 * /settings/privacy/make-public for the atomic username claim; every other
 * flip confirms via a two-button alert.
 */
import React from 'react';
import {
    View,
    Text,
    Pressable,
    Alert,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useUserProfile,
    useUpdatePrivacy,
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
    const updateReplyPermission = useUpdateReplyPermission(user?.id);

    // App is light-locked; ink hairline for pills (never for sectioning).
    const hairline = 'rgba(28,28,25,0.12)';

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

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            {/* Top bar — pushed-page grammar: chevron · centered italic title */}
            <View style={styles.topBar}>
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={12}
                    style={styles.side}
                    accessibilityLabel="back"
                >
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.title, { color: palette.text }]}>visibility</Text>
                <View style={styles.side} />
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* State card — the current mode as the hero */}
                <View style={[styles.stateCard, { backgroundColor: palette.card }, Shadow.subtle]}>
                    <Text style={[styles.stateKicker, { color: palette.textMuted }]}>
                        YOUR PROFILE
                    </Text>
                    <Text
                        style={[
                            styles.stateWord,
                            { color: isPublic ? palette.primary : palette.success },
                        ]}
                    >
                        {isPublic ? 'public' : 'private'}
                    </Text>
                    <Text style={[styles.stateLine, { color: palette.textSecondary }]}>
                        {isPublic
                            ? 'anyone with the link can browse your palate.'
                            : 'only your tables see you.'}
                    </Text>
                    <Pressable
                        onPress={() => router.push(`/u/${user?.id}`)}
                        hitSlop={8}
                        style={styles.previewLink}
                        accessibilityRole="button"
                        accessibilityLabel="preview profile"
                    >
                        <Text style={[styles.previewText, { color: palette.primary }]}>
                            preview profile →
                        </Text>
                    </Pressable>
                </View>

                {/* Toggle — single lowercase pill */}
                <Pressable
                    onPress={isPublic ? handleMakePrivate : handleMakePublic}
                    disabled={updatePrivacy.isPending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.togglePill,
                        isPublic
                            ? { borderWidth: 1, borderColor: hairline }
                            : { backgroundColor: palette.primary },
                        { opacity: pressed || updatePrivacy.isPending ? 0.7 : 1 },
                    ]}
                >
                    {updatePrivacy.isPending ? (
                        <ActivityIndicator
                            size="small"
                            color={isPublic ? palette.textSecondary : palette.cream}
                        />
                    ) : (
                        <Text
                            style={[
                                styles.togglePillText,
                                { color: isPublic ? palette.textSecondary : palette.cream },
                            ]}
                        >
                            {isPublic ? 'go private' : 'go public'}
                        </Text>
                    )}
                </Pressable>

                {/* Replies — who may reply to public reviews */}
                <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                        REPLIES
                    </Text>
                    <View style={[styles.chipRow, { opacity: isPublic ? 1 : 0.45 }]}>
                        {([
                            { allow: false, label: 'emoji only' },
                            { allow: true, label: 'anyone' },
                        ] as const).map(({ allow, label }) => {
                            const isActive = (profile.allow_public_replies === true) === allow;
                            return (
                                <Pressable
                                    key={label}
                                    disabled={!isPublic || updateReplyPermission.isPending}
                                    onPress={() => updateReplyPermission.mutate(allow)}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                    style={[
                                        styles.chip,
                                        isActive
                                            ? { backgroundColor: palette.primary }
                                            : { borderWidth: 1, borderColor: hairline },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.chipText,
                                            { color: isActive ? palette.cream : palette.textSecondary },
                                        ]}
                                    >
                                        {label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    {!isPublic ? (
                        <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
                            public profile only
                        </Text>
                    ) : null}
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
    },
    side: {
        width: 44,
        alignItems: 'flex-start',
    },
    title: {
        ...Type.screenTitle,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: Spacing.xl,
    },
    stateCard: {
        borderRadius: 16,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.lg,
    },
    stateKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
    },
    stateWord: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 34,
        lineHeight: 40,
        marginTop: 6,
    },
    stateLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        lineHeight: 19,
        marginTop: 2,
    },
    previewLink: {
        marginTop: Spacing.md,
    },
    previewText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    togglePill: {
        marginTop: Spacing.md,
        alignSelf: 'flex-start',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 999,
    },
    togglePillText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13.5,
    },
    section: {
        marginTop: Spacing.xl + Spacing.sm,
    },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
    },
    chipRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: Spacing.sm,
    },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
    },
    chipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    sectionHint: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11.5,
        marginTop: Spacing.sm,
    },
});
