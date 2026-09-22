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
    ScrollView,
    ActivityIndicator,
    AppState,
    Alert,
    Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import * as postAuthResume from '@/lib/postAuthResume';
import { appleIdToken, googleIdToken, OAuthCancelledError } from '@/lib/oauth';
import * as pendingIdentity from '@/lib/pendingIdentity';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';
import { LEGAL_URLS } from '@/constants/links';

/**
 * TICKET-110: after ANY successful auth (password / Apple / Google), resume a
 * pending share/handoff by routing to it and returning `true` so the caller
 * bails before RootLayoutNav's session-flip redirect. Returns `false` when there
 * is nothing to resume — the caller lets RootLayoutNav route (onboarding for a
 * new user, Places pinned-list for a returning one, both keyed off profiles.onboarded_at).
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

/**
 * Persist the one-shot identity a provider just handed us (TICKET-246).
 *
 * Apple returns the user's name exactly once — on the first authorization for
 * this Apple ID + app — and it arrives out-of-band in the native credential, not
 * in the identity token. `signInWithIdToken` has no parameter that seeds user
 * metadata (SignInWithIdTokenCredentials is provider/token/access_token/nonce/
 * captchaToken only), and `handle_new_user` fires AFTER INSERT on auth.users
 * reading only token metadata — so for Apple it always coalesces display_name
 * down to 'New User'. The name can therefore only be captured client-side, here.
 *
 * Two sinks, deliberately redundant, and NEITHER is awaited — see below:
 *   1. `pendingIdentity` — the LOCAL sink, and the one onboarding actually reads.
 *      `stash()` sets its in-memory memo synchronously before its first await, so
 *      the name is already readable the instant the call is made.
 *   2. `updateUser` — the SERVER sink. Writes full_name into raw_user_meta_data so
 *      the name survives a reinstall. It does NOT reach profiles.display_name (the
 *      trigger is INSERT-only); onboarding's complete_onboarding does that.
 *
 * Neither write is awaited. `signInWithIdToken` notifies
 * SIGNED_IN before it resolves, so AuthProvider's onboarded_at read — the one that
 * drives RootLayoutNav's redirect — is already in flight. Awaiting an unbounded
 * network write here would race that redirect and could fire resumeAfterAuth's
 * `router.replace` after the user had already been moved into onboarding, yanking
 * them out mid-step. It would also hold `loading` true across the whole round-trip.
 *
 * Never throws: losing the name costs a prefill, never the sign-in.
 */
async function persistProviderIdentity(
    user: { id: string } | null | undefined,
    credential: { fullName: string | null; email: string | null },
): Promise<void> {
    if (!user?.id) return;
    if (!credential.fullName && !credential.email) return;
    // Not awaited: stash() sets its in-memory memo synchronously BEFORE its first
    // await, so the name is already readable the moment this line runs. Awaiting
    // the AsyncStorage write behind it would only delay resumeAfterAuth and hold
    // `loading` true — the same race the server sink was moved out of.
    void pendingIdentity.stash(user.id, credential).catch(() => {
        // The memo already carries this app session; only the cold-restart
        // recovery path is lost, which updateUser below covers.
    });
    if (!credential.fullName) return;
    // Fire-and-forget; see above. updateUser resolves {error} rather than throwing,
    // so swallow both shapes.
    void supabase.auth
        .updateUser({ data: { full_name: credential.fullName } })
        .catch(() => {
            // Offline or transient — the stash still carries the name into onboarding.
        });
}

// Supabase auth auto-refresh when foregrounded. Registered once at module load.
AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
});

type Mode = 'sign-in' | 'sign-up';

const AUTH_TIMEOUT_ERROR = new Error(
    "Couldn't reach Napkin — check your connection and try again.",
);

function withAuthTimeout<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(AUTH_TIMEOUT_ERROR), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
}

export default function AuthScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    // TICKET-247: GuestPlate's "Create an account" opens this screen in sign-up.
    const params = useLocalSearchParams<{ mode?: string }>();
    // A guest who tapped an account feature gets a "not now" way back.
    const { isGuest, enterGuestMode } = useAuth();

    const [mode, setMode] = useState<Mode>(params.mode === 'sign-up' ? 'sign-up' : 'sign-in');
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
        let winner: postAuthResume.ResumeResult = null;
        try {
            if (mode === 'sign-in') {
                // TICKET-055/TICKET-072: consume BEFORE signIn so the resume route replace
                // happens synchronously after sign-in resolves, beating RootLayoutNav's
                // session-flip /feed redirect. If signIn fails, we re-stash the winner.
                // ARCH-REVIEW-2 #11: consumeWinner peeks both pendingImport + pendingHandoff;
                // the most-recent stashedAt wins; the loser is preserved in its store.
                winner = await postAuthResume.consumeWinner();
                const { error } = await withAuthTimeout(
                    supabase.auth.signInWithPassword({ email, password }),
                );
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
                winner = await postAuthResume.consumeWinner();
                const { data, error } = await withAuthTimeout(
                    supabase.auth.signUp({ email, password }),
                );
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
        } catch (err) {
            if (winner) await postAuthResume.restashWinner(winner);
            if (err === AUTH_TIMEOUT_ERROR) {
                Alert.alert("Couldn't reach Napkin", 'Check your connection and try again.');
                return;
            }
            Alert.alert(
                mode === 'sign-in' ? "Couldn't sign in" : "Couldn't create account",
                err instanceof Error ? err.message : 'Please try again.',
            );
        } finally {
            setLoading(false);
        }
    };

    // TICKET-110: native ID-token sign-in. Apple / Google run their own credential
    // dance, hand the ID token to signInWithIdToken, then reuse the SAME
    // consume→auth→resume sequence as the password path. New OAuth user →
    // handle_new_user leaves onboarded_at NULL → RootLayoutNav routes /onboarding;
    // returning → Places pinned-list. A pending share/handoff resumes via resumeAfterAuth.
    const signInWithProvider = async (provider: 'apple' | 'google') => {
        // Apple Authentication has no Android native implementation. The button
        // is hidden below, and this guard keeps a future programmatic caller from
        // reaching oauth.ts's lazy native require on a non-Apple platform.
        if (provider === 'apple' && Platform.OS !== 'ios') return;

        setLoading(true);
        // Hoisted so the catch can re-stash if signInWithIdToken THROWS after the
        // stash was consumed (the {error} branch below covers the non-throw case).
        let winner: Awaited<ReturnType<typeof postAuthResume.consumeWinner>> = null;
        try {
            // The native credential sheet can fail to call back when the
            // presenting VC is wrong (iPhone-compat mode on iPad) — without a
            // bound, `loading` stays true and every button on the screen is
            // disabled forever. Generous limit: a human typing an Apple ID
            // password legitimately takes a while.
            // Apple hands back fullName/email ONLY on the first authorization
            // for this Apple ID + app, out-of-band (they are not in the identity
            // JWT), and never again. Keep the WHOLE credential — discarding the
            // name here is what made onboarding re-ask for it and drew the
            // Guideline 4 rejection of 2026-09-14.
            const credential = await withAuthTimeout(
                provider === 'apple'
                    ? appleIdToken()
                    : googleIdToken().then((identityToken) => ({
                          identityToken,
                          fullName: null,
                          email: null,
                      })),
                90_000,
            );
            const token = credential.identityToken;
            // Consume BEFORE signIn so the resume replace beats RootLayoutNav's
            // session-flip redirect; re-stash on failure (mirrors the password path).
            winner = await postAuthResume.consumeWinner();
            const { data, error } = await withAuthTimeout(
                supabase.auth.signInWithIdToken({ provider, token }),
            );
            if (error) {
                if (winner) await postAuthResume.restashWinner(winner);
                Alert.alert("Couldn't sign in", error.message);
            } else {
                await persistProviderIdentity(data.user, credential);
                resumeAfterAuth(winner, router);
            }
        } catch (err) {
            // A throw past consumeWinner would otherwise drop the pending
            // import/handoff stash. (Cancel happens before consume — winner null.)
            if (winner) await postAuthResume.restashWinner(winner);
            if (err === AUTH_TIMEOUT_ERROR) {
                Alert.alert("Couldn't reach Napkin", 'Check your connection and try again.');
                return;
            }
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

    // TICKET-247: guest browse doorway. Hidden while a share resume is pending
    // (saving the shared link needs an account) and while an auth call runs.
    const lookAround = async () => {
        await enterGuestMode();
        router.replace('/(tabs)/places');
    };
    const notNow = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/places');
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
                {isGuest && (
                    <Pressable
                        onPress={notNow}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel="not now"
                        style={[styles.guestBack, { top: insets.top + Spacing.sm }]}
                    >
                        <Ionicons name="chevron-back" size={24} color={palette.textMuted} />
                    </Pressable>
                )}
                {/* TICKET-247 (App Store 5.1.1(v)): the no-account doorway sits in
                    the top-right corner so it is visible without scrolling on
                    every device. Hidden for a guest (the chevron above already
                    returns them), while a share resume is pending (saving the
                    shared link needs an account) and while an auth call runs. */}
                {!isGuest && !hasPendingImport && !loading && (
                    <Pressable
                        onPress={lookAround}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel="Look around without an account"
                        style={[styles.lookAround, { top: insets.top + Spacing.sm }]}
                    >
                        <Text style={[Type.label, { color: palette.primary }]}>Look around</Text>
                    </Pressable>
                )}
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={[
                        styles.root,
                        { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.lg },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
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

                        {/* TICKET-126: one implicit-acceptance line governing
                            email submit AND the available OAuth buttons. Manrope, muted,
                            not italic serif (an instruction, not a brand moment);
                            Terms + Privacy tap out to the legal pages. */}
                        <Text style={[styles.legal, { color: palette.textMuted }]}>
                            by continuing you confirm you&rsquo;re 13+ and agree to the{' '}
                            <Text
                                style={[styles.legalLink, { color: palette.textSecondary }]}
                                onPress={() => Linking.openURL(LEGAL_URLS.terms)}
                            >
                                Terms
                            </Text>
                            {' & '}
                            <Text
                                style={[styles.legalLink, { color: palette.textSecondary }]}
                                onPress={() => Linking.openURL(LEGAL_URLS.privacy)}
                            >
                                Privacy Policy
                            </Text>
                        </Text>

                        {/* Primary CTA — terracotta pill */}
                        <Pressable
                            onPress={submit}
                            disabled={loading}
                            style={({ pressed }) => [
                                styles.cta,
                                {
                                    backgroundColor: palette.primary,
                                    opacity: pressed || loading ? 0.85 : 1,
                                    marginTop: Spacing.lg,
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

                        {/* Apple Authentication is iOS-only. Android shows
                            email + Google without a dead native affordance.
                            Apple's OWN button component — a custom one is against
                            the App Store Guidelines (see AppleSignInButton). */}
                        {Platform.OS === 'ios' ? (
                            <AppleSignInButton
                                onPress={() => signInWithProvider('apple')}
                                disabled={loading}
                                style={styles.appleBtn}
                            />
                        ) : null}

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
                                    opacity: pressed || loading ? 0.85 : 1,
                                },
                                Platform.OS === 'ios' ? { marginTop: Spacing.md } : null,
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
                </ScrollView>
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
    scroll: {
        flex: 1,
    },
    root: {
        flexGrow: 1,
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
    legal: {
        marginTop: Spacing.xl,
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 16,
        textAlign: 'center',
        paddingHorizontal: Spacing.sm,
    },
    legalLink: {
        fontFamily: 'Manrope_600SemiBold',
        textDecorationLine: 'underline',
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
    // Apple's native button carries its own colours, type and logo; only the
    // outer spacing is ours (cornerRadius/height live in AppleSignInButton).
    appleBtn: {
        marginTop: Spacing.lg,
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
    guestBack: {
        position: 'absolute',
        left: Spacing.md,
        zIndex: 1,
        padding: Spacing.xs,
    },
    lookAround: {
        position: 'absolute',
        right: Spacing.lg,
        zIndex: 1,
        minHeight: 44,
        justifyContent: 'center',
    },
    footer: {
        textAlign: 'center',
        marginBottom: Spacing.md,
    },
});
