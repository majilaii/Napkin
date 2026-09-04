/**
 * ImportLinkSheet — paste-a-link wishlist import (TICKET-053 + TICKET-060 + TICKET-063).
 *
 * TICKET-063: replaces 'picking' + 'confirming' with a single CandidatePickerPanel
 * that handles 1–N candidates with multi-select, per-row correction, note field
 * (single-ticked-only), and the save_spots action via useSaveImportSpots.
 *
 * State machine:
 *   'menu'                → import-source picker (paste · screenshot · video).
 *                           First step; deep-link entries skip it. A clearer IA
 *                           than mixing the link field with vague text-links.
 *   'idle'                → paste-a-link field (reached from 'menu' or a deep link);
 *                           user types / clipboard chip / tap "find it"
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
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
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
import { classifyImportFailure, importFailureTags } from '@/lib/importFailureCopy';
import { track } from '@/lib/track';
import { markImportCompleted } from '@/lib/importActivation';
import { mintImportMatchCorrection } from '@/lib/importResolution';
import {
    buildCompletenessDestinationIntent,
    expectedImportDestinations,
    importDestinationTargets,
    reconcileImportDestinationNonces,
    type ImportDestinationNonceState,
    type ImportDestinationTarget,
} from '@/lib/importProtocol';
import { downscaleAndUpload } from '@/lib/imageDownscale';
import { extractFromVideo, isVideoImportAvailable } from '@/modules/media-extract';
import {
    buildImportEditMatchSearchBody,
    initialImportEditMatchQuery,
} from '@/lib/importEditMatch';

import { safeRandomUUID } from '@/lib/uuid';
import { sourceNoun } from '@/lib/sourceNoun';
import { DestinationPicker, type DestinationSelection } from './DestinationPicker';
import { useToast } from '@/providers/ToastProvider';
import { CandidatePickerPanel, buildInitialTicked, keyFor, isResolved } from './CandidatePickerPanel';

// Gate the video-import entry point on the iOS-only native module actually being
// linked. Computed once at import (safe — never throws). Android keeps the link
// and screenshot rows but never renders the saved-video row.
const VIDEO_IMPORT_AVAILABLE = Platform.OS === 'ios' && isVideoImportAvailable();

// ── Types ────────────────────────────────────────────────────────────────────

type SheetState =
    | 'menu'                   // TICKET: import-source menu (first step) — paste / screenshot / video
    | 'idle'                   // paste-a-link text field (reached from the menu)
    | 'loading'
    | 'picking'               // TICKET-063: replaces picking + confirming
    | 'editing-match'
    | 'zero'
    | 'error'
    | 'rate-limited'
    | 'screenshot-uploading'
    | 'video-extracting'      // TICKET-082: on-device OCR + voiceover in progress
    | 'destination'
    | 'share-destination'     // TICKET-063b: single-table picker launched from picking
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
    /** Additive launcher hint; existing callers keep the full source menu. */
    openTo?: 'menu' | 'video';
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
    /**
     * TICKET-082: absolute path to a shared video (App Group container) from the
     * share extension. When set, the sheet opens straight into on-device OCR.
     */
    initialVideoPath?: string;
}

type Palette = typeof Colors.light;

// ── Main component ────────────────────────────────────────────────────────────

export function ImportLinkSheet({
    visible,
    onDismiss,
    openTo = 'menu',
    initialUrl,
    initialImportNonce,
    initialVideoPath,
}: ImportLinkSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // ── State ──────────────────────────────────────────────────────────
    // The sheet opens on the import-source menu (paste · screenshot · video).
    // Deep-link entries (initialUrl / initialVideoPath) bypass it immediately.
    const [sheetState, setSheetState] = useState<SheetState>('menu');
    const [inputValue, setInputValue] = useState('');
    const [touched, setTouched] = useState(false);
    // Whether the clipboard holds *some* text — probed with hasStringAsync, which
    // (unlike getStringAsync) does NOT trigger iOS's "Napkin would like to paste"
    // prompt. The actual contents are only read when the user taps the paste chip.
    const [clipboardHasText, setClipboardHasText] = useState(false);
    const [resolvedData, setResolvedData] = useState<ResolveUrlData | null>(null);
    const [noteText, setNoteText] = useState('');
    const [lastUrl, setLastUrl] = useState('');
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [retryAfter, setRetryAfter] = useState<number>(0);

    // TICKET-063: stable job-level import_nonce per URL/share.
    // Fix 9: seeded from initialImportNonce prop (carries through signed-out → auth → resume).
    const importNonceRef = useRef<string>(initialImportNonce ?? safeRandomUUID());

    // Fix 7: stable per-spot client nonces keyed by candidate key.
    // Minted once per import; reused across retry taps for idempotency.
    const spotNonceMapRef = useRef<Map<string, string>>(new Map());

    // Fix-pass-2 item 5: tickedKeys lifted to parent so it survives picking↔editing-match
    // transitions (panel unmounts during correction, wiping internal state).
    const [tickedKeys, setTickedKeys] = useState<Set<string>>(new Set());

    // Fix 8: track which candidate keys failed on last save (for partial-failure display).
    const [failedCandidateKeys, setFailedCandidateKeys] = useState<Set<string>>(new Set());
    // Whole-save failure copy for the picker panel (the root toast is occluded
    // by this modal). Cleared on every fresh attempt so stale copy never sticks.
    const [saveError, setSaveError] = useState<string | null>(null);
    const saveAttemptRef = useRef(0);
    const resetSaveError = useCallback(() => {
        saveAttemptRef.current += 1;
        setSaveError(null);
    }, []);
    // Track which candidate keys have already been saved successfully (skip on retry).
    const savedCandidateIdsRef = useRef<Set<string>>(new Set());

    // TICKET-063b: table chosen via the "share to a table" secondary affordance.
    const [chosenTable, setChosenTable] = useState<{ id: string; name: string } | null>(null);
    const toast = useToast();
    // Stable table_client_nonce per (candidateKey, tableId) — reused across retries.
    // Key format: `${keyFor(c)}:${table_id}`.
    const tableNonceMapRef = useRef<Map<string, string>>(new Map());
    // V2 destination/title nonces live for the whole sheet attempt and survive
    // partial-save retries. They are never derived from mutable row text.
    const destinationNoncesRef = useRef<ImportDestinationNonceState | undefined>(undefined);
    const destinationTargetsRef = useRef<ImportDestinationTarget[] | undefined>(undefined);
    const expectedDestinationsRef = useRef<number | undefined>(undefined);

    // Inline edit-match search (per-row correction)
    const [editMatchQuery, setEditMatchQuery] = useState('');
    const [editMatchResults, setEditMatchResults] = useState<InlineSearchResult[]>([]);
    const [editMatchLoading, setEditMatchLoading] = useState(false);
    const [editMatchError, setEditMatchError] = useState<string | null>(null);
    const [editCorrectionForCandidate, setEditCorrectionForCandidate] = useState<ResolvedCandidate | null>(null);
    const editMatchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Patched candidates (corrections applied before save)
    const [patchedCandidates, setPatchedCandidates] = useState<ResolvedCandidate[] | null>(null);

    // TICKET-060: screenshot/vision capture state
    const [screenshotStoragePath, setScreenshotStoragePath] = useState<string | null>(null);

    const inputRef = useRef<TextInput>(null);
    // TICKET-082: ignore a stale on-device video extraction that finishes after
    // the user cancelled/dismissed (the native op can't be aborted mid-flight).
    const videoReqRef = useRef(0);
    // Retain the picked video URI so "try again" can re-run on-device extraction
    // (video errors carry no URL to re-resolve).
    const lastVideoUriRef = useRef<string | null>(null);
    const { resolve, cancel, state: resolverState, data: resolverData, error: resolverError } = useResolveUrl();
    const createImport = useCreateImport(user?.id);
    const saveImportSpots = useSaveImportSpots(user?.id);
    const {
        coords: editMatchCoords,
        requestIfGranted: requestEditMatchLocationIfGranted,
    } = useNearbyLocation();

    useEffect(() => {
        if (visible) void requestEditMatchLocationIfGranted();
    }, [visible, requestEditMatchLocationIfGranted]);

    // Effective candidates (patched overrides original)
    const effectiveCandidates = patchedCandidates ?? resolvedData?.candidates ?? [];

    // TICKET-079: source-aware copy noun. Before the resolver returns, infer from
    // the URL host (a maps link reads "reading the map…", not "video"); once
    // resolvedData arrives, use its source_type. The screenshot/vision flows are a
    // separate state ('screenshot-uploading') whose panel hardcodes the screenshot
    // copy, so this noun covers the URL paths.
    const noun = sourceNoun(resolvedData?.source_type, lastUrl || inputValue);

    // ── Clipboard probe on mount ───────────────────────────────────────
    // hasStringAsync is a lightweight presence check — it does NOT read the
    // contents and does NOT raise the iOS paste-permission prompt. We only learn
    // whether to offer the chip; the contents are read on tap (a clear user
    // gesture), where one prompt is expected and acceptable.
    useEffect(() => {
        if (!visible) return;
        if (initialUrl) return;
        Clipboard.hasStringAsync()
            .then(setClipboardHasText)
            .catch(() => setClipboardHasText(false));
    }, [visible, initialUrl]);

    // ── initialUrl (share extension deep-link) effect ─────────────────
    // Fires from the freshly-opened menu state — a deep-linked URL skips the
    // import-source menu and resolves immediately.
    useEffect(() => {
        if (!visible || !initialUrl || (sheetState !== 'menu' && sheetState !== 'idle')) return;
        const trimmed = initialUrl.trim();
        const validation = validateUrl(trimmed);
        if (validation.ok) {
            setLastUrl(trimmed);
            setInputValue(trimmed);
            // Fix 9: use initialImportNonce from prop if provided (preserves job-level
            // idempotency through the signed-out → auth → resume flow).
            // Fall back to a fresh nonce when launching a new share directly.
            importNonceRef.current = initialImportNonce ?? safeRandomUUID();
            spotNonceMapRef.current.clear();
            savedCandidateIdsRef.current.clear();
            tableNonceMapRef.current.clear();
            destinationNoncesRef.current = undefined;
            destinationTargetsRef.current = undefined;
            expectedDestinationsRef.current = undefined;
            setFailedCandidateKeys(new Set());
            setTickedKeys(new Set()); // re-initialized when resolver succeeds
            setChosenTable(null);
            resetSaveError();
            resolve(trimmed);
        } else {
            setErrorCode('INVALID_URL');
            setSheetState('error');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, initialUrl, resetSaveError]);

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
        resetSaveError();
        if (!inputOk) {
            setTouched(true);
            return;
        }
        const url = inputValue.trim();
        setLastUrl(url);
        // Fresh nonce per new URL resolve — also clear per-spot nonce map.
        importNonceRef.current = safeRandomUUID();
        spotNonceMapRef.current.clear();
        savedCandidateIdsRef.current.clear();
        tableNonceMapRef.current.clear();
        destinationNoncesRef.current = undefined;
        destinationTargetsRef.current = undefined;
        expectedDestinationsRef.current = undefined;
        setFailedCandidateKeys(new Set());
        setTickedKeys(new Set()); // candidates not yet known; re-initialized on success
        setChosenTable(null);
        resolve(url);
    }, [inputOk, inputValue, resolve, resetSaveError]);

    const handleCancel = useCallback(() => {
        videoReqRef.current++;
        cancel();
        // Cancelling an in-flight resolve drops the user back to the source menu
        // (the top of the flow) rather than the bare paste field.
        setSheetState('menu');
    }, [cancel]);

    const handleDismiss = useCallback(() => {
        videoReqRef.current++;
        cancel();
        // Reset to the source menu so the next open starts at step one.
        setSheetState('menu');
        setInputValue('');
        setTouched(false);
        setClipboardHasText(false);
        setResolvedData(null);
        setPatchedCandidates(null);
        setNoteText('');
        setLastUrl('');
        setErrorCode(null);
        resetSaveError();
        setEditMatchQuery('');
        setEditMatchResults([]);
        setEditCorrectionForCandidate(null);
        setEditMatchError(null);
        setScreenshotStoragePath(null);
        // Clear nonce maps on dismiss (new import gets fresh nonces).
        spotNonceMapRef.current.clear();
        savedCandidateIdsRef.current.clear();
        tableNonceMapRef.current.clear();
        destinationNoncesRef.current = undefined;
        destinationTargetsRef.current = undefined;
        expectedDestinationsRef.current = undefined;
        setFailedCandidateKeys(new Set());
        setTickedKeys(new Set());
        setChosenTable(null);
        onDismiss();
    }, [cancel, onDismiss, resetSaveError]);

    // Reads the clipboard only now — on an explicit tap. This is the single point
    // where iOS may show the paste prompt, and it's user-initiated by design.
    const handleClipboardChip = useCallback(async () => {
        try {
            const str = (await Clipboard.getStringAsync())?.trim() ?? '';
            if (str) {
                setInputValue(str);
                setTouched(false);
            }
        } catch {
            // User dismissed the paste prompt — leave the field as-is.
        }
    }, []);

    // TICKET-063: save N ticked spots via useSaveImportSpots.
    // Fix 7: stable nonces — use spotNonceMapRef to get/mint nonces per candidate_id.
    // Fix 8: partial-failure UI — keep sheet open if any spots failed.
    // TICKET-063b: attach table_id + table_client_nonce for resolved spots when
    // a table is chosen via the "share to a table" affordance.
    const handleSaveSpots = useCallback((
        ticked: ResolvedCandidate[],
        note: string,
    ) => {
        if (!user?.id || ticked.length === 0) return;
        resetSaveError();

        // Fix 7: get or mint a stable nonce per candidate (reused across retries).
        const getOrMintNonce = (c: ResolvedCandidate): string => {
            const key = c.candidate_id ?? c.restaurant.external_id ?? safeRandomUUID();
            if (!spotNonceMapRef.current.has(key)) {
                spotNonceMapRef.current.set(key, safeRandomUUID());
            }
            return spotNonceMapRef.current.get(key)!;
        };

        // TICKET-063b: stable table_client_nonce per (candidateKey, tableId).
        // Key: `${keyFor(c)}:${table_id}` — reused across retries (spec AC).
        const getOrMintTableNonce = (c: ResolvedCandidate, tableId: string): string => {
            const mapKey = `${keyFor(c)}:${tableId}`;
            if (!tableNonceMapRef.current.has(mapKey)) {
                tableNonceMapRef.current.set(mapKey, safeRandomUUID());
            }
            return tableNonceMapRef.current.get(mapKey)!;
        };

        // Fix 8: on retry, only send spots that aren't already saved.
        // Freeze every selected item's nonce before filtering already-accepted
        // rows so retries retain the original exact cardinality declaration.
        for (const candidate of ticked) getOrMintNonce(candidate);
        const spotsToSend = ticked.filter((c) => {
            const key = c.candidate_id ?? c.restaurant.external_id ?? '';
            return !savedCandidateIdsRef.current.has(key);
        });

        if (spotsToSend.length === 0) {
            // All ticked spots already saved — dismiss.
            handleDismiss();
            return;
        }

        const spots = spotsToSend.map((c) => {
            // TICKET-063b: only resolved spots get table fan-out.
            // Ghost spots save wishlist-only even when a table is chosen.
            const spotResolved = isResolved(c);
            return {
                candidate: c,
                client_nonce: getOrMintNonce(c),
                table_id: (chosenTable && spotResolved) ? chosenTable.id : null,
                table_client_nonce: (chosenTable && spotResolved)
                    ? getOrMintTableNonce(c, chosenTable.id)
                    : null,
                // Fix-pass-2 item 3: forward full place payload so the server upserts
                // restaurants with all metadata, not just name+city.
                // TICKET-187: NO photo fields — the server ignores client photo
                // fields entirely and mirrors the hero server-side, post-response,
                // by the DB-derived external_id.
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
                    googleRating: c.restaurant.googleRating ?? null,
                    googleRatingCount: c.restaurant.googleRatingCount ?? null,
                    priceLevel: c.restaurant.priceLevel ?? null,
                    cuisine: c.restaurant.cuisine ?? null,
                },
            };
        });

        const source = buildSource(inputValue.trim(), resolvedData);
        const selection = {
            wishlist: true,
            tableIds: chosenTable ? [chosenTable.id] : [],
            listIds: [],
            newListTitles: [],
        };
        if (!destinationTargetsRef.current) {
            destinationNoncesRef.current = reconcileImportDestinationNonces(
                selection,
                destinationNoncesRef.current,
            );
            destinationTargetsRef.current = importDestinationTargets(
                selection,
                destinationNoncesRef.current,
            );
            expectedDestinationsRef.current = expectedImportDestinations(
                ticked.length,
                destinationTargetsRef.current.length,
            );
        }
        const destinationTargets = destinationTargetsRef.current;

        const attempt = saveAttemptRef.current;
        saveImportSpots.mutate(
            {
                import_nonce: importNonceRef.current,
                spots,
                note: note || undefined,
                source: source as any,
                protocol_generation: 'v2',
                protocol_version: 2,
                expected_destinations: expectedDestinationsRef.current,
                destination_intent: buildCompletenessDestinationIntent(
                    spots.map((spot) => spot.client_nonce),
                    destinationTargets,
                ),
            },
            {
                onSuccess: (result) => {
                    // Track saved candidates so retry skips them.
                    const newFailed = new Set<string>();
                    let membershipLost = false;
                    let anySaved = false;
                    let queuedCount = 0;
                    const seenNonces = new Set<string>();
                    for (const r of result.results ?? []) {
                        // Find the candidate whose nonce matches.
                        const matchedSpot = spots.find((s) => s.client_nonce === r.client_nonce);
                        if (!matchedSpot) continue;
                        seenNonces.add(r.client_nonce);
                        const key = matchedSpot.candidate.candidate_id
                            ?? matchedSpot.candidate.restaurant.external_id ?? '';
                        if (
                            r.status === 'saved' ||
                            r.status === 'already_pinned' ||
                            r.status === 'queued' ||
                            r.status === 'ghost'
                        ) {
                            savedCandidateIdsRef.current.add(key);
                            if (r.status === 'queued') queuedCount += 1;
                            else anySaved = true;
                        } else if (r.status === 'failed') {
                            newFailed.add(key);
                            if ((r as any).code === 'NOT_A_MEMBER') membershipLost = true;
                        }
                    }
                    // A v2 response is one outcome per submitted item. Treat an
                    // omitted row as retryable instead of deleting the only local
                    // replay for an incompletely sealed server job.
                    for (const spot of spots) {
                        if (seenNonces.has(spot.client_nonce)) continue;
                        newFailed.add(keyFor(spot.candidate));
                    }

                    // TICKET-122: a successful in-app save also flips the activation
                    // signal so the empty-state hub collapses full→compact.
                    if (anySaved) markImportCompleted();

                    // Stale table (membership changed mid-flow): drop the share so
                    // retry self-heals to wishlist-only instead of looping the same
                    // unauthorized table share.
                    if (membershipLost) {
                        // V2 intent is immutable once submitted. Keep it frozen so
                        // a retry cannot silently mutate the server job after an
                        // ambiguous/partial response; dismissing starts a new job.
                        toast.show('table access changed · close to start without it');
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
                        if (queuedCount > 0) {
                            toast.show(
                                `${queuedCount} ${queuedCount === 1 ? 'spot is' : 'spots are'} completing…`,
                            );
                        }
                        handleDismiss();
                    }
                },
                onError: (err) => {
                    if (attempt !== saveAttemptRef.current) return;
                    // Keep the sheet open — but SAY something. This handler was
                    // empty until 2026-09-04, so the three pre-network v2
                    // preconditions (and every 4xx/5xx) rendered as a button
                    // that simply did nothing, forever.
                    const { message } = classifyImportFailure(err);
                    setSaveError(message);
                    track('import_save_failed', importFailureTags(err, 'import_link_sheet'));
                },
            },
        );
    }, [user?.id, inputValue, resolvedData, saveImportSpots, handleDismiss, chosenTable, toast, resetSaveError]);

    const handleSearchManually = useCallback((query?: string) => {
        handleDismiss();
        router.push({
            pathname: '/(tabs)/places',
            params: { q: query ?? resolvedData?.best_query ?? '' },
        });
    }, [handleDismiss, router, resolvedData]);

    // TICKET-063b: called when user picks a table in singleTableOnly DestinationPicker.
    // Stores the chosen table and returns to the picking state.
    const handleShareDestConfirm = useCallback((selection: DestinationSelection) => {
        if (selection.table_ids.length === 1 && selection.table_names?.length === 1) {
            setChosenTable({ id: selection.table_ids[0], name: selection.table_names[0] });
        }
        setSheetState('picking');
    }, []);

    // TICKET-082: run on-device extraction for a video URI, then resolve the text.
    // Extracted so both the picker and retry can invoke it.
    const runVideoExtraction = useCallback(async (uri: string) => {
        resetSaveError();
        const myId = ++videoReqRef.current;
        // Defensive guard for stale/deferred iOS deep links opened on another
        // platform. The normal Android UI cannot reach this function because the
        // video row is absent, but a crafted route must not touch the missing module.
        if (!VIDEO_IMPORT_AVAILABLE) {
            setErrorCode('VIDEO_UNAVAILABLE');
            setSheetState('error');
            return;
        }
        setSheetState('video-extracting');
        try {
            const { ocr, transcript } = await extractFromVideo(uri);
            if (videoReqRef.current !== myId) return; // cancelled / dismissed mid-extract
            const extractedText = [ocr.join('\n'), transcript]
                .filter((s) => s && s.trim())
                .join('\n\n')
                .trim();
            if (!extractedText) {
                setErrorCode('VIDEO_EMPTY');
                setSheetState('error');
                return;
            }
            resolve('', undefined, undefined, extractedText);
        } catch {
            if (videoReqRef.current !== myId) return;
            setErrorCode('VIDEO_FAILED');
            setSheetState('error');
        }
    }, [resolve, resetSaveError]);

    const handleRetry = useCallback(() => {
        if (errorCode === 'VIDEO_UNAVAILABLE') {
            setSheetState('menu');
            return;
        }
        // Video errors have no URL to re-resolve — re-run the on-device extract.
        if ((errorCode === 'VIDEO_FAILED' || errorCode === 'VIDEO_EMPTY') && lastVideoUriRef.current) {
            runVideoExtraction(lastVideoUriRef.current);
            return;
        }
        setSheetState('idle');
        resetSaveError();
        resolve(lastUrl);
    }, [resolve, lastUrl, errorCode, runVideoExtraction, resetSaveError]);

    // ── Edit-match inline search ───────────────────────────────────────
    const runEditMatchSearch = useCallback(async (
        q: string,
        candidate: ResolvedCandidate | null = editCorrectionForCandidate,
    ) => {
        if (!q.trim()) {
            setEditMatchResults([]);
            return;
        }
        setEditMatchLoading(true);
        try {
            const rows = await callEdgeFn<InlineSearchResult[]>('places-search', {
                body: buildImportEditMatchSearchBody(q, candidate, editMatchCoords),
            });
            setEditMatchResults(Array.isArray(rows) ? rows.slice(0, 5) : []);
        } catch {
            setEditMatchResults([]);
        } finally {
            setEditMatchLoading(false);
        }
    }, [editCorrectionForCandidate, editMatchCoords]);

    // TICKET-063: per-row "not this?" opens edit-match for that specific candidate
    const handleCorrectRow = useCallback((candidate: ResolvedCandidate) => {
        setEditMatchError(null);
        setEditCorrectionForCandidate(candidate);
        const defaultQuery = initialImportEditMatchQuery(candidate);
        setEditMatchQuery(defaultQuery);
        setEditMatchResults([]);
        setSheetState('editing-match');
        runEditMatchSearch(defaultQuery, candidate);
    }, [runEditMatchSearch]);

    // TICKET-060: handle screenshot/photo pick from OS image picker
    const handlePickScreenshot = useCallback(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 1,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];

        resetSaveError();
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
    }, [user?.id, resolve, resetSaveError]);

    // TICKET-082: pick a saved video → on-device OCR + voiceover → resolve text.
    // The phone does all the perception (free); we only POST the extracted text.
    const handlePickVideo = useCallback(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Videos,
            quality: 1,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];

        // Fresh nonces for this import (mirrors handleFindIt).
        importNonceRef.current = safeRandomUUID();
        spotNonceMapRef.current.clear();
        savedCandidateIdsRef.current.clear();
        tableNonceMapRef.current.clear();
        destinationNoncesRef.current = undefined;
        destinationTargetsRef.current = undefined;
        expectedDestinationsRef.current = undefined;
        setFailedCandidateKeys(new Set());
        setTickedKeys(new Set());
        setChosenTable(null);
        setLastUrl('');

        lastVideoUriRef.current = asset.uri;
        runVideoExtraction(asset.uri);
    }, [runVideoExtraction]);

    // TICKET-082: share-extension video path → kick off extraction once on open.
    const videoStartedRef = useRef(false);
    useEffect(() => {
        if (visible && initialVideoPath && !videoStartedRef.current) {
            videoStartedRef.current = true;
            lastVideoUriRef.current = initialVideoPath;
            runVideoExtraction(initialVideoPath);
        }
        if (!visible) videoStartedRef.current = false;
    }, [visible, initialVideoPath, runVideoExtraction]);

    // TICKET-230: the Places tray can launch the existing saved-video path
    // directly. This stays additive: every existing caller defaults to `menu`.
    const openToStartedRef = useRef(false);
    useEffect(() => {
        if (
            visible &&
            openTo === 'video' &&
            !initialUrl &&
            !initialVideoPath &&
            !openToStartedRef.current
        ) {
            openToStartedRef.current = true;
            if (VIDEO_IMPORT_AVAILABLE) void handlePickVideo();
        }
        if (!visible) openToStartedRef.current = false;
    }, [handlePickVideo, initialUrl, initialVideoPath, openTo, visible]);

    // TICKET-060: handle destination confirm (async capture fan-out)
    const handleDestinationConfirm = useCallback((selection: DestinationSelection) => {
        resetSaveError();
        if (!user?.id) return;
        const attempt = saveAttemptRef.current;
        createImport.mutate(
            {
                image_path: screenshotStoragePath ?? undefined,
                source_url: lastUrl || undefined,
                destinations: selection,
            },
            {
                onSuccess: () => { handleDismiss(); },
                onError: (err) => {
                    if (attempt !== saveAttemptRef.current) return;
                    const { message } = classifyImportFailure(err);
                    setSaveError(message);
                    track('import_save_failed', importFailureTags(err, 'destination_confirm'));
                },
            },
        );
    }, [user?.id, createImport, screenshotStoragePath, lastUrl, handleDismiss, resetSaveError]);

    const handleEditMatchQueryChange = useCallback((q: string) => {
        setEditMatchQuery(q);
        if (editMatchDebounceRef.current) clearTimeout(editMatchDebounceRef.current);
        editMatchDebounceRef.current = setTimeout(() => runEditMatchSearch(q), 400);
    }, [runEditMatchSearch]);

    const handleEditMatchSelect = useCallback(async (row: InlineSearchResult) => {
        if (!editCorrectionForCandidate || !user?.id) return;
        const expectedOwnerId = user.id;

        setEditMatchLoading(true);
        setEditMatchError(null);
        let freshResolutionId: string;
        try {
            freshResolutionId = await mintImportMatchCorrection({
                import_nonce: importNonceRef.current,
                prior_resolution_id: editCorrectionForCandidate.resolution_id ?? null,
                chosen_external_id: row.id,
                expected_owner_id: expectedOwnerId,
            });
        } catch {
            setEditMatchError("couldn't verify that match — try again");
            setEditMatchLoading(false);
            return;
        }

        const patchedCandidate: ResolvedCandidate = {
            ...editCorrectionForCandidate,
            candidate_id: editCorrectionForCandidate.candidate_id, // preserve stable id
            resolution_id: freshResolutionId,
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
        setEditMatchLoading(false);
    }, [editCorrectionForCandidate, patchedCandidates, resolvedData, user?.id]);

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
        if (data.source_type === 'video') {
            // 'video' also comes back for URL-initiated resolves that rode the
            // extracted_text tier (IG caption, TikTok ASR) — the server never
            // saw the URL. Dropping it here loses the tap-out link forever and
            // diverges from the queue path's provenance. Only a true file
            // import (no url) is a bare 'video' source.
            if (url && /tiktok\.com/i.test(url)) return { type: 'tiktok', url };
            if (url) return { type: 'web', url };
            return { type: 'video' };
        }
        return { type: 'web', url };
    }

    // Canvas kicker: "FROM TIKTOK · @{handle}" — panel uppercases the string.
    // Handle not yet in data model; use source-type label only.
    // TICKET-079: reddit/substack/screenshot get named labels; everything else
    // (the generic 'web' page) falls back to "from the web".
    function sourceTagLabel(): string | null {
        if (!resolvedData) return null;
        switch (resolvedData.source_type) {
            case 'tiktok': return 'from tiktok';
            case 'instagram': return 'from instagram';
            case 'google_maps': return 'from google maps';
            case 'reddit': return 'from reddit';
            case 'substack': return 'from substack';
            case 'screenshot':
            case 'vision': return 'from a screenshot';
            case 'video': {
                // extracted_text tier hides the origin from the server — infer
                // the label from the pasted URL so a reel doesn't read "video".
                const u = inputValue.trim();
                if (/instagram\.com|instagr\.am/i.test(u)) return 'from instagram';
                if (/tiktok\.com/i.test(u)) return 'from tiktok';
                return 'from a video';
            }
            default: return 'from the web';
        }
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

                        {/* ── MENU (import-source picker — first step) ── */}
                        {sheetState === 'menu' && (
                            <SourceMenuPanel
                                palette={palette}
                                onPasteLink={() => setSheetState('idle')}
                                onPickScreenshot={handlePickScreenshot}
                                onPickVideo={VIDEO_IMPORT_AVAILABLE ? handlePickVideo : undefined}
                            />
                        )}

                        {/* ── IDLE (paste a link — second step) ──────── */}
                        {sheetState === 'idle' && (
                            <IdlePanel
                                palette={palette}
                                inputValue={inputValue}
                                onChangeText={(t) => { setInputValue(t); if (touched) setTouched(false); }}
                                touched={touched}
                                validationMessage={validationMessage}
                                inputOk={inputOk}
                                onFindIt={handleFindIt}
                                clipboardHasText={clipboardHasText}
                                onClipboardChip={handleClipboardChip}
                                inputRef={inputRef}
                                onBack={() => setSheetState('menu')}
                            />
                        )}

                        {/* ── LOADING ──────────────────────────────── */}
                        {sheetState === 'loading' && (
                            <LoadingPanel
                                palette={palette}
                                onCancel={handleCancel}
                                copy={`reading the ${noun}…`}
                            />
                        )}

                        {/* ── PICKING (TICKET-063: 1–N candidates) ── */}
                        {sheetState === 'picking' && effectiveCandidates.length > 0 && (
                            <CandidatePickerPanel
                                candidates={effectiveCandidates}
                                onSave={handleSaveSpots}
                                isSaving={saveImportSpots.isPending}
                                sourceTag={sourceTagLabel()}
                                noun={noun}
                                onCorrectRow={(candidate) => {
                                    if (!destinationTargetsRef.current) handleCorrectRow(candidate);
                                }}
                                onOpenRestaurant={(id) => {
                                    handleDismiss();
                                    router.push(('/restaurant/' + id) as any);
                                }}
                                failedCandidateKeys={failedCandidateKeys}
                                errorText={saveError}
                                palette={palette}
                                ticked={tickedKeys}
                                selectionLocked={destinationTargetsRef.current != null}
                                onToggleTicked={(key) => setTickedKeys((prev) => {
                                    if (destinationTargetsRef.current) return prev;
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                })}
                                noteText={noteText}
                                onNoteChange={(text) => {
                                    if (!destinationTargetsRef.current) setNoteText(text);
                                }}
                                chosenTable={chosenTable}
                                onShareToTable={() => {
                                    if (!destinationTargetsRef.current) {
                                        setSheetState('share-destination');
                                    }
                                }}
                                onClearTable={() => {
                                    if (!destinationTargetsRef.current) setChosenTable(null);
                                }}
                                onDismiss={handleDismiss}
                            />
                        )}

                        {/* ── EDITING-MATCH ────────────────────────── */}
                        {sheetState === 'editing-match' && (
                            <EditMatchPanel
                                palette={palette}
                                query={editMatchQuery}
                                onQueryChange={handleEditMatchQueryChange}
                                results={editMatchResults}
                                isLoading={editMatchLoading}
                                errorText={editMatchError}
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
                                noun={noun}
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
                                copy="reading the screenshot…"
                            />
                        )}

                        {/* ── VIDEO EXTRACTING (on-device OCR + voiceover) ── */}
                        {sheetState === 'video-extracting' && (
                            <LoadingPanel
                                palette={palette}
                                onCancel={handleCancel}
                                copy="watching the video…"
                            />
                        )}

                        {/* ── DESTINATION ──────────────────────────── */}
                        {sheetState === 'destination' && (
                            <DestinationPicker
                                onConfirm={handleDestinationConfirm}
                                onCancel={() => setSheetState('menu')}
                                isSaving={createImport.isPending}
                                errorText={saveError}
                            />
                        )}

                        {/* ── SHARE DESTINATION (TICKET-063b) ──────── */}
                        {/* Single-table picker launched from the picking panel. */}
                        {sheetState === 'share-destination' && (
                            <DestinationPicker
                                onConfirm={handleShareDestConfirm}
                                onCancel={() => setSheetState('picking')}
                                isSaving={false}
                                singleTableOnly
                            />
                        )}

                        {/* ── IG NUDGE ─────────────────────────────── */}
                        {sheetState === 'ig-nudge' && (
                            <IgNudgePanel
                                palette={palette}
                                onPickScreenshot={handlePickScreenshot}
                                onDismiss={() => setSheetState('menu')}
                            />
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Pressable>
        </Modal>
    );
}

// ── Panel sub-components ─────────────────────────────────────────────────────

// Source menu — the first step. Distinct, icon-led rows for each import path.
interface SourceMenuRow {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    subtitle: string;
    onPress: () => void;
}

interface SourceMenuPanelProps {
    palette: Palette;
    onPasteLink: () => void;
    onPickScreenshot: () => void;
    /** Undefined until the native video-import module is linked. */
    onPickVideo?: () => void;
}

function SourceMenuPanel({
    palette,
    onPasteLink,
    onPickScreenshot,
    onPickVideo,
}: SourceMenuPanelProps) {
    const rows: SourceMenuRow[] = [
        {
            key: 'link',
            icon: 'link-outline',
            title: 'paste a link',
            subtitle: 'tiktok, google maps, or a website',
            onPress: onPasteLink,
        },
        {
            key: 'screenshot',
            icon: 'image-outline',
            title: 'from a screenshot',
            subtitle: 'a saved photo of a list or a map',
            onPress: onPickScreenshot,
        },
        ...(onPickVideo
            ? [{
                key: 'video',
                icon: 'film-outline' as const,
                title: 'from a video',
                subtitle: 'a saved clip — gets every spot',
                onPress: onPickVideo,
            }]
            : []),
    ];

    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>import spots</Text>
            <Text style={[Type.bodySmall, styles.menuLede, { color: palette.textMuted }]}>
                where are they coming from?
            </Text>

            <View style={styles.menuList}>
                {rows.map((row) => (
                    <Pressable
                        key={row.key}
                        onPress={row.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={row.title}
                        style={({ pressed }) => [
                            styles.menuRow,
                            {
                                backgroundColor: palette.surfaceJournalLow,
                                opacity: pressed ? 0.85 : 1,
                            },
                            Shadow.clip,
                        ]}
                    >
                        <View style={[styles.menuIconWrap, { backgroundColor: palette.surfaceContainerHigh }]}>
                            <Ionicons name={row.icon} size={22} color={palette.primary} />
                        </View>
                        <View style={styles.menuRowText}>
                            <Text style={[styles.menuRowTitle, { color: palette.text }]}>
                                {row.title}
                            </Text>
                            <Text
                                style={[Type.bodySmall, { color: palette.textMuted }]}
                                numberOfLines={1}
                            >
                                {row.subtitle}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

// Idle — the paste-a-link sub-step (reached from the source menu).
interface IdlePanelProps {
    palette: Palette;
    inputValue: string;
    onChangeText: (t: string) => void;
    touched: boolean;
    validationMessage: string | null;
    inputOk: boolean;
    onFindIt: () => void;
    clipboardHasText: boolean;
    onClipboardChip: () => void;
    inputRef: React.RefObject<TextInput | null>;
    /** Returns to the source menu (first step). */
    onBack: () => void;
}

function IdlePanel({
    palette,
    inputValue,
    onChangeText,
    validationMessage,
    inputOk,
    onFindIt,
    clipboardHasText,
    onClipboardChip,
    inputRef,
    onBack,
}: IdlePanelProps) {
    return (
        <View>
            <Pressable
                onPress={onBack}
                hitSlop={8}
                style={styles.backRow}
                accessibilityRole="button"
                accessibilityLabel="back to import options"
            >
                <Ionicons name="chevron-back" size={18} color={palette.textMuted} />
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>back</Text>
            </Pressable>

            <Text style={[styles.sheetTitle, { color: palette.text }]}>paste a link</Text>

            {clipboardHasText ? (
                <Pressable
                    onPress={onClipboardChip}
                    style={({ pressed }) => [
                        styles.clipChip,
                        {
                            backgroundColor: palette.surfaceContainerHigh,
                            opacity: pressed ? 0.8 : 1,
                        },
                    ]}
                    accessibilityLabel="Paste copied link"
                >
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        paste copied link
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
    errorText: string | null;
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
    errorText,
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
            {errorText ? (
                <Text style={[Type.bodySmall, { color: palette.error, marginTop: Spacing.sm }]}>
                    {errorText}
                </Text>
            ) : null}
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
function ZeroPanel({ palette, noun, onSearchManually }: { palette: Palette; noun: string; onSearchManually: () => void }) {
    return (
        <View style={styles.centeredPanel}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                {`couldn't spot a restaurant in that ${noun}`}
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
    const isVideoUnavailable = code === 'VIDEO_UNAVAILABLE';
    const isVideo = code === 'VIDEO_FAILED' || code === 'VIDEO_EMPTY';
    const msg = isTikTokBusy
        ? 'tiktok is busy — try again in a minute'
        : isVideoUnavailable
        ? "video imports aren't available on this device"
        : isVideo
        ? "couldn't read that video — try another"
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
                accessibilityLabel={isVideoUnavailable ? 'back' : 'retry'}
            >
                <Text style={[Type.label, { color: palette.textInverse }]}>
                    {isVideoUnavailable ? 'back' : 'retry'}
                </Text>
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
    menuLede: {
        marginTop: -Spacing.xs,
        marginBottom: Spacing.md,
    },
    menuList: {
        gap: Spacing.sm,
    },
    menuRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        minHeight: 64,
        gap: Spacing.md,
    },
    menuIconWrap: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuRowText: {
        flex: 1,
        gap: 2,
    },
    menuRowTitle: {
        ...Type.headlineItalic,
        fontSize: 17,
    },
    backRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        alignSelf: 'flex-start',
        paddingVertical: Spacing.xs,
        marginBottom: Spacing.xs,
        minHeight: 32,
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
