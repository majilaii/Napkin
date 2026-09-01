/**
 * Settings screen — a sectioned Heirloom ledger (TICKET-142).
 *
 * Reachable via the gear on own profile / Tables header. Route: /settings.
 *
 * Sections (each a `note`-card group with ghosted warm rules between rows):
 *   profile     — Photo · Name · Username · Bio · Home city → one editor each
 *                 (/settings/{photo,name,username,bio,city})
 *   account     — Account visibility (Public/Private pill → /settings/privacy) ·
 *                 Email (read-only)
 *   privacy     — Blocked
 *   permissions — Notifications · Location: real OS state (On/Off pill) →
 *                 Linking.openSettings()
 *   help        — Replay the import tutorial without mutating onboarding state
 *   about       — Places photo acknowledgment · Support · Terms · Privacy
 * Footer: SIGN OUT (terracotta) + quiet delete account.
 *
 * The My Wishlist / My Lists shortcut cards were cut — settings is not a junk
 * drawer (they live on the Map tab's List sheet + the profile).
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView, Linking, Platform, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile } from '@/hooks/users';
import { useDeleteAccount } from '@/hooks/account';
import { Avatar } from '@/components/feed/Avatar';
import { LEGAL_URLS } from '@/constants/links';
import { FRIEND_TEST } from '@/constants/flags';
import {
    getPreviewOnboardingOnLaunch,
    getPreviewOnboardingOnLaunchCached,
    setPreviewOnboardingOnLaunch,
} from '@/lib/devPrefs';
import { getPermissionState } from '@/lib/localNotify';
import { permissionPill, type PermissionPill } from '@/lib/permissionLabel';

type Palette = typeof Colors.light;

// ── Section (kicker + note card) ────────────────────────────────────────────

function Section({
    title,
    palette,
    children,
}: {
    title: string;
    palette: Palette;
    children: React.ReactNode;
}) {
    return (
        <View style={styles.section}>
            <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>{title}</Text>
            <View style={[styles.card, { backgroundColor: palette.card }, Shadow.ambient]}>{children}</View>
        </View>
    );
}

// ── Row (label · value/pill · chevron) ──────────────────────────────────────

function Row({
    label,
    value,
    pill,
    palette,
    onPress,
    last,
    leading,
    trailing,
}: {
    label: string;
    value?: string | null;
    pill?: PermissionPill | { label: string; tone: 'neutral' | 'muted' };
    palette: Palette;
    onPress?: () => void;
    last?: boolean;
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
}) {
    const pillColor =
        pill?.tone === 'positive'
            ? palette.secondary
            : pill?.tone === 'neutral'
              ? palette.text
              : palette.textMuted;

    const body = (
        <View style={styles.rowInner}>
            {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
            <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
            <View style={styles.rowRight}>
                {pill ? (
                    <View style={[styles.pill, { backgroundColor: palette.surfaceContainerHigh }]}>
                        <Text style={[styles.pillText, { color: pillColor }]}>{pill.label}</Text>
                    </View>
                ) : value != null ? (
                    <Text style={[styles.rowValue, { color: palette.textMuted }]} numberOfLines={1}>
                        {value}
                    </Text>
                ) : null}
                {trailing}
                {onPress ? (
                    <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                ) : null}
            </View>
        </View>
    );

    return (
        <>
            {onPress ? (
                <Pressable
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    style={({ pressed }) => [
                        styles.row,
                        pressed ? { backgroundColor: palette.surfaceJournalLow } : null,
                    ]}
                >
                    {body}
                </Pressable>
            ) : (
                <View style={styles.row}>{body}</View>
            )}
            {!last ? (
                <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
            ) : null}
        </>
    );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { signOut, user } = useAuth();
    const router = useRouter();
    const deleteAccount = useDeleteAccount();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const homeCity = profile?.home_city ?? null;
    const isPublic = (profile?.account_privacy ?? 'public') === 'public';
    const showImportTutorial = Platform.OS === 'ios';
    const showOnboardingPreviewToggle = !FRIEND_TEST.hideOnboardingPreviewToggle;
    const showHelpSection = showImportTutorial || showOnboardingPreviewToggle;

    // Real OS permission state — refreshed whenever the screen regains focus
    // (so a trip out to system Settings and back reflects immediately).
    const [notifStatus, setNotifStatus] = useState<string>('undetermined');
    const [locStatus, setLocStatus] = useState<string>('undetermined');
    const [previewOnLaunch, setPreviewOnLaunch] = useState(() =>
        getPreviewOnboardingOnLaunchCached(),
    );
    useFocusEffect(
        useCallback(() => {
            let alive = true;
            getPermissionState()
                .then((s) => alive && setNotifStatus(s))
                .catch(() => undefined);
            Location.getForegroundPermissionsAsync()
                .then((r) => alive && setLocStatus(r.status))
                .catch(() => undefined);
            getPreviewOnboardingOnLaunch().then(
                (value) => alive && setPreviewOnLaunch(value),
            );
            return () => {
                alive = false;
            };
        }, []),
    );

    const goPrivacy = () => router.push('/settings/privacy');
    const openSystemSettings = () => {
        Linking.openSettings().catch(() => undefined);
    };
    const updatePreviewOnLaunch = (value: boolean) => {
        setPreviewOnLaunch(value);
        void setPreviewOnboardingOnLaunch(value);
        // Enter the preview immediately — the launch pref alone is invisible
        // until a cold start, which iOS rarely gives a warm-resumed app.
        if (value) router.push('/onboarding' as any);
    };

    // Two-step destructive confirm (guideline 5.1.1(v)) — unchanged from TICKET-090.
    const confirmDelete = () => {
        Alert.alert(
            'Delete account?',
            'Every log, photo, list, and table membership goes with it.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Continue',
                    style: 'destructive',
                    onPress: () =>
                        Alert.alert('This is permanent', "There's no undo and nothing is kept.", [
                            { text: 'Keep my account', style: 'cancel' },
                            {
                                text: 'Delete everything',
                                style: 'destructive',
                                onPress: () =>
                                    deleteAccount.mutate(undefined, {
                                        onError: () =>
                                            Alert.alert(
                                                'Something went wrong',
                                                'Your account was not deleted. Try again, or email us from the support page.',
                                            ),
                                    }),
                            },
                        ]),
                },
            ],
        );
    };

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.background, paddingTop: insets.top + Spacing.sm },
            ]}
        >
            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12}>
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                style={styles.content}
                contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
                showsVerticalScrollIndicator={false}
            >
                <Text style={[Type.displaySmall, { color: palette.text }]}>Settings</Text>
                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 4 }]}>
                    {user?.email ?? 'Signed in'}
                </Text>

                <Section title="profile" palette={palette}>
                    <Row
                        label="Photo"
                        palette={palette}
                        onPress={() => router.push('/settings/photo')}
                        leading={
                            <Avatar
                                name={profile?.display_name ?? ''}
                                url={profile?.avatar_url ?? null}
                                size={40}
                                palette={palette}
                            />
                        }
                    />
                    <Row
                        label="Name"
                        value={profile?.display_name || '—'}
                        palette={palette}
                        onPress={() => router.push('/settings/name')}
                    />
                    <Row
                        label="Username"
                        value={profile?.username ? `@${profile.username}` : 'not set'}
                        palette={palette}
                        onPress={() => router.push('/settings/username')}
                    />
                    <Row
                        label="Bio"
                        value={profile?.bio || '—'}
                        palette={palette}
                        onPress={() => router.push('/settings/bio')}
                    />
                    <Row
                        label="Home city"
                        value={homeCity || '—'}
                        palette={palette}
                        onPress={() => router.push('/settings/city')}
                        last
                    />
                </Section>

                <Section title="account" palette={palette}>
                    <Row
                        label="Account visibility"
                        pill={{ label: isPublic ? 'Public' : 'Private', tone: isPublic ? 'neutral' : 'muted' }}
                        palette={palette}
                        onPress={goPrivacy}
                    />
                    <Row label="Email" value={user?.email ?? '—'} palette={palette} last />
                </Section>

                <Section title="privacy" palette={palette}>
                    <Row
                        label="Blocked"
                        palette={palette}
                        onPress={() => router.push('/settings/blocked')}
                        last
                    />
                </Section>

                <Section title="permissions" palette={palette}>
                    <Row
                        label="Notifications"
                        pill={permissionPill(notifStatus)}
                        palette={palette}
                        onPress={openSystemSettings}
                    />
                    <Row
                        label="Location"
                        pill={permissionPill(locStatus)}
                        palette={palette}
                        onPress={openSystemSettings}
                        last
                    />
                </Section>

                {showHelpSection ? (
                    <Section title="help" palette={palette}>
                        {showImportTutorial ? (
                            <Row
                                label="How to save from videos"
                                value="Replay"
                                palette={palette}
                                onPress={() => router.push('/settings/import-tutorial' as any)}
                                last={!showOnboardingPreviewToggle}
                            />
                        ) : null}
                        {showOnboardingPreviewToggle ? (
                            <Row
                                label="show onboarding on launch"
                                palette={palette}
                                trailing={
                                    <Switch
                                        value={previewOnLaunch}
                                        onValueChange={updatePreviewOnLaunch}
                                        trackColor={{
                                            false: palette.outlineVariant,
                                            true: palette.primary,
                                        }}
                                        thumbColor="#fff"
                                        accessibilityLabel="show onboarding on launch"
                                    />
                                }
                                last
                            />
                        ) : null}
                    </Section>
                ) : null}

                <Section title="about" palette={palette}>
                    <Row
                        label="place photos"
                        value="Google Maps contributors"
                        palette={palette}
                    />
                    <Row
                        label="Support"
                        palette={palette}
                        onPress={() => Linking.openURL(LEGAL_URLS.support)}
                    />
                    <Row
                        label="Terms"
                        palette={palette}
                        onPress={() => Linking.openURL(LEGAL_URLS.terms)}
                    />
                    <Row
                        label="Privacy"
                        palette={palette}
                        onPress={() => Linking.openURL(LEGAL_URLS.privacy)}
                        last
                    />
                </Section>

                <Pressable
                    onPress={signOut}
                    style={({ pressed }) => [
                        styles.signOut,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 },
                    ]}
                >
                    <Text style={[Type.label, { color: palette.textInverse }]}>Sign out</Text>
                </Pressable>

                <Pressable
                    onPress={confirmDelete}
                    disabled={deleteAccount.isPending}
                    style={styles.deleteRow}
                    accessibilityRole="button"
                    accessibilityLabel="Delete account"
                >
                    <Text
                        style={[
                            styles.deleteLabel,
                            { color: palette.textMuted, opacity: deleteAccount.isPending ? 0.5 : 1 },
                        ]}
                    >
                        {deleteAccount.isPending ? 'deleting…' : 'delete account'}
                    </Text>
                </Pressable>
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
    content: {
        flex: 1,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    section: {
        marginTop: Spacing.xl,
    },
    sectionKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.9,
        textTransform: 'uppercase',
        marginBottom: Spacing.sm,
        marginLeft: Spacing.xs,
    },
    card: {
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    row: {
        minHeight: 52,
        justifyContent: 'center',
    },
    rowInner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
    },
    rowLeading: {
        marginRight: 2,
    },
    rowLabel: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
    },
    rowRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 1,
    },
    rowValue: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        maxWidth: 190,
    },
    pill: {
        borderRadius: Radius.full,
        paddingHorizontal: 10,
        paddingVertical: 3,
    },
    pillText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    // Ghosted warm rule — inset from the card edges, low opacity (no solid border).
    rule: {
        height: 1,
        marginLeft: Spacing.lg,
        opacity: 0.28,
    },
    signOut: {
        marginTop: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
    },
    deleteRow: {
        marginTop: Spacing.xl,
        alignItems: 'center',
        paddingVertical: Spacing.sm,
    },
    deleteLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.3,
    },
});
