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
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { validateUrl } from '@/lib/urlValidation';
import * as pendingImport from '@/lib/pendingImport';
import { enqueueVideoImport } from '@/lib/importQueue';
import { useToast } from '@/providers/ToastProvider';
import { ImportLinkSheet } from '@/components/wishlist';

export default function ImportScreen() {
    const { url, video, nonce } = useLocalSearchParams<{ url?: string; video?: string; nonce?: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { session } = useAuth();
    const toast = useToast();

    const [sheetVisible, setSheetVisible] = useState(false);
    // TICKET-083 stuck-state fix: process per DISTINCT import, keyed on the param
    // value — NOT a one-shot guard. If a user shares a video, leaves the sheet
    // open, backgrounds to TikTok, then shares ANOTHER video, the new param must
    // supersede the stale one (the old one-shot `didRoute` silently ignored it).
    const processedKeyRef = useRef<string | null>(null);

    useEffect(() => {
        const rawVideoParam = Array.isArray(video) ? video[0] : video;
        const rawUrlParam = Array.isArray(url) ? url[0] : url;
        const key = rawVideoParam ? `v:${rawVideoParam}` : rawUrlParam ? `u:${rawUrlParam}` : '';

        // Same import as last processed → ignore Expo Router re-emitting the param.
        if (key === processedKeyRef.current) return;
        processedKeyRef.current = key;

        // A new import supersedes any stale sheet; the keyed sheet remounts fresh.
        setSheetVisible(false);

        // ── Shared VIDEO → enqueue for async background OCR + in-app review
        // (TICKET-083 Part B). No blocking sheet; the processor mounted in
        // _layout drains it. Works signed-out — the manifest is durable and
        // drains on sign-in (single buffer; no pendingImport double-fire). ──
        if (rawVideoParam) {
            const signedIn = !!session;
            enqueueVideoImport(rawVideoParam)
                .then(() => {
                    // Only claim "importing…" once the manifest is actually queued.
                    if (signedIn) toast.show("importing — we'll let you know when it's ready to review");
                })
                .catch(() => {
                    toast.show("couldn't add that video — try sharing again");
                });
            router.replace(signedIn ? ('/wishlist' as any) : '/auth');
            return;
        }

        // No URL → error state rendered inline.
        if (!rawUrlParam) return;

        // Signed out — stash + auth (ARCH-REVIEW-4: do NOT consume here). The nonce
        // keeps job-level idempotency stable across the signed-out → resume flow.
        if (!session) {
            const rawNonce = typeof nonce === 'string' ? nonce : undefined;
            pendingImport.stash(rawUrlParam, rawNonce).then(() => router.replace('/auth'));
            return;
        }

        // Invalid URL → error state rendered inline.
        if (!validateUrl(rawUrlParam.trim()).ok) return;

        // Valid URL + signed in → open the sheet (defensive consume clears any stash).
        pendingImport.consume().catch(() => {/* ignore */});
        setSheetVisible(true);
    }, [video, url, session, nonce, router, toast]);

    const rawUrl = Array.isArray(url) ? url[0] : url;
    const rawVideo = Array.isArray(video) ? video[0] : video;
    // Distinct per import → forces the sheet to remount fresh when a new share
    // arrives (clears any stale half-finished sheet from a prior share).
    const importKey = rawVideo ? `v:${rawVideo}` : rawUrl ? `u:${rawUrl}` : 'none';
    const urlIsInvalid = rawUrl
        ? !validateUrl(rawUrl.trim()).ok
        : true;

    const handleDismiss = () => {
        setSheetVisible(false);
        router.replace('/wishlist' as any);
    };

    const handleErrorTap = () => {
        router.replace('/wishlist' as any);
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
                {!rawVideo && (!rawUrl || urlIsInvalid) && !sheetVisible && (
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
                {(rawVideo || (rawUrl && !urlIsInvalid)) && (
                    <Text
                        style={[
                            Type.headlineItalic,
                            { color: palette.textMuted, textAlign: 'center' },
                        ]}
                    >
                        {rawVideo ? 'opening video...' : 'opening link...'}
                    </Text>
                )}
            </View>

            {/* ImportLinkSheet — opens with initialUrl pre-set so the resolver
                fires immediately, skipping the paste step.
                Fix 9: also passes initialImportNonce from the stash so the sheet
                seeds its importNonceRef from the pre-auth nonce. */}
            {/* VIDEO shares no longer open a sheet — they enqueue + drain in the
                background (see the effect). Only the URL-paste path uses the sheet. */}
            {rawUrl && !urlIsInvalid ? (
                <ImportLinkSheet
                    key={importKey}
                    visible={sheetVisible}
                    initialUrl={rawUrl}
                    initialImportNonce={typeof nonce === 'string' ? nonce : undefined}
                    onDismiss={handleDismiss}
                />
            ) : null}
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
