/**
 * join-table.tsx — in-app receive screen for table invite links.
 *
 * Entry: napkin://join-table?code={code}  (custom scheme; invite-page web CTA)
 *
 * Lifecycle (one state machine):
 *   1. Read `code` param.
 *   2. Signed out → stash CODE ONLY via pendingInvite; redirect to /auth.
 *      (do NOT consume here — postAuthResume routes back after sign-in.)
 *   3. Signed in → redeem the code via useJoinByInvite:
 *      - joining → warm-paper spinner
 *      - success → /(tabs)/tables?selected=<table_id> (already_member lands here too)
 *      - invalid/error → tombstone slab (handoff's voice)
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useJoinByInvite } from '@/hooks/tables/useJoinByInvite';
import * as pendingInvite from '@/lib/pendingInvite';

// ── Tombstone screen ──────────────────────────────────────────────────────────

function TombstoneScreen({
    palette,
    onClose,
    insets,
}: {
    palette: typeof Colors.light;
    onClose: () => void;
    insets: { top: number; bottom: number };
}) {
    return (
        <View
            style={[
                styles.tombRoot,
                { backgroundColor: palette.background, paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.lg },
            ]}
        >
            <Text style={[styles.tombTitle, { color: palette.text }]}>
                {'this invite\'s been folded away.'}
            </Text>
            <Text style={[styles.tombMurmur, { color: palette.textMuted }]}>
                {'— the link\'s closed. ask whoever shared it for a fresh one.'}
            </Text>
            <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.tombClose, { opacity: pressed ? 0.65 : 1 }]}
                accessibilityLabel="close"
            >
                <Text style={[Type.label, { color: palette.textMuted }]}>close</Text>
            </Pressable>
        </View>
    );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function JoinTableScreen() {
    const { code: codeParam } = useLocalSearchParams<{ code?: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { session, user } = useAuth();

    const code = Array.isArray(codeParam) ? codeParam[0] : codeParam;

    const joinByInvite = useJoinByInvite(user?.id);
    const [failed, setFailed] = useState(false);
    const didRun = useRef(false);

    useEffect(() => {
        if (didRun.current) return;
        if (!code) {
            didRun.current = true;
            setFailed(true);
            return;
        }
        if (!session) {
            // Signed out — stash CODE ONLY, do NOT consume here.
            didRun.current = true;
            pendingInvite.stash(code).then(() => router.replace('/auth'));
            return;
        }
        // Signed in — redeem once.
        didRun.current = true;
        joinByInvite
            .mutateAsync(code)
            .then((result) => {
                router.replace({
                    pathname: '/(tabs)/tables',
                    params: { selected: result.table_id },
                } as any);
            })
            .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    if (!code || failed) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <TombstoneScreen
                    palette={palette}
                    // Cold-start deep links land here with no back stack — fall
                    // through to the tables tab instead of a dead control.
                    onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/tables'))}
                    insets={insets}
                />
            </>
        );
    }

    if (!session) return null; // routing to /auth — show nothing

    // Joining — warm-paper spinner.
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.centeredRoot,
                    { backgroundColor: palette.background, paddingTop: insets.top },
                ]}
            >
                <ActivityIndicator color={palette.primary} />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    centeredRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tombRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
        gap: Spacing.md,
    },
    tombTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 28,
        textAlign: 'center',
    },
    tombMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 21,
        textAlign: 'center',
    },
    tombClose: {
        marginTop: Spacing.lg,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.lg,
    },
});
