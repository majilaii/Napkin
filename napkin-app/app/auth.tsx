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

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import * as pendingImport from '@/lib/pendingImport';

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

    // Peek for a stashed share URL on mount to decide whether to show the
    // wishlist-resume copy. Does not consume the stash — that happens after sign-in.
    useEffect(() => {
        pendingImport.peek().then((s) => setHasPendingImport(!!s)).catch(() => {});
    }, []);

    const submit = async () => {
        if (!email || !password) {
            Alert.alert('Missing info', 'Email and password are required.');
            return;
        }
        setLoading(true);
        try {
            if (mode === 'sign-in') {
                // TICKET-055: consume BEFORE signIn so the /import replace happens
                // synchronously after sign-in resolves, beating RootLayoutNav's
                // session-flip /feed redirect. If signIn fails, we re-stash.
                const stashed = await pendingImport.consume();
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) {
                    // Fix 9: re-stash WITH the same import_nonce so the next sign-in attempt
                    // resumes with the same job-level idempotency key.
                    if (stashed) await pendingImport.stash(stashed.url, stashed.import_nonce);
                    Alert.alert("Couldn't sign in", error.message);
                } else if (stashed) {
                    // Fix 9: thread import_nonce through the redirect so ImportLinkSheet
                    // initializes its importNonceRef from the pre-auth nonce.
                    router.replace({
                        pathname: '/import',
                        params: { url: stashed.url, nonce: stashed.import_nonce },
                    } as any);
                    return; // RootLayoutNav redirect now harmless — segments[0] === 'import'
                }
                // No pending import — RootLayoutNav handles the /feed redirect.
            } else {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) {
                    Alert.alert("Couldn't create account", error.message);
                } else if (!data.session) {
                    Alert.alert('Check your email', 'Confirm your address to finish signing up.');
                }
                // signUp does NOT resume pending share — new users land on /feed first.
            }
        } finally {
            setLoading(false);
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
                                A private table for those you trust.
                            </Text>
                            {/* TICKET-055: shown when arriving from iOS share extension. */}
                            {hasPendingImport && (
                                <Text
                                    style={[
                                        Type.headlineItalic,
                                        { color: palette.textMuted, textAlign: 'center', marginTop: Spacing.sm },
                                    ]}
                                >
                                    sign in to save links to your wishlist.
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
    toggle: {
        marginTop: Spacing.lg,
        alignItems: 'center',
    },
    footer: {
        textAlign: 'center',
        marginBottom: Spacing.md,
    },
});
