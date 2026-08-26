/**
 * handoff.tsx — in-app receive screen for wishlist share links (TICKET-072).
 *
 * Entry: napkin://handoff?t={token}  (custom scheme; share-page web CTA)
 *
 * Lifecycle:
 *   1. Read `t` param.
 *   2. Signed out → stash TOKEN ONLY via pendingHandoff; redirect to /auth.
 *      ARCH-REVIEW-4 pattern: do NOT consume the stash here.
 *   3. Signed in → useResolveHandoff(token):
 *      - loading   → warm paper spinner
 *      - error     → generic error slab
 *      - revoked   → in-app tombstone (journal voice, nameless)
 *      - live      → CandidatePickerPanel with handoff-specific props
 *
 * Pin flow (ARCH-REVIEW-2 #1/#4):
 *   - import_nonce = deriveImportNonce(token)  (job-level idempotency)
 *   - per-spot client_nonce = candidate_id from resolve response (= deriveClientNonce(token, rid))
 *   - handoff_token passed to save_spots for server-side revoke re-check + authoritative source
 *
 * Partial SHARE_REVOKED: any spot returning SHARE_REVOKED tombstones the whole screen.
 *
 * Nonce wiring decision:
 *   The server resolve response sends candidate_id = deriveClientNonce(token, restaurant_id).
 *   The client uses candidate_id directly as client_nonce (cheapest correct wiring — no
 *   re-derivation needed). deriveImportNonce is still computed client-side for import_nonce.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    ActivityIndicator,
    ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { dismissHandoff } from '@/lib/handoffNavigation';
import { CandidatePickerPanel } from '@/components/wishlist/CandidatePickerPanel';
import { buildInitialTicked, keyFor } from '@/components/wishlist/candidatePickerUtils';
import { useResolveHandoff, type ResolveHandoffSpot } from '@/hooks/wishlist/useResolveHandoff';
import { useSaveImportSpots } from '@/hooks/wishlist/useSaveImportSpots';
import { deriveImportNonce } from '@/lib/handoffNonce';
import * as pendingHandoff from '@/lib/pendingHandoff';
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';

// ── Spot mapping ──────────────────────────────────────────────────────────────

/** Map a ResolveHandoffSpot to the ResolvedCandidate shape for CandidatePickerPanel. */
function spotToCandidate(spot: ResolveHandoffSpot): ResolvedCandidate {
    return {
        candidate_id: spot.candidate_id,
        restaurant: {
            id: spot.restaurant.id,
            name: spot.restaurant.name,
            formattedAddress: null,
            city: spot.restaurant.city,
            country: null,
            latitude: null,
            longitude: null,
            categories: [],
            cuisine: spot.restaurant.cuisine,
            googleRating: null,
            googleRatingCount: null,
            priceLevel: null,
            photoReference: null,
            website: null,
            link: null,
            external_id: null,
        },
        confidence: 'high',
        google_place_id: null,
        restaurant_id: spot.restaurant_id,
        already_wishlisted: spot.already_wishlisted,
        city_inferred: false,
        sharer_rating: spot.sharer_rating,
    };
}

// ── Tombstone screen ──────────────────────────────────────────────────────────

function TombstoneScreen({
    murmur,
    palette,
    onClose,
    insets,
}: {
    murmur: string;
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
                {'this napkin\'s been folded away.'}
            </Text>
            <Text style={[styles.tombMurmur, { color: palette.textMuted }]}>
                {murmur}
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

export default function HandoffScreen() {
    const { t } = useLocalSearchParams<{ t?: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { session, user } = useAuth();
    const { show: showToast } = useToast();
    const dismiss = useCallback(() => dismissHandoff(router), [router]);

    const token = Array.isArray(t) ? t[0] : t;

    // ── Signed-out stash + redirect ───────────────────────────────────────────
    const [didRoute, setDidRoute] = useState(false);

    useEffect(() => {
        if (didRoute) return;
        if (!token) {
            setDidRoute(true);
            return;
        }
        if (!session) {
            setDidRoute(true);
            // ARCH-REVIEW-4 pattern: stash TOKEN ONLY, do NOT consume here.
            pendingHandoff.stash(token).then(() => {
                router.replace('/auth');
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    // ── Resolve query ─────────────────────────────────────────────────────────
    const { data: resolveData, isLoading, isError } = useResolveHandoff(
        session && token ? token : null,
    );

    // ── Candidate list + ticked state ─────────────────────────────────────────
    const candidates = useMemo<ResolvedCandidate[]>(
        () => (resolveData?.spots ?? []).map(spotToCandidate),
        [resolveData],
    );

    const [ticked, setTicked] = useState<Set<string>>(new Set());
    const [noteText, setNoteText] = useState('');
    const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
    const [shareRevoked, setShareRevoked] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Initialise ticked when candidates arrive: ALL non-wishlisted spots pre-ticked.
    // All handoff spots have confidence='high' so buildInitialTicked covers them.
    useEffect(() => {
        if (candidates.length > 0) {
            setTicked(buildInitialTicked(candidates));
        }
    }, [candidates]);

    const handleToggle = useCallback((key: string) => {
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    // ── Save mutation ─────────────────────────────────────────────────────────
    const { mutateAsync: saveSpotsAsync } = useSaveImportSpots(user?.id);

    const handleSave = useCallback(async (tickedCandidates: ResolvedCandidate[]) => {
        if (!token || !resolveData?.sharer_name) return;
        if (tickedCandidates.length === 0) return;

        setIsSaving(true);
        setFailedKeys(new Set());

        try {
            const importNonce = await deriveImportNonce(token);

            const result = await saveSpotsAsync({
                import_nonce: importNonce,
                spots: tickedCandidates.map((c) => ({
                    candidate: c,
                    // candidate_id = deriveClientNonce(token, restaurant_id) from server
                    client_nonce: c.candidate_id!,
                })),
                handoff_token: token,
                // source NOT sent — server constructs it authoritatively (ARCH-2 #4)
            });

            // Check for SHARE_REVOKED → tombstone the whole screen
            const hasRevoked = result.results.some(
                (r) => (r as any).code === 'SHARE_REVOKED',
            );
            if (hasRevoked) {
                setShareRevoked(true);
                return;
            }

            // Mark failed rows for retry UI
            const newFailed = new Set<string>(
                result.results
                    .filter((r) => r.status === 'failed')
                    .map((r) => r.candidate_id),
            );
            if (newFailed.size > 0) {
                setFailedKeys(newFailed);
                return;
            }

            const savedCount = result.summary.saved;
            showToast(`pinned ${savedCount} spot${savedCount !== 1 ? 's' : ''}`);
            dismiss();
        } catch {
            showToast('could not pin spots');
        } finally {
            setIsSaving(false);
        }
    }, [token, resolveData, saveSpotsAsync, showToast, dismiss]);

    // ── Render guards ─────────────────────────────────────────────────────────

    if (!token) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <TombstoneScreen
                    murmur="— the link's closed. ask whoever shared it for a fresh one."
                    palette={palette}
                    onClose={dismiss}
                    insets={insets}
                />
            </>
        );
    }

    if (!session) return null; // routing to /auth — show nothing

    if (isLoading) {
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

    if (isError || resolveData?.status === 'revoked' || shareRevoked) {
        const murmur = shareRevoked
            ? 'this napkin has been folded away.'
            : "— the link's closed. ask whoever shared it for a fresh one.";
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <TombstoneScreen
                    murmur={murmur}
                    palette={palette}
                    onClose={dismiss}
                    insets={insets}
                />
            </>
        );
    }

    if (!resolveData || resolveData.status !== 'live') {
        return null;
    }

    const sharerName = resolveData.sharer_name ?? 'someone';
    // TICKET-074: per-list shares carry a frozen list_name → "{SHARER}'S {LIST}".
    const shareLabel = resolveData.list_name ?? 'napkin';
    const kickerText = `${sharerName.toUpperCase()}'S ${shareLabel.toUpperCase()}`;
    const titleText = `${candidates.length} spot${candidates.length !== 1 ? 's' : ''}`;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.root,
                    { backgroundColor: palette.background },
                ]}
            >
                {/* Back row */}
                <View
                    style={[
                        styles.backRow,
                        { paddingTop: insets.top + Spacing.sm },
                    ]}
                >
                    <Pressable
                        onPress={dismiss}
                        hitSlop={12}
                        accessibilityLabel="back"
                    >
                        <Text style={[styles.backLabel, { color: palette.textMuted }]}>
                            ‹ back
                        </Text>
                    </Pressable>
                </View>

                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingBottom: insets.bottom + 40 },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <CandidatePickerPanel
                        candidates={candidates}
                        ticked={ticked}
                        onToggleTicked={handleToggle}
                        noteText={noteText}
                        onNoteChange={setNoteText}
                        onSave={handleSave}
                        isSaving={isSaving}
                        sourceTag={null}
                        kickerOverride={kickerText}
                        titleOverride={titleText}
                        hideCorrect
                        hideNote
                        rowMurmur={(c) =>
                            c.sharer_rating != null ? `their ${c.sharer_rating}` : null
                        }
                        onCorrectRow={() => {/* no-op: fix hidden on handoff rows */}}
                        failedCandidateKeys={failedKeys}
                        palette={palette}
                    />
                </ScrollView>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    centeredRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backRow: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    backLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
    },
    scrollContent: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    // Tombstone
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
