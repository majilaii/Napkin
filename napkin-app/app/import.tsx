/**
 * import.tsx — deep-link landing screen for napkin://import?url=…
 *
 * Lifecycle:
 *   1. Read `url` query param.
 *   2. If signed out → stash the URL in AsyncStorage, route to /auth.
 *   3. If signed in but URL invalid → show "couldn't read that link" error panel.
 *   4. If signed in and URL valid → open ImportLinkSheet with initialUrl pre-set.
 *      On dismiss, router.replace('/feed').
 *
 * ARCH-REVIEW-4: consume() is called only in the signed-in branch (after
 * the sheet opens). Do NOT call consume() in the signed-out branch — a
 * StrictMode double-mount would clear the stash before /auth can read it.
 *
 * ARCH-REVIEW-5: presentation: 'card' (set in _layout.tsx), not
 * 'transparentModal' — cold-start with this as first screen would paint
 * over a black void with a transparent modal.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { validateUrl } from '@/lib/urlValidation';
import * as pendingImport from '@/lib/pendingImport';
import { ImportLinkSheet } from '@/components/wishlist';

export default function ImportScreen() {
    const { url, nonce } = useLocalSearchParams<{ url?: string; nonce?: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { session } = useAuth();

    const [sheetVisible, setSheetVisible] = useState(false);
    const [didRoute, setDidRoute] = useState(false);

    useEffect(() => {
        if (didRoute) return;

        const rawUrl = Array.isArray(url) ? url[0] : url;

        // No URL provided — show error.
        if (!rawUrl) {
            setDidRoute(true);
            return;
        }

        // Signed out — stash and redirect to auth.
        // ARCH-REVIEW-4: do NOT consume() here.
        // Fix-pass-2 item 4: pass the `nonce` route param through to stash so a
        // transient-null-session render cannot rotate the import_nonce, and the
        // signed-out → resume flow reuses the same job-level idempotency key.
        if (!session) {
            setDidRoute(true);
            const rawNonce = typeof nonce === 'string' ? nonce : undefined;
            pendingImport.stash(rawUrl, rawNonce).then(() => {
                router.replace('/auth');
            });
            return;
        }

        // Signed in — validate the URL.
        const validation = validateUrl(rawUrl.trim());
        if (!validation.ok) {
            setDidRoute(true);
            // Error state is rendered inline; user taps to go back.
            return;
        }

        // Valid URL + signed in → open the sheet.
        // Defensive consume: clear any lingering stash (covers the race where
        // the user signed in elsewhere and re-launched via a share).
        pendingImport.consume().catch(() => {/* ignore */});
        setSheetVisible(true);
        setDidRoute(true);
    // url is intentionally read once on first session check; the didRoute guard
    // prevents re-entry if Expo Router re-emits the param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    const rawUrl = Array.isArray(url) ? url[0] : url;
    const urlIsInvalid = rawUrl
        ? !validateUrl(rawUrl.trim()).ok
        : true;

    const handleDismiss = () => {
        setSheetVisible(false);
        router.replace('/(tabs)/feed' as any);
    };

    const handleErrorTap = () => {
        router.replace('/(tabs)/feed' as any);
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            {/* Warm-paper full-screen backdrop — visible while the sheet animates
                in, or when showing an error. Continuous with the sheet's bg. */}
            <View
                style={[
                    styles.root,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingTop: insets.top + Spacing.xxl,
                        paddingBottom: insets.bottom + Spacing.lg,
                    },
                ]}
            >
                {/* Error state — invalid or missing URL */}
                {(!rawUrl || urlIsInvalid) && !sheetVisible && (
                    <Pressable onPress={handleErrorTap} style={styles.errorContainer}>
                        <Text
                            style={[
                                Type.headlineItalic,
                                { color: palette.text, textAlign: 'center' },
                            ]}
                        >
                            {`couldn't read that link`}
                        </Text>
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, textAlign: 'center', marginTop: Spacing.sm },
                            ]}
                        >
                            tap anywhere to go back
                        </Text>
                    </Pressable>
                )}

                {/* Loading placeholder — visible while the sheet mounts */}
                {rawUrl && !urlIsInvalid && (
                    <Text
                        style={[
                            Type.headlineItalic,
                            { color: palette.textMuted, textAlign: 'center' },
                        ]}
                    >
                        opening link...
                    </Text>
                )}
            </View>

            {/* ImportLinkSheet — opens with initialUrl pre-set so the resolver
                fires immediately, skipping the paste step.
                Fix 9: also passes initialImportNonce from the stash so the sheet
                seeds its importNonceRef from the pre-auth nonce. */}
            {rawUrl && !urlIsInvalid && (
                <ImportLinkSheet
                    visible={sheetVisible}
                    initialUrl={rawUrl}
                    initialImportNonce={typeof nonce === 'string' ? nonce : undefined}
                    onDismiss={handleDismiss}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
    errorContainer: {
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
    },
});
