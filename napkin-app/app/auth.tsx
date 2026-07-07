/**
 * Auth screen — Heirloom Journal aesthetic.
 *
 * Minimal editorial layout:
 *   - Warm paper background
 *   - Newsreader serif wordmark "Napkin" with a hairline rule
 *   - Italic tagline
 *   - Underline-only inputs (design system rule: no 1px borders for sectioning)
 *   - Terracotta pill CTA
 *   - Quiet mode toggle at the bottom ("Already have an account? ·")
 *
 * Keeps the Supabase AppState auto-refresh pattern from the original screen.
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    Pressable,
    KeyboardAvoidingView,
    Platform,
    TouchableWithoutFeedback,
    Keyboard,
    ActivityIndicator,
    AppState,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import * as postAuthResume from '@/lib/postAuthResume';
import { appleIdToken, googleIdToken, OAuthCancelledError } from '@/lib/oauth';

/**
 * TICKET-110: after ANY successful auth (password / Apple / Google), resume a
 * pending share/handoff by routing to it and returning `true` so the caller
 * bails before RootLayoutNav's session-flip redirect. Returns `false` when there
 * is nothing to resume — the caller lets RootLayoutNav route (onboarding for a
 * new user, /wishlist for a returning one, both keyed off profiles.onboarded_at).
 * Shared by all three entry points so the subtle resume-vs-redirect race stays
 * correct in one place.
 */
function resumeAfterAuth(
    winner: postAuthResume.ResumeResult,
    router: ReturnType<typeof useRouter>,
): boolean {
    if (winner?.kind === 'import') {
        // TICKET-055/063: thread import_nonce through the redirect.
        router.replace({
            pathname: '/import',
            params: { url: winner.stash.url, nonce: winner.stash.import_nonce },
        } as any);
        return true; // RootLayoutNav redirect now harmless — segments[0] === 'import'
    }
    if (winner?.kind === 'handoff') {
        // TICKET-072: re-resolve the token in the receive screen.
        router.replace({
            pathname: '/handoff',
            params: { t: winner.token },
        } as any);
        return true; // RootLayoutNav redirect now harmless — segments[0] === 'handoff'
    }
    if (winner?.kind === 'invite') {
        // Table invite: redeem the code in the join-table receive screen.
        router.replace({
            pathname: '/join-table',
            params: { code: winner.code },
        } as any);
        return true; // RootLayoutNav redirect now harmless — segments[0] === 'join-table'
    }
    return false; // No pending stash — RootLayoutNav handles the redirect.
}

// Supabase auth auto-refresh when foregrounded. Registered once at module load.
AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
});

type Mode = 'sign-in' | 'sign-up';

export default function AuthScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const [mode, setMode] = useState<Mode>('sign-in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [emailFocused, setEmailFocused] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);
    // TICKET-055: show "sign in to save links" copy when arriving from a share.
    const [hasPendingImport, setHasPendingImport] = useState(false);

    // Peek for any stashed resume (import or handoff) on mount to decide whether
    // to show the wishlist-resume copy. Does not consume — that happens after sign-in.
    useEffect(() => {
        postAuthResume.peek().then((r) => setHasPendingImport(!!r)).catch(() => {});
    }, []);

    const submit = async () => {
        if (!email || !password) {
            Alert.alert('Missing info', 'Email and password are required.');
            return;
        }
        setLoading(true);
        try {
            if (mode === 'sign-in') {
                // TICKET-055/TICKET-072: consume BEFORE signIn so the resume route replace
                // happens synchronously after sign-in resolves, beating RootLayoutNav's
                // session-flip /feed redirect. If signIn fails, we re-stash the winner.
                // ARCH-REVIEW-2 #11: consumeWinner peeks both pendingImport + pendingHandoff;
                // the most-recent stashedAt wins; the loser is preserved in its store.
                const winner = await postAuthResume.consumeWinner();
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    // Re-stash the winner so the next sign-in attempt can resume.
                    // The loser is still in its store (untouched by consumeWinner).
                    if (winner) await postAuthResume.restashWinner(winner);
                    Alert.alert("Couldn't sign in", error.message);
                } else {
                    // Resume a pending share/handoff, else RootLayoutNav routes.
                    resumeAfterAuth(winner, router);
                }
            } else {
                // Launch-readiness (2026-07-03): sign-UP resumes the pending
                // share too. The highest-intent cold install — shares a TikTok,
                // creates an account to save it — used to lose the link here.
                const winner = await postAuthResume.consumeWinner();
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) {
                    if (winner) await postAuthResume.restashWinner(winner);
                    Alert.alert("Couldn't create account", error.message);
                } else if (!data.session) {
                    // Email-confirmation round-trip — keep the stash so the
                    // first sign-in after confirming resumes it.
                    if (winner) await postAuthResume.restashWinner(winner);
                    Alert.alert('Check your email', 'Confirm your address to finish signing up.');
                } else {
                    resumeAfterAuth(winner, router);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    // TICKET-110: native ID-token sign-in. Apple / Google run their own credential
    // dance, hand the ID token to signInWithIdToken, then reuse the SAME
    // consume→auth→resume sequence as the password path. New OAuth user →
    // handle_new_user leaves onboarded_at NULL → RootLayoutNav routes /onboarding;
    // returning → /wishlist. A pending share/handoff resumes via resumeAfterAuth.
    const signInWithProvider = async (provider: 'apple' | 'google') => {
        setLoading(true);
        // Hoisted so the catch can re-stash if signInWithIdToken THROWS after the
        // stash was consumed (the {error} branch below covers the non-throw case).
        let winner: Awaited<ReturnType<typeof postAuthResume.consumeWinner>> = null;
        try {
            const token =
                provider === 'apple'
                    ? (await appleIdToken()).identityToken
                    : await googleIdToken();
            // Consume BEFORE signIn so the resume replace beats RootLayoutNav's
            // session-flip redirect; re-stash on failure (mirrors the password path).
            winner = await postAuthResume.consumeWinner();
            const { error } = await supabase.auth.signInWithIdToken({ provider, token });
            if (error) {
                if (winner) await postAuthResume.restashWinner(winner);
                Alert.alert("Couldn't sign in", error.message);
            } else {
                resumeAfterAuth(winner, router);
            }
        } catch (err) {
            // A throw past consumeWinner would otherwise drop the pending
            // import/handoff stash. (Cancel happens before consume — winner null.)
            if (winner) await postAuthResume.restashWinner(winner);
            // User dismissed the native sheet — silent, no Alert.
            if (err instanceof OAuthCancelledError) return;
            Alert.alert(
                "Couldn't sign in",
                err instanceof Error ? err.message : 'Please try again.',
            );
        } finally {
            setLoading(false);
        }
    };

    // TICKET-090: recovery email deep-links back into /reset-password.
    const forgotPassword = async () => {
        const target = email.trim();
        if (!target) {
            Alert.alert('Enter your email first', 'Type it above, then tap "forgot password?" again.');
            return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(target, {
            redirectTo: 'napkin://reset-password',
        });
        if (error) {
            Alert.alert("Couldn't send the reset email", error.message);
        } else {
            Alert.alert('Check your email', `A reset link is on its way to ${target}.`);
        }
    };

    const ctaLabel = loading ? '' : mode === 'sign-in' ? 'Sign in' : 'Create account';
    const toggleLabel =
        mode === 'sign-in'
            ? 'New here? · Create an account'
            : 'Already have one? · Sign in';

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1, backgroundColor: palette.background }}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                    <View
                        style={[
                            styles.root,
                            { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.lg },
                        ]}
                    >
                        {/* Masthead */}
                        <View style={styles.masthead}>
                            <View style={[styles.rule, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
                            <Text style={[Type.displayLarge, { color: palette.text, textAlign: 'center' }]}>
                                Napkin
                            </Text>
                            <View style={[styles.rule, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
                            <Text
                                style={[
                                    Type.headlineItalic,
                                    { color: palette.textSecondary, textAlign: 'center', marginTop: Spacing.md },
                                ]}
                            >
                                Every meal worth remembering.
                            </Text>
                            {/* TICKET-055: shown when arriving from iOS share extension. */}
                            {hasPendingImport && (
                                <Text
                                    style={[
                                        Type.headlineItalic,
                                        { color: palette.textMuted, textAlign: 'center', marginTop: Spacing.sm },
                                    ]}
                                >
                                    your shared link saves right after.
                                </Text>
                            )}
                        </View>

                        {/* Form */}
                        <View style={styles.form}>
                            <FieldLabel palette={palette}>Email</FieldLabel>
                            <View
                                style={[
                                    styles.underline,
                                    {
                                        borderBottomColor: emailFocused
                                            ? palette.primary
                                            : 'rgba(138, 114, 108, 0.25)',
                                        borderBottomWidth: emailFocused ? 2 : 1,
                                    },
                                ]}
                            >
                                <TextInput
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => setEmailFocused(true)}
                                    onBlur={() => setEmailFocused(false)}
                                    placeholder="you@somewhere"
                                    placeholderTextColor={palette.textMuted}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                    autoComplete="email"
                                    textContentType="emailAddress"
                                    style={[styles.input, Type.body, { color: palette.text }]}
                                />
                            </View>

                            <View style={{ height: Spacing.lg }} />

                            <FieldLabel palette={palette}>Password</FieldLabel>
                            <View
                                style={[
                                    styles.underline,
                                    {
                                        borderBottomColor: passwordFocused
                                            ? palette.primary
                                            : 'rgba(138, 114, 108, 0.25)',
                                        borderBottomWidth: passwordFocused ? 2 : 1,
                                    },
                                ]}
                            >
                                <TextInput
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => setPasswordFocused(true)}
                                    onBlur={() => setPasswordFocused(false)}
                                    placeholder="••••••••"
                                    placeholderTextColor={palette.textMuted}
                                    secureTextEntry
                                    autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                                    textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
                                    style={[styles.input, Type.body, { color: palette.text }]}
                                />
                            </View>

                            {/* Primary CTA — terracotta pill */}
                            <Pressable
                                onPress={submit}
                                disabled={loading}
                                style={({ pressed }) => [
                                    styles.cta,
                                    {
                                        backgroundColor: palette.primary,
                                        opacity: pressed || loading ? 0.85 : 1,
                                    },
                                ]}
                            >
                                {loading ? (
                                    <ActivityIndicator color={palette.textInverse} />
                                ) : (
                                    <Text style={[Type.label, { color: palette.textInverse }]}>{ctaLabel}</Text>
                                )}
                            </Pressable>

                            {/* TICKET-110: OAuth — ghosted "or" rule + Apple/Google. */}
                            <View style={styles.orRow}>
                                <View style={[styles.orRule, { backgroundColor: 'rgba(138, 114, 108, 0.2)' }]} />
                                <Text style={[Type.labelSmall, { color: palette.textMuted, marginHorizontal: Spacing.md }]}>
                                    or
                                </Text>
                                <View style={[styles.orRule, { backgroundColor: 'rgba(138, 114, 108, 0.2)' }]} />
                            </View>

                            {/* Apple — HIG-compliant black button. */}
                            <Pressable
                                onPress={() => signInWithProvider('apple')}
                                disabled={loading}
                                style={({ pressed }) => [
                                    styles.oauthBtn,
                                    { backgroundColor: '#000000', opacity: pressed || loading ? 0.85 : 1 },
                                ]}
                            >
                                <Ionicons name="logo-apple" size={18} color="#ffffff" style={styles.oauthIcon} />
                                <Text style={[Type.label, { color: '#ffffff' }]}>Continue with Apple</Text>
                            </Pressable>

                            {/* Google — light surface, hairline warm rule. */}
                            <Pressable
                                onPress={() => signInWithProvider('google')}
                                disabled={loading}
                                style={({ pressed }) => [
                                    styles.oauthBtn,
                                    {
                                        backgroundColor: palette.surfaceNote,
                                        borderWidth: StyleSheet.hairlineWidth,
                                        borderColor: 'rgba(138, 114, 108, 0.35)',
                                        marginTop: Spacing.md,
                                        opacity: pressed || loading ? 0.85 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="logo-google" size={18} color={palette.text} style={styles.oauthIcon} />
                                <Text style={[Type.label, { color: palette.text }]}>Continue with Google</Text>
                            </Pressable>

                            {/* Mode toggle */}
                            <Pressable
                                onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
                                style={styles.toggle}
                                hitSlop={12}
                            >
                                <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                                    {toggleLabel}
                                </Text>
                            </Pressable>

                            {mode === 'sign-in' && (
                                <Pressable onPress={forgotPassword} style={styles.forgot} hitSlop={12}>
                                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                        forgot password?
                                    </Text>
                                </Pressable>
                            )}
                        </View>

                        {/* Footer flourish */}
                        <Text style={[Type.labelSmall, styles.footer, { color: palette.textMuted }]}>
                            est. at the table
                        </Text>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </>
    );
}

function FieldLabel({
    children,
    palette,
}: {
    children: string;
    palette: typeof Colors.light;
}) {
    return (
        <Text style={[Type.labelSmall, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: Spacing.xl,
        justifyContent: 'space-between',
    },
    masthead: {
        gap: Spacing.md,
        marginTop: Spacing.xl,
    },
    rule: {
        height: StyleSheet.hairlineWidth,
    },
    form: {
        marginVertical: Spacing.xxl,
    },
    underline: {
        paddingBottom: Spacing.xs,
    },
    input: {
        paddingVertical: Spacing.sm,
    },
    cta: {
        marginTop: Spacing.xxl,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.full,
        alignItems: 'center',
        minHeight: 52,
        justifyContent: 'center',
    },
    orRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.xl,
    },
    orRule: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
    },
    oauthBtn: {
        marginTop: Spacing.lg,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.full,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 52,
    },
    oauthIcon: {
        marginRight: Spacing.sm,
    },
    toggle: {
        marginTop: Spacing.lg,
        alignItems: 'center',
    },
    forgot: {
        marginTop: Spacing.md,
        alignItems: 'center',
    },
    footer: {
        textAlign: 'center',
        marginBottom: Spacing.md,
    },
});
