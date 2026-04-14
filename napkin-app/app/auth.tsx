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

import React, { useState } from 'react';
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
import { Stack } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

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

    const [mode, setMode] = useState<Mode>('sign-in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [emailFocused, setEmailFocused] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);

    const submit = async () => {
        if (!email || !password) {
            Alert.alert('Missing info', 'Email and password are required.');
            return;
        }
        setLoading(true);
        try {
            if (mode === 'sign-in') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) Alert.alert("Couldn't sign in", error.message);
            } else {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) {
                    Alert.alert("Couldn't create account", error.message);
                } else if (!data.session) {
                    Alert.alert('Check your email', 'Confirm your address to finish signing up.');
                }
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
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={[Type.label, { color: '#fff' }]}>{ctaLabel}</Text>
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
