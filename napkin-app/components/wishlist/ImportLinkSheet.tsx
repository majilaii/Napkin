/**
 * ImportLinkSheet — paste-a-link wishlist import (TICKET-053).
 *
 * State machine:
 *   'idle'         → user types / clipboard chip / tap "find it"
 *   'loading'      → resolver in-flight; cancel button aborts
 *   'picking'      → 2–3 candidates shown (or 1 low/high confidence)
 *   'confirming'   → single candidate selected; editable note; "save to wishlist"
 *   'editing-match'→ wrong restaurant? — inline Places search replaces candidate
 *   'zero'         → resolver returned 0 candidates → "search manually"
 *   'error'        → retryable network/5xx error
 *   'rate-limited' → 429 from resolver
 *
 * Entry points: app/wishlist.tsx header + PlusActionMenu in app/_layout.tsx.
 *
 * Design refs: Heirloom Journal — warm paper bg, Newsreader italic titles,
 * Manrope body, terracotta primary CTA, olive "best match" chip. No emoji in
 * chrome. No 1px solid borders. Ambient shadow only.
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
    Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { validateUrl } from '@/lib/urlValidation';
import { useResolveUrl, type ResolvedCandidate, type ResolveUrlData } from '@/hooks/wishlist/useResolveUrl';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';

// ── Types ────────────────────────────────────────────────────────────────────

type SheetState =
    | 'idle'
    | 'loading'
    | 'picking'
    | 'confirming'
    | 'editing-match'
    | 'zero'
    | 'error'
    | 'rate-limited';

/**
 * Shape returned by `places-search` (see supabase/functions/places-search/index.ts).
 * `id` is the Google place_id (e.g. `ChIJ...`), NOT a Napkin UUID — picking a
 * row makes the candidate a ghost; the wishlist add path will upsert via
 * `restaurants.external_id` server-side.
 */
interface InlineSearchResult {
    id: string;                    // Google place_id
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
    photoAttributionHtml: string | null;
}

interface ImportLinkSheetProps {
    visible: boolean;
    onDismiss: () => void;
}

type Palette = typeof Colors.light;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate a URL to "example.com" for the clipboard chip label. */
function truncateHost(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return host.length > 30 ? host.slice(0, 27) + '...' : host;
    } catch {
        return url.slice(0, 30);
    }
}

/** Build a Places photo thumb URL via the project's `places-photo` proxy. */
function photoUrl(photoReference: string | null | undefined): string | null {
    return placesPhotoProxyUrl(photoReference, { width: 200 }) ?? null;
}

// ── Sub-panels ───────────────────────────────────────────────────────────────

interface CandidateCardProps {
    candidate: ResolvedCandidate;
    isSelected?: boolean;
    onSelect: () => void;
    palette: Palette;
}

function CandidateCard({ candidate, isSelected, onSelect, palette }: CandidateCardProps) {
    const r = candidate.restaurant;
    const thumbUrl = r.photoReference ? photoUrl(r.photoReference) : null;
    const cityLine = [r.city, r.cuisine].filter(Boolean).join(' · ');

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Select ${r.name ?? 'restaurant'}`}
            onPress={onSelect}
            style={({ pressed }) => [
                styles.candidateCard,
                {
                    backgroundColor: isSelected
                        ? palette.primaryMuted
                        : palette.surfaceJournalLow,
                    opacity: pressed ? 0.85 : 1,
                    borderWidth: isSelected ? 1.5 : 0,
                    borderColor: isSelected ? palette.terracottaBorder : 'transparent',
                },
            ]}
        >
            {/* Photo thumb */}
            {thumbUrl ? (
                <Image
                    source={{ uri: thumbUrl }}
                    style={styles.candidateThumb}
                    accessibilityIgnoresInvertColors
                />
            ) : (
                <View
                    style={[
                        styles.candidateThumb,
                        { backgroundColor: palette.surfaceContainerHigh },
                    ]}
                />
            )}

            {/* Text block */}
            <View style={styles.candidateText}>
                <View style={styles.candidateNameRow}>
                    <Text
                        style={[styles.candidateName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {r.name ?? 'Unknown'}
                    </Text>
                    {candidate.confidence === 'exact' && (
                        <View style={[styles.bestMatchChip, { backgroundColor: palette.oliveCream }]}>
                            <Text style={[Type.labelSmall, { color: palette.secondary, textTransform: 'none' }]}>
                                best match
                            </Text>
                        </View>
                    )}
                </View>
                {cityLine ? (
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]} numberOfLines={1}>
                        {cityLine}
                    </Text>
                ) : null}
                {candidate.already_wishlisted && (
                    <Text style={[Type.caption, { color: palette.primary, marginTop: 2 }]}>
                        already on your wishlist
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportLinkSheet({ visible, onDismiss }: ImportLinkSheetProps) {
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
    const [selectedCandidate, setSelectedCandidate] = useState<ResolvedCandidate | null>(null);
    const [noteText, setNoteText] = useState('');
    const [lastUrl, setLastUrl] = useState('');
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [retryAfter, setRetryAfter] = useState<number>(0);

    // Inline edit-match search
    const [editMatchQuery, setEditMatchQuery] = useState('');
    const [editMatchResults, setEditMatchResults] = useState<InlineSearchResult[]>([]);
    const [editMatchLoading, setEditMatchLoading] = useState(false);
    const editMatchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const inputRef = useRef<TextInput>(null);
    const { resolve, cancel, state: resolverState, data: resolverData, error: resolverError } = useResolveUrl();
    const wishlistAdd = useWishlistAdd(user?.id);

    // ── Clipboard probe on mount ───────────────────────────────────────
    useEffect(() => {
        if (!visible) return;
        Clipboard.getStringAsync().then((str) => {
            if (str && /^https?:\/\/\S+$/.test(str.trim())) {
                setClipboardUrl(str.trim());
            } else {
                setClipboardUrl(null);
            }
        }).catch(() => setClipboardUrl(null));
    }, [visible]);

    // ── Resolver state transitions ─────────────────────────────────────
    useEffect(() => {
        if (resolverState === 'loading') {
            setSheetState('loading');
        }
    }, [resolverState]);

    useEffect(() => {
        if (resolverState === 'success' && resolverData) {
            setResolvedData(resolverData);
            if (resolverData.candidates.length === 0) {
                setSheetState('zero');
            } else if (
                resolverData.candidates.length === 1 &&
                resolverData.candidates[0].confidence === 'exact'
            ) {
                // Single exact match — skip picker, go straight to confirm
                const c = resolverData.candidates[0];
                setSelectedCandidate(c);
                setNoteText(resolverData.note_prefill ?? '');
                setSheetState('confirming');
            } else {
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
        resolve(url);
    }, [inputOk, inputValue, resolve]);

    const handleCancel = useCallback(() => {
        cancel();
        setSheetState('idle');
    }, [cancel]);

    const handleDismiss = useCallback(() => {
        cancel();
        if (editMatchDebounceRef.current) {
            clearTimeout(editMatchDebounceRef.current);
            editMatchDebounceRef.current = null;
        }
        setSheetState('idle');
        setInputValue('');
        setTouched(false);
        setClipboardUrl(null);
        setResolvedData(null);
        setSelectedCandidate(null);
        setNoteText('');
        setLastUrl('');
        setErrorCode(null);
        setEditMatchQuery('');
        setEditMatchResults([]);
        onDismiss();
    }, [cancel, onDismiss]);

    useEffect(() => () => {
        if (editMatchDebounceRef.current) clearTimeout(editMatchDebounceRef.current);
    }, []);

    const handleClipboardChip = useCallback(() => {
        if (clipboardUrl) {
            setInputValue(clipboardUrl);
            setTouched(false);
        }
    }, [clipboardUrl]);

    const handleSelectCandidate = useCallback((c: ResolvedCandidate) => {
        setSelectedCandidate(c);
        setNoteText(resolvedData?.note_prefill ?? '');
        setSheetState('confirming');
    }, [resolvedData]);

    const handleSave = useCallback(() => {
        if (!selectedCandidate) return;
        const r = selectedCandidate.restaurant;
        const source = buildSource(inputValue.trim(), resolvedData);
        wishlistAdd.mutate(
            {
                restaurant_id: selectedCandidate.restaurant_id ?? undefined,
                restaurant: selectedCandidate.restaurant_id ? undefined : {
                    external_id: r.external_id,
                    name: r.name ?? '',
                    location: {
                        address: r.formattedAddress ?? undefined,
                        locality: r.city ?? undefined,
                        country: r.country ?? undefined,
                    },
                    latitude: r.latitude ?? undefined,
                    longitude: r.longitude ?? undefined,
                    photoReference: r.photoReference ?? undefined,
                    photoAttributionHtml: r.photoAttributionHtml ?? null,
                    googleRating: r.googleRating ?? undefined,
                    googleRatingCount: r.googleRatingCount ?? undefined,
                    priceLevel: r.priceLevel ?? undefined,
                    cuisine: r.cuisine ?? undefined,
                },
                note: noteText.trim() || undefined,
                source,
            },
            {
                onSuccess: () => {
                    handleDismiss();
                },
                onError: () => {
                    // Keep sheet open on error — user can retry
                },
            },
        );
    }, [selectedCandidate, inputValue, resolvedData, noteText, wishlistAdd, handleDismiss]);

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

    // ── Edit-match inline search ───────────────────────────────────────
    const runEditMatchSearch = useCallback(async (q: string) => {
        if (!q.trim()) {
            setEditMatchResults([]);
            return;
        }
        setEditMatchLoading(true);
        try {
            // `places-search` returns Place objects (id = Google place_id).
            // callEdgeFn already unwraps the response envelope's `data` field,
            // so we receive the array directly.
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
        if (!selectedCandidate) return;
        // Picked row is a Google Places result — `row.id` is a Google place_id,
        // NOT a Napkin restaurant UUID. Treat the patched candidate as a ghost
        // so the save path takes the `restaurant: RestaurantPayload` branch
        // (server upserts via restaurants.external_id) instead of the UUID branch.
        const patched: ResolvedCandidate = {
            ...selectedCandidate,
            restaurant: {
                ...selectedCandidate.restaurant,
                id: row.id,                                  // Google place_id (used as external_id at save time)
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
                photoAttributionHtml: row.photoAttributionHtml,
            },
            google_place_id: row.id,
            restaurant_id: null,                              // ghost — server resolves via external_id upsert
            already_wishlisted: false,
        };
        setSelectedCandidate(patched);
        setEditMatchQuery('');
        setEditMatchResults([]);
        setSheetState('confirming');
    }, [selectedCandidate]);

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
            return src as any;
        }
        if (data.source_type === 'google_maps') {
            return { type: 'google_maps', url } as any;
        }
        return { type: 'web', url } as any;
    }

    // ── Source tag label ───────────────────────────────────────────────
    function sourceTagLabel(): string | null {
        if (!resolvedData) return null;
        if (resolvedData.source_type === 'tiktok') return 'saved from tiktok';
        if (resolvedData.source_type === 'google_maps') return 'from google maps';
        return 'from the web';
    }

    // ── Render helpers ─────────────────────────────────────────────────
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
                        // Prevent backdrop tap from propagating into the sheet
                        onStartShouldSetResponder={() => true}
                    >
                        <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                        {/* ── IDLE panel ──────────────────────────────── */}
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
                            />
                        )}

                        {/* ── LOADING panel ───────────────────────────── */}
                        {sheetState === 'loading' && (
                            <LoadingPanel palette={palette} onCancel={handleCancel} />
                        )}

                        {/* ── PICKING panel ───────────────────────────── */}
                        {sheetState === 'picking' && resolvedData && (
                            <PickingPanel
                                palette={palette}
                                data={resolvedData}
                                sourceTag={sourceTagLabel()}
                                onSelect={handleSelectCandidate}
                                onBack={() => setSheetState('idle')}
                            />
                        )}

                        {/* ── CONFIRMING panel ────────────────────────── */}
                        {sheetState === 'confirming' && selectedCandidate && (
                            <ConfirmPanel
                                palette={palette}
                                candidate={selectedCandidate}
                                sourceTag={sourceTagLabel()}
                                note={noteText}
                                onNoteChange={setNoteText}
                                onSave={handleSave}
                                isSaving={wishlistAdd.isPending}
                                onPickDifferent={resolvedData && resolvedData.candidates.length > 1
                                    ? () => setSheetState('picking')
                                    : undefined}
                                onWrongRestaurant={() => {
                                    setEditMatchQuery(resolvedData?.best_query ?? selectedCandidate.restaurant.name ?? '');
                                    setEditMatchResults([]);
                                    setSheetState('editing-match');
                                    runEditMatchSearch(resolvedData?.best_query ?? selectedCandidate.restaurant.name ?? '');
                                }}
                                onOpenRestaurant={
                                    selectedCandidate.already_wishlisted && selectedCandidate.restaurant_id
                                        ? () => {
                                            handleDismiss();
                                            router.push(`/restaurant/${selectedCandidate.restaurant_id}`);
                                        }
                                        : undefined
                                }
                            />
                        )}

                        {/* ── EDITING-MATCH panel ─────────────────────── */}
                        {sheetState === 'editing-match' && (
                            <EditMatchPanel
                                palette={palette}
                                query={editMatchQuery}
                                onQueryChange={handleEditMatchQueryChange}
                                results={editMatchResults}
                                isLoading={editMatchLoading}
                                onSelect={handleEditMatchSelect}
                                onBack={() => setSheetState('confirming')}
                            />
                        )}

                        {/* ── ZERO panel ──────────────────────────────── */}
                        {sheetState === 'zero' && (
                            <ZeroPanel
                                palette={palette}
                                onSearchManually={() => handleSearchManually(resolvedData?.best_query ?? '')}
                            />
                        )}

                        {/* ── ERROR panel ─────────────────────────────── */}
                        {sheetState === 'error' && (
                            <ErrorPanel
                                palette={palette}
                                code={errorCode}
                                onRetry={handleRetry}
                                onSearchManually={() => handleSearchManually()}
                            />
                        )}

                        {/* ── RATE-LIMITED panel ──────────────────────── */}
                        {sheetState === 'rate-limited' && (
                            <RateLimitedPanel
                                palette={palette}
                                retryAfter={retryAfter}
                                onRetry={handleRetry}
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
}: IdlePanelProps) {
    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>add from link</Text>

            {/* Clipboard chip */}
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

            {/* URL input */}
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

            {/* Helper / validation message */}
            {validationMessage ? (
                <Text style={[Type.bodySmall, styles.helperText, { color: palette.error }]}>
                    {validationMessage}
                </Text>
            ) : (
                <Text style={[Type.bodySmall, styles.helperText, { color: palette.textMuted }]}>
                    tiktok, google maps, or any restaurant link.
                </Text>
            )}

            {/* "find it" CTA — always a Pressable; disabled look when !inputOk */}
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
function LoadingPanel({ palette, onCancel }: { palette: Palette; onCancel: () => void }) {
    return (
        <View style={styles.centeredPanel}>
            <ActivityIndicator color={palette.primary} size="small" />
            <Text style={[Type.headlineItalic, styles.loadingCopy, { color: palette.text }]}>
                reading the link...
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

// Picking
interface PickingPanelProps {
    palette: Palette;
    data: ResolveUrlData;
    sourceTag: string | null;
    onSelect: (c: ResolvedCandidate) => void;
    onBack: () => void;
}

function PickingPanel({ palette, data, sourceTag, onSelect, onBack }: PickingPanelProps) {
    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>add from link</Text>
            {sourceTag ? (
                <Text style={[Type.caption, styles.sourceTag, { color: palette.textMuted }]}>
                    {sourceTag}
                </Text>
            ) : null}
            <ScrollView
                style={styles.candidateList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {data.candidates.map((c, i) => (
                    <CandidateCard
                        key={c.google_place_id ?? i}
                        candidate={c}
                        palette={palette}
                        onSelect={() => onSelect(c)}
                    />
                ))}
            </ScrollView>
            <Pressable onPress={onBack} hitSlop={8} style={styles.textLinkRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>back</Text>
            </Pressable>
        </View>
    );
}

// Confirming
interface ConfirmPanelProps {
    palette: Palette;
    candidate: ResolvedCandidate;
    sourceTag: string | null;
    note: string;
    onNoteChange: (t: string) => void;
    onSave: () => void;
    isSaving: boolean;
    onPickDifferent?: () => void;
    onWrongRestaurant: () => void;
    onOpenRestaurant?: () => void;
}

function ConfirmPanel({
    palette,
    candidate,
    sourceTag,
    note,
    onNoteChange,
    onSave,
    isSaving,
    onPickDifferent,
    onWrongRestaurant,
    onOpenRestaurant,
}: ConfirmPanelProps) {
    const r = candidate.restaurant;
    const cityLine = [r.city, r.cuisine].filter(Boolean).join(' · ');

    return (
        <View>
            {sourceTag ? (
                <Text style={[Type.caption, styles.sourceTag, { color: palette.textMuted }]}>
                    {sourceTag}
                </Text>
            ) : null}

            {/* Restaurant summary */}
            <Text style={[styles.confirmName, { color: palette.text }]} numberOfLines={2}>
                {r.name ?? 'Unknown restaurant'}
            </Text>
            {cityLine ? (
                <Text style={[Type.bodySmall, { color: palette.textMuted }, styles.confirmCity]}>
                    {cityLine}
                </Text>
            ) : null}

            {/* Note textarea */}
            <TextInput
                value={note}
                onChangeText={onNoteChange}
                placeholder="add a note (optional)"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[
                    styles.noteInput,
                    {
                        color: palette.text,
                        borderColor: palette.ruleInkSoft,
                        backgroundColor: palette.card,
                    },
                ]}
                maxLength={280}
            />

            {/* Save CTA — or already-saved state */}
            {candidate.already_wishlisted ? (
                <View>
                    <View
                        style={[
                            styles.primaryButton,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    >
                        <Text style={[Type.label, { color: palette.textMuted }]}>
                            already on your wishlist
                        </Text>
                    </View>
                    {onOpenRestaurant ? (
                        <Pressable onPress={onOpenRestaurant} hitSlop={8} style={styles.textLinkRow}>
                            <Text style={[Type.body, { color: palette.primary }]}>open restaurant</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : (
                <Pressable
                    onPress={onSave}
                    disabled={isSaving}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        {
                            backgroundColor: palette.primary,
                            opacity: pressed || isSaving ? 0.75 : 1,
                        },
                    ]}
                    accessibilityLabel="save to wishlist"
                >
                    {isSaving ? (
                        <ActivityIndicator color={palette.textInverse} size="small" />
                    ) : (
                        <Text style={[Type.label, { color: palette.textInverse }]}>
                            save to wishlist
                        </Text>
                    )}
                </Pressable>
            )}

            {/* Secondary: pick a different one */}
            {onPickDifferent ? (
                <Pressable onPress={onPickDifferent} hitSlop={8} style={styles.textLinkRow}>
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>pick a different one</Text>
                </Pressable>
            ) : null}

            {/* Tertiary: wrong restaurant? */}
            <Pressable onPress={onWrongRestaurant} hitSlop={8} style={styles.textLinkRow}>
                <Text style={[Type.bodySmall, { color: palette.textMuted }]}>wrong restaurant?</Text>
            </Pressable>
        </View>
    );
}

// EditMatch
interface EditMatchPanelProps {
    palette: Palette;
    query: string;
    onQueryChange: (q: string) => void;
    results: InlineSearchResult[];
    isLoading: boolean;
    onSelect: (r: InlineSearchResult) => void;
    onBack: () => void;
}

function EditMatchPanel({
    palette,
    query,
    onQueryChange,
    results,
    isLoading,
    onSelect,
    onBack,
}: EditMatchPanelProps) {
    return (
        <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>find the right one</Text>
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
                {`couldn't find a restaurant in that link`}
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
interface ErrorPanelProps {
    palette: Palette;
    code: string | null;
    onRetry: () => void;
    onSearchManually: () => void;
}

function ErrorPanel({ palette, code, onRetry, onSearchManually }: ErrorPanelProps) {
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
function RateLimitedPanel({
    palette,
    retryAfter,
    onRetry,
}: {
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
    candidateThumb: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
        marginRight: Spacing.md,
        flexShrink: 0,
    },
    candidateText: {
        flex: 1,
    },
    candidateNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    candidateName: {
        ...Type.headlineItalic,
        fontSize: 16,
        flex: 1,
    },
    bestMatchChip: {
        paddingHorizontal: Spacing.xs,
        paddingVertical: 2,
        borderRadius: Radius.sm,
    },
    confirmName: {
        ...Type.headlineItalic,
        fontSize: 18,
        marginBottom: Spacing.xs,
    },
    confirmCity: {
        marginBottom: Spacing.md,
    },
    noteInput: {
        ...Type.body,
        borderWidth: 1,
        borderRadius: Radius.md,
        padding: Spacing.sm,
        minHeight: 72,
        textAlignVertical: 'top',
        marginBottom: Spacing.xs,
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
