/**
 * /reset-password — landing screen for the Supabase recovery deep link
 * (TICKET-090). The email link 302s to napkin://reset-password with tokens in
 * the URL fragment (implicit flow) or ?code= (pkce). We adopt the recovery
 * session, then ask for the new password.
 *
 * RootLayoutNav exempts this route from both auth redirects — see _layout.tsx.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { PINNED_PLACES_ROUTE } from '@/lib/handoffNavigation';

/** Recovery links carry tokens in the hash fragment (implicit flow) or a
 * ?code= param (pkce). Merge both so either link shape works. */
function parseRecoveryParams(url: string): Record<string, string> {
    const out: Record<string, string> = {};
    const collect = (raw: string) => {
        for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    };
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex >= 0) {
        const end = hashIndex > queryIndex ? hashIndex : url.length;
        collect(url.slice(queryIndex + 1, end));
    }
    if (hashIndex >= 0) collect(url.slice(hashIndex + 1));
    return out;
}

type Phase = 'adopting' | 'form' | 'dead-link';

export default function ResetPasswordScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const url = Linking.useURL();

    const [phase, setPhase] = useState<Phase>('adopting');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const adoptedRef = useRef(false);

    // Review P2: a bare cold entry (no deep-link URL ever arrives, no session)
    // would spin forever — settle to dead-link if nothing adopts in time.
    useEffect(() => {
        const t = setTimeout(() => {
            if (!adoptedRef.current) {
                adoptedRef.current = true;
                setPhase('dead-link');
            }
        }, 8000);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (adoptedRef.current) return;

        (async () => {
            // Already holding a session (e.g. recovery opened while signed in,
            // or setSession completed before a re-render) → straight to form.
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                adoptedRef.current = true;
                setPhase('form');
                return;
            }

            if (!url) return; // useURL not resolved yet — effect re-runs when it is
            const params = parseRecoveryParams(url);

            if (params.access_token && params.refresh_token) {
                adoptedRef.current = true;
                const { error } = await supabase.auth.setSession({
                    access_token: params.access_token,
                    refresh_token: params.refresh_token,
                });
                setPhase(error ? 'dead-link' : 'form');
                return;
            }
            if (params.code) {
                adoptedRef.current = true;
                const { error } = await supabase.auth.exchangeCodeForSession(params.code);
                setPhase(error ? 'dead-link' : 'form');
                return;
            }
            // Opened without tokens (expired link strips them, or direct nav).
            adoptedRef.current = true;
            setPhase('dead-link');
        })();
    }, [url]);

    const submit = async () => {
        if (password.length < 8) {
            Alert.alert('Too short', 'Use at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            Alert.alert("Doesn't match", 'Both fields need the same password.');
            return;
        }
        setSaving(true);
        const { error } = await supabase.auth.updateUser({ password });
        setSaving(false);
        if (error) {
            Alert.alert("Couldn't update password", error.message);
            return;
        }
        router.replace(PINNED_PLACES_ROUTE);
    };

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
                        <View style={styles.masthead}>
                            <View style={[styles.rule, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
                            <Text style={[Type.displayLarge, { color: palette.text, textAlign: 'center' }]}>
                                Napkin
                            </Text>
                            <View style={[styles.rule, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
                        </View>

                        {phase === 'adopting' && (
                            <View style={styles.centerBlock}>
                                <ActivityIndicator color={palette.primary} />
                            </View>
                        )}

                        {phase === 'dead-link' && (
                            <View style={styles.centerBlock}>
                                <Text style={[Type.headlineItalic, { color: palette.textSecondary, textAlign: 'center' }]}>
                                    That reset link has expired.
                                </Text>
                                <Pressable
                                    onPress={() => router.replace('/auth')}
                                    style={styles.toggle}
                                    hitSlop={12}
                                >
                                    <Text style={[Type.bodySmall, { color: palette.primary }]}>
                                        Request a new one from the sign-in screen
                                    </Text>
                                </Pressable>
                            </View>
                        )}

                        {phase === 'form' && (
                            <View style={styles.form}>
                                <Text style={[Type.labelSmall, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                    New password
                                </Text>
                                <View style={styles.underline}>
                                    <TextInput
                                        value={password}
                                        onChangeText={setPassword}
                                        placeholder="••••••••"
                                        placeholderTextColor={palette.textMuted}
                                        secureTextEntry
                                        autoComplete="new-password"
                                        textContentType="newPassword"
                                        style={[styles.input, Type.body, { color: palette.text }]}
                                    />
                                </View>

                                <View style={{ height: Spacing.lg }} />

                                <Text style={[Type.labelSmall, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                    Again
                                </Text>
                                <View style={styles.underline}>
                                    <TextInput
                                        value={confirm}
                                        onChangeText={setConfirm}
                                        placeholder="••••••••"
                                        placeholderTextColor={palette.textMuted}
                                        secureTextEntry
                                        autoComplete="new-password"
                                        textContentType="newPassword"
                                        style={[styles.input, Type.body, { color: palette.text }]}
                                    />
                                </View>

                                <Pressable
                                    onPress={submit}
                                    disabled={saving}
                                    style={({ pressed }) => [
                                        styles.cta,
                                        {
                                            backgroundColor: palette.primary,
                                            opacity: pressed || saving ? 0.85 : 1,
                                        },
                                    ]}
                                >
                                    {saving ? (
                                        <ActivityIndicator color={palette.textInverse} />
                                    ) : (
                                        <Text style={[Type.label, { color: palette.textInverse }]}>
                                            Set new password
                                        </Text>
                                    )}
                                </Pressable>
                            </View>
                        )}

                        <Text style={[Type.labelSmall, styles.footer, { color: palette.textMuted }]}>
                            est. at the table
                        </Text>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </>
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
    centerBlock: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: Spacing.md,
    },
    form: {
        marginVertical: Spacing.xxl,
    },
    underline: {
        paddingBottom: Spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(138, 114, 108, 0.25)',
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
        marginTop: Spacing.md,
        alignItems: 'center',
    },
    footer: {
        textAlign: 'center',
        marginBottom: Spacing.md,
    },
});
