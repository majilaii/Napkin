/**
 * ImportLinkSheet — paste-a-link wishlist import (TICKET-053 + TICKET-060 + TICKET-063).
 *
 * TICKET-063: replaces 'picking' + 'confirming' with a single CandidatePickerPanel
 * that handles 1–N candidates with multi-select, per-row correction, note field
 * (single-ticked-only), and the save_spots action via useSaveImportSpots.
 *
 * State machine:
 *   'idle'                → user types / clipboard chip / tap "find it"
 *   'loading'             → resolver in-flight; cancel button aborts
 *   'picking'             → CandidatePickerPanel (1–N candidates, multi-select)
 *   'editing-match'       → wrong restaurant? — inline Places search, per-row
 *   'zero'                → resolver returned 0 candidates → "search manually"
 *   'error'               → retryable network/5xx error
 *   'rate-limited'        → 429 from resolver
 *   'screenshot-uploading'→ uploading + running resolve-url with image_path
 *   'destination'         → DestinationPicker for async capture fan-out
 *   'ig-nudge'            → Instagram link detected — show screenshot suggestion
 *
 * TICKET-063 changes:
 *   - 'confirming' removed; 'picking' handles both 1 and N candidates.
 *   - useSaveImportSpots replaces useWishlistAdd for the save_spots path.
 *   - useWishlistAdd retained for the legacy single-candidate 'editing-match' path.
 *   - per-row correction: onCorrectRow(candidate) sets editCorrectionForCandidate
 *     and transitions to 'editing-match'; picking a result swaps that row.
 *   - pendingImport.stash now carries import_nonce (ARCH-REVIEW-2 #12).
 *   - import_nonce generated once per URL/share and carried through save.
 *
 * Design refs: Heirloom Journal. Warm paper bg, Newsreader italic, Manrope body.
 * No emoji in chrome. No 1px solid borders. Ambient shadow only.
 */
import React, {
    useState,
    useRef,
    useCallback,
    useEffect,
} from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { validateUrl } from '@/lib/urlValidation';
import {
    useResolveUrl,
    type ResolvedCandidate,
    type ResolveUrlData,
} from '@/hooks/wishlist/useResolveUrl';
import { useCreateImport } from '@/hooks/wishlist/useCreateImport';
import { useSaveImportSpots } from '@/hooks/wishlist/useSaveImportSpots';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { downscaleAndUpload } from '@/lib/imageDownscale';
import { DestinationPicker, type DestinationSelection } from './DestinationPicker';
import { CandidatePickerPanel, buildInitialTicked, keyFor } from './CandidatePickerPanel';

// ── Types ────────────────────────────────────────────────────────────────────

type SheetState =
    | 'idle'
    | 'loading'
    | 'picking'               // TICKET-063: replaces picking + confirming
    | 'editing-match'
    | 'zero'
    | 'error'
    | 'rate-limited'
    | 'screenshot-uploading'
    | 'destination'
    | 'ig-nudge';

interface InlineSearchResult {
    id: string;
    name: string | null;
    formattedAddress: string | null;
    city: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    cuisine: string | null;
    googleRating: number | null;
    googleRatingCount: number | null;
    priceLevel: number | null;
    photoReference: string | null;
}

export interface ImportLinkSheetProps {
    visible: boolean;
    onDismiss: () => void;
    /**
     * When set, the sheet skips the paste step and jumps directly to the
     * 'loading' state with this URL pre-resolved. Used by the iOS share
     * extension deep-link path (app/import.tsx). Validated internally via
     * the same validateUrl() helper the paste step uses.
     */
    initialUrl?: string;
    /**
     * TICKET-063 fix-pass-1 item 9: pre-minted import_nonce from the signed-out
     * stash, threaded through auth → /import → this prop.
     * When set, the importNonceRef is seeded from it so a retry after sign-in
     * uses the same job-level idempotency key as the original share.
     */
    initialImportNonce?: string;
}

type Palette = typeof Colors.light;

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateHost(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return host.length > 30 ? host.slice(0, 27) + '...' : host;
    } catch {
        return url.slice(0, 30);
    }
}

function generateNonce(): string {
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
        return (crypto as any).randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportLinkSheet({ visible, onDismiss, initialUrl, initialImportNonce }: ImportLinkSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // ── State ──────────────────────────────────────────────────────────
    const [sheetState, setSheetState] = useState<SheetState>('idle');
    const [inputValue, setInputValue] = useState('');
    const [touched, setTouched] = useState(false);
    const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
    const [resolvedData, setResolvedData] = useState<ResolveUrlData | null>(null);
    const [noteText, setNoteText] = useState('');
    const [lastUrl, setLastUrl] = useState('');
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [retryAfter, setRetryAfter] = useState<number>(0);

    // TICKET-063: stable job-level import_nonce per URL/share.
    // Fix 9: seeded from initialImportNonce prop (carries through signed-out → auth → resume).
    const importNonceRef = useRef<string>(initialImportNonce ?? generateNonce());

    // Fix 7: stable per-spot client nonces keyed by candidate key.
    // Minted once per import; reused across retry taps for idempotency.
    const spotNonceMapRef = useRef<Map<string, string>>(new Map());

    // Fix-pass-2 item 5: tickedKeys lifted to parent so it survives picking↔editing-match
    // transitions (panel unmounts during correction, wiping internal state).
    const [tickedKeys, setTickedKeys] = useState<Set<string>>(new Set());

    // Fix 8: track which candidate keys failed on last save (for partial-failure display).
    const [failedCandidateKeys, setFailedCandidateKeys] = useState<Set<string>>(new Set());
    // Track which candidate keys have already been saved successfully (skip on retry).
    const savedCandidateIdsRef = useRef<Set<string>>(new Set());

    // Inline edit-match search (per-row correction)
    const [editMatchQuery, setEditMatchQuery] = useState('');
    const [editMatchResults, setEditMatchResults] = useState<InlineSearchResult[]>([]);
    const [editMatchLoading, setEditMatchLoading] = useState(false);
    const [editCorrectionForCandidate, setEditCorrectionForCandidate] = useState<ResolvedCandidate | null>(null);
    const editMatchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Patched candidates (corrections applied before save)
    const [patchedCandidates, setPatchedCandidates] = useState<ResolvedCandidate[] | null>(null);

    // TICKET-060: screenshot/vision capture state
    const [screenshotStoragePath, setScreenshotStoragePath] = useState<string | null>(null);

    const inputRef = useRef<TextInput>(null);
    const { resolve, cancel, state: resolverState, data: resolverData, error: resolverError } = useResolveUrl();
    const createImport = useCreateImport(user?.id);
    const saveImportSpots = useSaveImportSpots(user?.id);

    // Effective candidates (patched overrides original)
    const effectiveCandidates = patchedCandidates ?? resolvedData?.candidates ?? [];

    // ── Clipboard probe on mount ───────────────────────────────────────
    useEffect(() => {
        if (!visible) return;
        if (initialUrl) return;
        Clipboard.getStringAsync().then((str) => {
            if (str && /^https?:\/\/\S+$/.test(str.trim())) {
                setClipboardUrl(str.trim());
            } else {
                setClipboardUrl(null);
            }
        }).catch(() => setClipboardUrl(null));
    }, [visible, initialUrl]);

    // ── initialUrl (share extension deep-link) effect ─────────────────
    useEffect(() => {
        if (!visible || !initialUrl || sheetState !== 'idle') return;
        const trimmed = initialUrl.trim();
        const validation = validateUrl(trimmed);
        if (validation.ok) {
            setLastUrl(trimmed);
            setInputValue(trimmed);
            // Fix 9: use initialImportNonce from prop if provided (preserves job-level
            // idempotency through the signed-out → auth → resume flow).
            // Fall back to a fresh nonce when launching a new share directly.
            importNonceRef.current = initialImportNonce ?? generateNonce();
            spotNonceMapRef.current.clear();
            savedCandidateIdsRef.current.clear();
            setFailedCandidateKeys(new Set());
            setTickedKeys(new Set()); // re-initialized when resolver succeeds
            resolve(trimmed);
        } else {
            setErrorCode('INVALID_URL');
            setSheetState('error');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, initialUrl]);

    // ── Resolver state transitions ─────────────────────────────────────
    useEffect(() => {
        if (resolverState === 'loading') {
            setSheetState('loading');
        }
    }, [resolverState]);

    useEffect(() => {
        if (resolverState === 'success' && resolverData) {
            setResolvedData(resolverData);
            setPatchedCandidates(null); // clear any previous corrections

            // TICKET-060: IG nudge
            if (resolverData.ig_nudge) {
                setSheetState('ig-nudge');
                return;
            }

            // TICKET-060: screenshot/vision path goes to destination picker
            if (resolverData.source_type === 'screenshot' || resolverData.source_type === 'vision') {
                setSheetState('destination');
                return;
            }

            if (resolverData.candidates.length === 0) {
                setSheetState('zero');
            } else {
                // TICKET-063: both single and multi-candidate go to 'picking'
                // (CandidatePickerPanel handles the N=1 case as a 1-row list)
                setNoteText(resolverData.note_prefill ?? '');
                // Fix-pass-2 item 5: initialize ticked set in parent so it persists
                // across picking↔editing-match transitions.
                setTickedKeys(buildInitialTicked(resolverData.candidates));
                setSheetState('picking');
            }
        }
    }, [resolverState, resolverData]);

    useEffect(() => {
        if (resolverState === 'error' && resolverError) {
            const cause = (resolverError as any)?.cause;
            const code = cause?.code ?? 'UNKNOWN';
            if (code === 'RATE_LIMITED') {
                setRetryAfter(cause?.details?.retry_after_seconds ?? 60);
                setSheetState('rate-limited');
            } else {
                setErrorCode(code);
                setSheetState('error');
            }
        }
    }, [resolverState, resolverError]);

    // ── Input validation ───────────────────────────────────────────────
    const validationResult = validateUrl(inputValue.trim());
    const inputOk = validationResult.ok;

    const validationMessage = touched && !inputOk
        ? "that doesn't look like a link — paste a tiktok, maps, or restaurant url."
        : null;

    // ── Handlers ───────────────────────────────────────────────────────
    const handleFindIt = useCallback(() => {
        if (!inputOk) {
            setTouched(true);
            return;
        }
        const url = inputValue.trim();
        setLastUrl(url);
        // Fresh nonce per new URL resolve — also clear per-spot nonce map.
        importNonceRef.current = generateNonce();
        spotNonceMapRef.current.clear();
        savedCandidateIdsRef.current.clear();
        setFailedCandidateKeys(new Set());
        setTickedKeys(new Set()); // candidates not yet known; re-initialized on success
        resolve(url);
    }, [inputOk, inputValue, resolve]);

    const handleCancel = useCallback(() => {
        cancel();
        setSheetState('idle');
    }, [cancel]);

    const handleDismiss = useCallback(() => {
        cancel();
        setSheetState('idle');
        setInputValue('');
        setTouched(false);
        setClipboardUrl(null);
        setResolvedData(null);
        setPatchedCandidates(null);
        setNoteText('');
        setLastUrl('');
        setErrorCode(null);
        setEditMatchQuery('');
        setEditMatchResults([]);
        setEditCorrectionForCandidate(null);
        setScreenshotStoragePath(null);
        // Clear nonce maps on dismiss (new import gets fresh nonces).
        spotNonceMapRef.current.clear();
        savedCandidateIdsRef.current.clear();
        setFailedCandidateKeys(new Set());
        setTickedKeys(new Set());
        onDismiss();
    }, [cancel, onDismiss]);

    const handleClipboardChip = useCallback(() => {
        if (clipboardUrl) {
            setInputValue(clipboardUrl);
            setTouched(false);
        }
    }, [clipboardUrl]);

    // TICKET-063: save N ticked spots via useSaveImportSpots.
    // Fix 7: stable nonces — use spotNonceMapRef to get/mint nonces per candidate_id.
    // Fix 8: partial-failure UI — keep sheet open if any spots failed.
    const handleSaveSpots = useCallback((
        ticked: ResolvedCandidate[],
        note: string,
    ) => {
        if (!user?.id || ticked.length === 0) return;

        // Fix 7: get or mint a stable nonce per candidate (reused across retries).
        const getOrMintNonce = (c: ResolvedCandidate): string => {
            const key = c.candidate_id ?? c.restaurant.external_id ?? generateNonce();
            if (!spotNonceMapRef.current.has(key)) {
                spotNonceMapRef.current.set(key, generateNonce());
            }
            return spotNonceMapRef.current.get(key)!;
        };

        // Fix 8: on retry, only send spots that aren't already saved.
        const spotsToSend = ticked.filter((c) => {
            const key = c.candidate_id ?? c.restaurant.external_id ?? '';
            return !savedCandidateIdsRef.current.has(key);
        });

        if (spotsToSend.length === 0) {
            // All ticked spots already saved — dismiss.
            handleDismiss();
            return;
        }

        const spots = spotsToSend.map((c) => ({
            candidate: c,
            client_nonce: getOrMintNonce(c),
            // Fix-pass-2 item 3: forward full place payload so the server upserts
            // restaurants with all metadata, not just name+city.
            place: {
                external_id: c.restaurant.external_id ?? null,
                name: c.restaurant.name ?? null,
                location: {
                    address: c.restaurant.location?.address ?? c.restaurant.formattedAddress ?? undefined,
                    locality: c.restaurant.location?.locality ?? c.restaurant.city ?? undefined,
                    country: c.restaurant.location?.country ?? c.restaurant.country ?? undefined,
                },
                latitude: c.restaurant.latitude ?? null,
                longitude: c.restaurant.longitude ?? null,
                photoReference: c.restaurant.photoReference ?? null,
                photoAttributionHtml: null, // not available on client candidate type
                googleRating: c.restaurant.googleRating ?? null,
                googleRatingCount: c.restaurant.googleRatingCount ?? null,
                priceLevel: c.restaurant.priceLevel ?? null,
                cuisine: c.restaurant.cuisine ?? null,
            },
        }));

        const source = buildSource(inputValue.trim(), resolvedData);

        saveImportSpots.mutate(
            {
                import_nonce: importNonceRef.current,
                spots,
                note: note || undefined,
                source: source as any,
            },
            {
                onSuccess: (result) => {
                    // Track saved candidates so retry skips them.
                    const newFailed = new Set<string>();
                    for (const r of result.results ?? []) {
                        // Find the candidate whose nonce matches.
                        const matchedSpot = spots.find((s) => s.client_nonce === r.client_nonce);
                        if (!matchedSpot) continue;
                        const key = matchedSpot.candidate.candidate_id
                            ?? matchedSpot.candidate.restaurant.external_id ?? '';
                        if (r.status === 'saved' || r.status === 'already_pinned') {
                            savedCandidateIdsRef.current.add(key);
                        } else if (r.status === 'failed') {
                            newFailed.add(key);
                        }
                    }

                    if (newFailed.size > 0) {
                        // Fix 8: partial failure — keep sheet open, mark failed rows.
                        setFailedCandidateKeys(newFailed);
                        // Clear prev failures that now succeeded.
                        setFailedCandidateKeys((prev) => {
                            const next = new Set(prev);
                            for (const [key] of spotNonceMapRef.current) {
                                if (savedCandidateIdsRef.current.has(key)) next.delete(key);
                            }
                            for (const k of newFailed) next.add(k);
                            return next;
                        });
                    } else {
                        // All ticked spots saved — dismiss with confirmation.
                        handleDismiss();
                    }
                },
                onError: () => {
                    // Network/server error: keep sheet open, user can retry.
                },
            },
        );
    }, [user?.id, inputValue, resolvedData, saveImportSpots, handleDismiss]);

    const handleSearchManually = useCallback((query?: string) => {
        handleDismiss();
        router.push({
            pathname: '/(tabs)/search',
            params: { q: query ?? resolvedData?.best_query ?? '' },
        });
    }, [handleDismiss, router, resolvedData]);

    const handleRetry = useCallback(() => {
        setSheetState('idle');
        resolve(lastUrl);
    }, [resolve, lastUrl]);

    // TICKET-063: per-row "not this?" opens edit-match for that specific candidate
    const handleCorrectRow = useCallback((candidate: ResolvedCandidate) => {
        setEditCorrectionForCandidate(candidate);
        const defaultQuery = resolvedData?.best_query ?? candidate.restaurant.name ?? '';
        setEditMatchQuery(defaultQuery);
        setEditMatchResults([]);
        setSheetState('editing-match');
        runEditMatchSearch(defaultQuery);
    }, [resolvedData]);

    // TICKET-060: handle screenshot/photo pick from OS image picker
    const handlePickScreenshot = useCallback(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 1,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];

        setSheetState('screenshot-uploading');
        try {
            if (!user?.id) throw new Error('Not authenticated');
            const { storagePath } = await downscaleAndUpload(asset.uri, user.id);
            setScreenshotStoragePath(storagePath);
            resolve('', storagePath);
        } catch {
            setErrorCode('UPLOAD_FAILED');
            setSheetState('error');
        }
    }, [user?.id, resolve]);

    // TICKET-060: handle destination confirm (async capture fan-out)
    const handleDestinationConfirm = useCallback((selection: DestinationSelection) => {
        if (!user?.id) return;
        createImport.mutate(
            {
                image_path: screenshotStoragePath ?? undefined,
                source_url: lastUrl || undefined,
                destinations: selection,
            },
            {
                onSuccess: () => { handleDismiss(); },
                onError: () => { /* Keep sheet open */ },
            },
        );
    }, [user?.id, createImport, screenshotStoragePath, lastUrl, handleDismiss]);

    // ── Edit-match inline search ───────────────────────────────────────
    const runEditMatchSearch = useCallback(async (q: string) => {
        if (!q.trim()) {
            setEditMatchResults([]);
            return;
        }
        setEditMatchLoading(true);
        try {
            const rows = await callEdgeFn<InlineSearchResult[]>('places-search', {
                body: { query: q.trim(), limit: 5 },
            });
            setEditMatchResults(Array.isArray(rows) ? rows.slice(0, 5) : []);
        } catch {
            setEditMatchResults([]);
        } finally {
            setEditMatchLoading(false);
        }
    }, []);

    const handleEditMatchQueryChange = useCallback((q: string) => {
        setEditMatchQuery(q);
        if (editMatchDebounceRef.current) clearTimeout(editMatchDebounceRef.current);
        editMatchDebounceRef.current = setTimeout(() => runEditMatchSearch(q), 400);
    }, [runEditMatchSearch]);

    const handleEditMatchSelect = useCallback((row: InlineSearchResult) => {
        if (!editCorrectionForCandidate) return;

        const patchedCandidate: ResolvedCandidate = {
            ...editCorrectionForCandidate,
            candidate_id: editCorrectionForCandidate.candidate_id, // preserve stable id
            restaurant: {
                ...editCorrectionForCandidate.restaurant,
                id: row.id,
                external_id: row.id,
                name: row.name,
                formattedAddress: row.formattedAddress,
                city: row.city,
                country: row.country,
                latitude: row.latitude,
                longitude: row.longitude,
                cuisine: row.cuisine,
                googleRating: row.googleRating,
                googleRatingCount: row.googleRatingCount,
                priceLevel: row.priceLevel,
                photoReference: row.photoReference,
            },
            google_place_id: row.id,
            restaurant_id: null, // ghost — server resolves via external_id upsert
            already_wishlisted: false,
        };

        // Patch the candidates list in place
        const current = patchedCandidates ?? resolvedData?.candidates ?? [];
        const oldKey = keyFor(editCorrectionForCandidate);
        const newKey = keyFor(patchedCandidate);
        const patched = current.map((c) => {
            const k = keyFor(c);
            return k === oldKey ? patchedCandidate : c;
        });
        setPatchedCandidates(patched);

        // Fix-pass-2 item 5: remap old key → new key in the lifted ticked set so the
        // corrected row stays ticked (AC: correction "keeps it ticked").
        if (oldKey !== newKey) {
            setTickedKeys((prev) => {
                const next = new Set(prev);
                if (prev.has(oldKey)) {
                    next.delete(oldKey);
                    next.add(newKey);
                }
                return next;
            });
        }

        setEditMatchQuery('');
        setEditMatchResults([]);
        setEditCorrectionForCandidate(null);
        setSheetState('picking');
    }, [editCorrectionForCandidate, patchedCandidates, resolvedData]);

    // ── Source builder ─────────────────────────────────────────────────
    function buildSource(url: string, data: ResolveUrlData | null) {
        if (!data) return undefined;
        const ps = data.partial_source;
        if (data.source_type === 'tiktok') {
            const src: Record<string, string> = { type: 'tiktok', url };
            if (ps?.thumbnail_url) src.thumbnail_url = ps.thumbnail_url;
            if (ps?.author_handle) src.author_handle = ps.author_handle;
            if (ps?.author_name) src.author_name = ps.author_name;
            if (ps?.embed_product_id) src.embed_product_id = ps.embed_product_id;
            return src;
        }
        if (data.source_type === 'google_maps') {
            return { type: 'google_maps', url };
        }
        return { type: 'web', url };
    }

    function sourceTagLabel(): string | null {
        if (!resolvedData) return null;
        if (resolvedData.source_type === 'tiktok') return 'saved from tiktok';
        if (resolvedData.source_type === 'google_maps') return 'from google maps';
        return 'from the web';
    }

    // ── Render ─────────────────────────────────────────────────────────
    const sheetBg = palette.surfaceContainerLow;
    const pb = Math.max(insets.bottom, Spacing.lg);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleDismiss}
        >
            <Pressable
                style={[styles.backdrop, { backgroundColor: palette.overlay }]}
                onPress={handleDismiss}
            >
                <KeyboardAvoidingView
                    style={styles.kavContainer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View
                        style={[
                            styles.sheet,
                            { backgroundColor: sheetBg, paddingBottom: pb },
                            Shadow.ambient,
                        ]}
                        onStartShouldSetResponder={() => true}
                    >
                        <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                        {/* ── IDLE ──────────────────────────────────── */}
                        {sheetState === 'idle' && (
                            <IdlePanel
                                palette={palette}
                                inputValue={inputValue}
                                onChangeText={(t) => { setInputValue(t); if (touched) setTouched(false); }}
                                touched={touched}
                                validationMessage={validationMessage}
                                inputOk={inputOk}
                                onFindIt={handleFindIt}
                                clipboardUrl={clipboardUrl}
                                onClipboardChip={handleClipboardChip}
                                inputRef={inputRef}
                                onPickScreenshot={handlePickScreenshot}
                            />
                        )}

                        {/* ── LOADING ──────────────────────────────── */}
                        {sheetState === 'loading' && (
                            <LoadingPanel
                                palette={palette}
                                onCancel={handleCancel}
                                copy="reading the video…"
                            />
                        )}

                        {/* ── PICKING (TICKET-063: 1–N candidates) ── */}
                        {sheetState === 'picking' && effectiveCandidates.length > 0 && (
                            <CandidatePickerPanel
                                candidates={effectiveCandidates}
                                onSave={handleSaveSpots}
                                isSaving={saveImportSpots.isPending}
                                sourceTag={sourceTagLabel()}
                                onCorrectRow={handleCorrectRow}
                                onOpenRestaurant={(id) => {
                                    handleDismiss();
                                    router.push(('/restaurant/' + id) as any);
                                }}
                                failedCandidateKeys={failedCandidateKeys}
                                palette={palette}
                                ticked={tickedKeys}
                                onToggleTicked={(key) => setTickedKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                })}
                                noteText={noteText}
                                onNoteChange={setNoteText}
                            />
                            // Fix 12: "share to a table" CTA removed (descoped to TICKET-063b).
                        )}

                        {/* ── EDITING-MATCH ────────────────────────── */}
                        {sheetState === 'editing-match' && (
                            <EditMatchPanel
                                palette={palette}
                                query={editMatchQuery}
                                onQueryChange={handleEditMatchQueryChange}
                                results={editMatchResults}
                                isLoading={editMatchLoading}
                                onSelect={handleEditMatchSelect}
                                onBack={() => {
                                    setEditCorrectionForCandidate(null);
                                    setSheetState('picking');
                                }}
                                correcting={editCorrectionForCandidate?.restaurant.name ?? null}
                            />
                        )}

                        {/* ── ZERO ────────────────────────────────── */}
                        {sheetState === 'zero' && (
                            <ZeroPanel
                                palette={palette}
                                onSearchManually={() => handleSearchManually(resolvedData?.best_query ?? '')}
                            />
                        )}

                        {/* ── ERROR ───────────────────────────────── */}
                        {sheetState === 'error' && (
                            <ErrorPanel
                                palette={palette}
                                code={errorCode}
                                onRetry={handleRetry}
                                onSearchManually={() => handleSearchManually()}
                            />
                        )}

                        {/* ── RATE-LIMITED ─────────────────────────── */}
                        {sheetState === 'rate-limited' && (
                            <RateLimitedPanel
                                palette={palette}
                                retryAfter={retryAfter}
                                onRetry={handleRetry}
                            />
                        )}

                        {/* ── SCREENSHOT UPLOADING ─────────────────── */}
                        {sheetState === 'screenshot-uploading' && (
                            <LoadingPanel
                                palette={palette}
                                onCancel={handleCancel}
                                copy="reading it…"
                            />
                        )}

                        {/* ── DESTINATION ──────────────────────────── */}
                        {sheetState === 'destination' && (
                            <DestinationPicker
                                onConfirm={handleDestinationConfirm}
                                onCancel={() => setSheetState('idle')}
                                isSaving={createImport.isPending}
                            />
                        )}

                        {/* ── IG NUDGE ─────────────────────────────── */}
                        {sheetState === 'ig-nudge' && (
                            <IgNudgePanel
                                palette={palette}
                                onPickScreenshot={handlePickScreenshot}
                                onDismiss={() => setSheetState('idle')}
                            />
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Pressable>
        </Modal>
    );
}

// ── Panel sub-components ─────────────────────────────────────────────────────

// Idle
interface IdlePanelProps {
    palette: Palette;
    inputValue: string;
    onChangeText: (t: string) => void;
    touched: boolean;
    validationMessage: string | null;
    inputOk: boolean;
    onFindIt: () => void;
    clipboardUrl: string | null;
    onClipboardChip: () => void;
    inputRef: React.RefObject<TextInput | null>;
    onPickScreenshot?: () => void;
}

function IdlePanel({
    palette,
    inputValue,
    onChangeText,
    validationMessage,
    inputOk,
    onFindIt,
    clipboardUrl,
    onClipboardChip,
    inputRef,
    onPickScreenshot,
}: IdlePanelProps) {
    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>add from link</Text>

            {clipboardUrl ? (
                <Pressable
                    onPress={onClipboardChip}
                    style={({ pressed }) => [
                        styles.clipChip,
                        {
                            backgroundColor: palette.surfaceContainerHigh,
                            opacity: pressed ? 0.8 : 1,
                        },
                    ]}
                    accessibilityLabel={`Paste ${truncateHost(clipboardUrl)}`}
                >
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        {`paste ${truncateHost(clipboardUrl)}`}
                    </Text>
                </Pressable>
            ) : null}

            <TextInput
                ref={inputRef}
                value={inputValue}
                onChangeText={onChangeText}
                onSubmitEditing={onFindIt}
                placeholder="https://..."
                placeholderTextColor={palette.textMuted}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="go"
                accessibilityLabel="paste a restaurant link"
                style={[
                    styles.urlInput,
                    {
                        color: palette.text,
                        borderBottomColor: palette.ruleInkSoft,
                    },
                ]}
                autoFocus
            />

            {validationMessage ? (
                <Text style={[Type.bodySmall, styles.helperText, { color: palette.error }]}>
                    {validationMessage}
                </Text>
            ) : (
                <Text style={[Type.bodySmall, styles.helperText, { color: palette.textMuted }]}>
                    tiktok, google maps, or any restaurant link.
                </Text>
            )}

            <Pressable
                onPress={onFindIt}
                disabled={false}
                accessibilityLabel="find it"
                style={({ pressed }) => [
                    styles.primaryButton,
                    {
                        backgroundColor: inputOk ? palette.primary : palette.surfaceContainerHigh,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
            >
                <Text
                    style={[
                        Type.label,
                        { color: inputOk ? palette.textInverse : palette.textMuted },
                    ]}
                >
                    find it
                </Text>
            </Pressable>

            {onPickScreenshot && (
                <Pressable
                    onPress={onPickScreenshot}
                    hitSlop={8}
                    style={styles.textLinkRow}
                    accessibilityLabel="add a screenshot instead"
                >
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                        or add a screenshot
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

// Loading
function LoadingPanel({ palette, onCancel, copy = 'reading the link…' }: {
    palette: Palette;
    onCancel: () => void;
    copy?: string;
}) {
    return (
        <View style={styles.centeredPanel}>
            <ActivityIndicator color={palette.primary} size="small" />
            <Text style={[Type.headlineItalic, styles.loadingCopy, { color: palette.text }]}>
                {copy}
            </Text>
            <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel="cancel"
                hitSlop={12}
            >
                <Text style={[Type.body, { color: palette.textMuted }]}>cancel</Text>
            </Pressable>
        </View>
    );
}

// EditMatch (per-row correction)
interface EditMatchPanelProps {
    palette: Palette;
    query: string;
    onQueryChange: (q: string) => void;
    results: InlineSearchResult[];
    isLoading: boolean;
    onSelect: (r: InlineSearchResult) => void;
    onBack: () => void;
    /** Name of the candidate being corrected. */
    correcting: string | null;
}

function EditMatchPanel({
    palette,
    query,
    onQueryChange,
    results,
    isLoading,
    onSelect,
    onBack,
    correcting,
}: EditMatchPanelProps) {
    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>find the right one</Text>
            {correcting ? (
                <Text style={[Type.caption, styles.sourceTag, { color: palette.textMuted }]}>
                    replacing: {correcting}
                </Text>
            ) : null}
            <TextInput
                value={query}
                onChangeText={onQueryChange}
                placeholder="search by name or city"
                placeholderTextColor={palette.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                style={[
                    styles.urlInput,
                    {
                        color: palette.text,
                        borderBottomColor: palette.ruleInkSoft,
                    },
                ]}
            />
            {isLoading ? (
                <ActivityIndicator
                    color={palette.primary}
                    size="small"
                    style={{ marginTop: Spacing.md }}
                />
            ) : (
                <ScrollView
                    style={styles.candidateList}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {results.map((row, i) => (
                        <Pressable
                            key={row.id ?? i}
                            onPress={() => onSelect(row)}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ${row.name}`}
                            style={({ pressed }) => [
                                styles.candidateCard,
                                {
                                    backgroundColor: palette.surfaceJournalLow,
                                    opacity: pressed ? 0.85 : 1,
                                },
                            ]}
                        >
                            <View style={styles.candidateText}>
                                <Text
                                    style={[styles.candidateName, { color: palette.text }]}
                                    numberOfLines={1}
                                >
                                    {row.name}
                                </Text>
                                {row.city || row.cuisine ? (
                                    <Text
                                        style={[Type.bodySmall, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                    >
                                        {[row.city, row.cuisine].filter(Boolean).join(' · ')}
                                    </Text>
                                ) : null}
                            </View>
                        </Pressable>
                    ))}
                </ScrollView>
            )}
            <Pressable onPress={onBack} hitSlop={8} style={styles.textLinkRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>back</Text>
            </Pressable>
        </View>
    );
}

// Zero
function ZeroPanel({ palette, onSearchManually }: { palette: Palette; onSearchManually: () => void }) {
    return (
        <View style={styles.centeredPanel}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                {`couldn't spot a restaurant in that video`}
            </Text>
            <Text style={[Type.bodySmall, styles.zeroCopy, { color: palette.textMuted }]}>
                try a different link, or search by name.
            </Text>
            <Pressable
                onPress={onSearchManually}
                style={({ pressed }) => [
                    styles.primaryButton,
                    styles.zeroButton,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityLabel="search manually"
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>search manually</Text>
            </Pressable>
        </View>
    );
}

// Error
function ErrorPanel({ palette, code, onRetry, onSearchManually }: {
    palette: Palette;
    code: string | null;
    onRetry: () => void;
    onSearchManually: () => void;
}) {
    const isTikTokBusy = code === 'UPSTREAM_RATE_LIMITED';
    const msg = isTikTokBusy
        ? 'tiktok is busy — try again in a minute'
        : `couldn't read that link — try again`;

    return (
        <View style={styles.centeredPanel}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                {msg}
            </Text>
            <Pressable
                onPress={onRetry}
                style={({ pressed }) => [
                    styles.primaryButton,
                    styles.zeroButton,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityLabel="retry"
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>retry</Text>
            </Pressable>
            <Pressable onPress={onSearchManually} hitSlop={8} style={styles.textLinkRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>search manually</Text>
            </Pressable>
        </View>
    );
}

// RateLimited
function RateLimitedPanel({ palette, retryAfter, onRetry }: {
    palette: Palette;
    retryAfter: number;
    onRetry: () => void;
}) {
    return (
        <View style={styles.centeredPanel}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                give it a minute
            </Text>
            <Text style={[Type.bodySmall, styles.zeroCopy, { color: palette.textMuted }]}>
                {retryAfter > 0
                    ? `too many requests — try again in ${Math.ceil(retryAfter / 60)} min.`
                    : 'too many requests — try again soon.'}
            </Text>
            <Pressable
                onPress={onRetry}
                style={({ pressed }) => [
                    styles.primaryButton,
                    styles.zeroButton,
                    {
                        backgroundColor: palette.surfaceContainerHigh,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
                accessibilityLabel="retry"
            >
                <Text style={[Type.label, { color: palette.textMuted }]}>retry</Text>
            </Pressable>
        </View>
    );
}

// IgNudge
function IgNudgePanel({ palette, onPickScreenshot, onDismiss }: {
    palette: Palette;
    onPickScreenshot: () => void;
    onDismiss: () => void;
}) {
    return (
        <View style={styles.centeredPanel}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                instagram links are tricky
            </Text>
            <Text style={[Type.bodySmall, styles.zeroCopy, { color: palette.textMuted }]}>
                add a screenshot instead — works every time.
            </Text>
            <Pressable
                onPress={onPickScreenshot}
                style={({ pressed }) => [
                    styles.primaryButton,
                    styles.zeroButton,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityLabel="add a screenshot"
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>add a screenshot</Text>
            </Pressable>
            <Pressable onPress={onDismiss} hitSlop={8} style={styles.textLinkRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>back</Text>
            </Pressable>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    kavContainer: {
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: Spacing.md,
        paddingHorizontal: Spacing.lg,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    sheetTitle: {
        ...Type.headlineItalic,
        marginBottom: Spacing.md,
    },
    clipChip: {
        alignSelf: 'flex-start',
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
    },
    urlInput: {
        ...Type.body,
        paddingVertical: Spacing.sm,
        borderBottomWidth: 1,
        marginBottom: Spacing.xs,
    },
    helperText: {
        marginBottom: Spacing.md,
    },
    primaryButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginTop: Spacing.sm,
    },
    textLinkRow: {
        paddingVertical: Spacing.sm,
        alignItems: 'center',
        minHeight: 48,
        justifyContent: 'center',
    },
    centeredPanel: {
        paddingVertical: Spacing.lg,
        alignItems: 'center',
    },
    loadingCopy: {
        marginTop: Spacing.md,
        marginBottom: Spacing.lg,
        textAlign: 'center',
    },
    sourceTag: {
        marginBottom: Spacing.sm,
    },
    candidateList: {
        maxHeight: 280,
    },
    candidateCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        minHeight: 64,
        ...Shadow.clip,
    },
    candidateText: {
        flex: 1,
    },
    candidateName: {
        ...Type.headlineItalic,
        fontSize: 16,
        flex: 1,
    },
    zeroCopy: {
        textAlign: 'center',
        marginTop: Spacing.sm,
        marginBottom: Spacing.md,
    },
    zeroButton: {
        alignSelf: 'stretch',
    },
});
