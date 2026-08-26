/**
 * LogMeal — full-screen logger route (TICKET-071).
 *
 * Presented as an Expo Router modal (presentation: 'modal' in _layout.tsx →
 * native iOS card slide-up, system swipe-down dismiss).
 *
 * Layout is a plain full-screen flex column — NO maxHeight, NO KAV wrapper:
 *   pinned header (safe-area top)
 *   flex-1 ScrollView (body)
 *   pinned footer (true bottom edge with safe-area inset)
 *
 * This eliminates the "floating save button" layout bug that plagued the
 * TICKET-070 sheet (phantom margin from maxHeight + flex-end constructions).
 *
 * Note section uses NoteEditorModal — tapping the preview block slides up a
 * dedicated Letterboxd-style full-screen editor. Both "done" and "close" on
 * that modal commit the draft (never lose text).
 *
 * Param contract (serialized by restaurant/[id].tsx):
 *   restaurant    — JSON-encoded LogSheetRestaurant
 *   initialTableId — optional string (pre-selects a table in SHARE TO +
 *                    used for cache invalidation on success)
 *
 * All LogSheet logic is preserved: photo slot machinery (gen-guards, retry;
 * unbound moderated objects are reclaimed server-side), date edit, companion picker, table checklist,
 * sub-ratings, submit via lib/composer.ts + useCreateEntry hook.
 * Payload contract FROZEN (composer.test.ts must stay green).
 * Toast: "tried {name}" via useToast on success then router.back().
 */
import React, { useState, useCallback, useRef } from 'react';
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useUserProfile } from '@/hooks/users/useUserProfile';
import {
    useAddSupperTake,
    useAttachTakeToSupper,
    isAttachConflict,
    type SupperSuggestion,
} from '@/hooks/suppers';
import { StitchConfirmSheet } from '@/components/suppers';
import { useToast } from '@/providers/ToastProvider';
import { queryKeys } from '@/lib/queryKeys';
import { compressAndUpload, PhotoUploadError } from '@/lib/imageUpload';
import { buildEntryPayload, toggleTableId } from '@/lib/composer';
import type { ComposerBreakdown } from '@/lib/composer';
import { CompanionPickerSheet } from '@/components/logging/CompanionPickerSheet';
import { PhotoMosaic } from '@/components/log/PhotoMosaic';
import { PhotoViewer } from '@/components/log/PhotoViewer';
import { NoteEditorModal } from '@/components/log/NoteEditorModal';
import { CalendarModal } from '@/components/log/CalendarModal';
import type { LogSheetRestaurant } from '@/components/log/LogSheet';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
    uploadGen: number;
}

const MAX_PHOTOS = 6;
const EMPTY_BREAKDOWN: ComposerBreakdown = { vibe: 0, flavor: 0, service: 0, value: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatWhenLabel(date: Date): string {
    const now = new Date();
    const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    const dow = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const d = date.getDate();
    const mon = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    const datePart = `${dow} ${d} ${mon}`;
    return isToday ? `today · ${datePart}` : datePart;
}

function ratingDisplay(value: number): string {
    if (value <= 0) return '—';
    const snapped = Math.round(value * 2) / 2;
    return snapped % 1 === 0 ? `${snapped}.0` : `${snapped}`;
}

// ── Half-star rating ──────────────────────────────────────────────────────────

interface StarRatingProps {
    value: number;
    onChange: (v: number) => void;
    /** Star glyph size — overall appraisal 30, detail rows 24. */
    size?: number;
    /** Voiceover prefix, e.g. "Vibes" → "Vibes 3.5". */
    accessibilityPrefix?: string;
}

function HalfStarRating({ value, onChange, size = 30, accessibilityPrefix = 'Rate' }: StarRatingProps) {
    const wrap = size + 4;
    return (
        <View style={starStyles.row}>
            {[1, 2, 3, 4, 5].map((n) => {
                const filled = value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
                return (
                    <View key={n} style={[starStyles.starWrap, { width: wrap, height: wrap }]}>
                        <Text style={[starStyles.starEmpty, { fontSize: size, lineHeight: wrap }]}>★</Text>
                        {filled > 0 && (
                            <View
                                style={[
                                    starStyles.fillOverlay,
                                    { width: filled === 1 ? '100%' : '50%' },
                                ]}
                            >
                                <Text style={[starStyles.starFilled, { fontSize: size, lineHeight: wrap, width: wrap }]}>★</Text>
                            </View>
                        )}
                        <Pressable
                            style={starStyles.halfLeft}
                            onPress={() => onChange(n - 0.5)}
                            accessibilityLabel={`${accessibilityPrefix} ${n - 0.5}`}
                            hitSlop={{ top: 4, bottom: 4 }}
                        />
                        <Pressable
                            style={starStyles.halfRight}
                            onPress={() => onChange(n)}
                            accessibilityLabel={`${accessibilityPrefix} ${n}`}
                            hitSlop={{ top: 4, bottom: 4 }}
                        />
                    </View>
                );
            })}
        </View>
    );
}

const starStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 2 },
    starWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    starEmpty: {
        color: 'rgba(28,28,25,0.14)',
        textAlign: 'center',
    },
    fillOverlay: {
        position: 'absolute',
        left: 0,
        top: 0,
        height: '100%',
        overflow: 'hidden',
    },
    starFilled: {
        color: '#d97706',
        textAlign: 'center',
    },
    halfLeft: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: '50%',
        height: '100%',
    },
    halfRight: {
        position: 'absolute',
        right: 0,
        top: 0,
        width: '50%',
        height: '100%',
    },
});

// ── Sub-rating row ────────────────────────────────────────────────────────────

interface SubRatingRowProps {
    label: string;
    value: number;
    onChange: (v: number) => void;
    palette: typeof Colors.light;
}

function SubRatingRow({ label, value, onChange, palette }: SubRatingRowProps) {
    // Same control as the overall appraisal (founder, 2026-07-03): the old
    // 15pt whole-star taps were fiddly and couldn't do halves. Re-tapping the
    // current value clears the row (details stay optional).
    return (
        <View style={subStyles.row}>
            <Text style={[subStyles.label, { color: palette.textMuted }]}>
                {label.toUpperCase()}
            </Text>
            <HalfStarRating
                size={24}
                value={value}
                onChange={(v) => onChange(v === value ? 0 : v)}
                accessibilityPrefix={label}
            />
        </View>
    );
}

const subStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 2,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
    },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LogMealScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user, signOut } = useAuth();
    const toast = useToast();
    const qc = useQueryClient();

    // TICKET-075: route a refreshed-and-still-401 session expiry to re-auth
    // instead of a raw "non-2xx" alert.
    const handleSessionExpired = useCallback(async () => {
        toast.show('your session expired — sign in again');
        try { await signOut(); } catch { /* noop */ }
        router.replace('/auth');
    }, [toast, signOut, router]);

    // ── Parse route params ─────────────────────────────────────────────
    const { restaurant: restaurantParam, initialTableId, pageId, supperTakeId } = useLocalSearchParams<{
        restaurant: string;
        initialTableId?: string;
        pageId?: string;
        /** TICKET-082: present → "add your take" mode for an existing Supper. */
        supperTakeId?: string;
    }>();
    // Supper-take mode: this log is the caller's own take on an existing Supper.
    // Reuses the whole logger (rating/note/photos/details) but routes the submit
    // through useAddSupperTake and hides share-to / companions / supper-opt-in
    // (those are inherited from the Supper, not re-chosen per take).
    const isSupperTake = !!supperTakeId;

    const restaurant: LogSheetRestaurant = React.useMemo(() => {
        if (restaurantParam) {
            try { return JSON.parse(restaurantParam); } catch { /* fall through */ }
        }
        return { name: 'Restaurant' };
    }, [restaurantParam]);

    // ── Data ──────────────────────────────────────────────────────────
    const { data: tables } = useTables(user?.id);
    const tableList = tables?.map((m) => m.tables) ?? [];
    const hasAnyTable = tableList.length > 0;

    const createEntry = useCreateEntry(user?.id, null);
    const addSupperTake = useAddSupperTake();
    const attachTake = useAttachTakeToSupper();

    // TICKET-159 stray-log stitch: when the create response carries a
    // supper_suggestion, the save holds on this sheet instead of popping
    // straight back — the author decides; the entry never auto-attaches.
    const [stitch, setStitch] = useState<{ suggestion: SupperSuggestion; entryId: string } | null>(null);

    // ── Form state ──────────────────────────────────────────────────────
    const [rating, setRating] = useState(0);
    // TICKET-075: Letterboxd-style like — independent of the rating value.
    const [liked, setLiked] = useState(false);
    const [visitedAt, setVisitedAt] = useState(new Date());
    // TICKET-078: calendar lives in a bottom-sheet Modal overlay (no layout shift).
    const [calendarVisible, setCalendarVisible] = useState(false);
    const [notes, setNotes] = useState('');
    const [noteEditorVisible, setNoteEditorVisible] = useState(false);
    const [companionPickerVisible, setCompanionPickerVisible] = useState(false);
    const [companions, setCompanions] = useState<UserSearchResult[]>([]);
    // Supper v2: the "make this a Supper" opt-in was retired here — suppers are now
    // created as empty tables from the restaurant page (see project_supper_v2_empty_table).
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>(() =>
        initialTableId ? [initialTableId] : [],
    );
    // TICKET-093: sharing to a table makes the entry public-eligible (decision a);
    // the SHARE TO card carries a transparency line when the account is public.
    const { data: ownProfileResult } = useUserProfile(user?.id);
    const isAccountPublic =
        ownProfileResult?.data?.profile.account_privacy === 'public';
    const [photos, setPhotos] = useState<PhotoSlot[]>([]);
    const [breakdown, setBreakdown] = useState<ComposerBreakdown>(EMPTY_BREAKDOWN);
    const [showDetails, setShowDetails] = useState(false);

    // TICKET-075: calendar day selection — preserves the time component, blocks future.
    const handleCalendarChange = useCallback(
        (event: DateTimePickerEvent, selected?: Date) => {
            // Android's 'calendar' display is itself a system dialog — close the
            // wrapping modal on any Android result. iOS inline stays open until done.
            if (Platform.OS === 'android') setCalendarVisible(false);
            if (event.type === 'dismissed' || !selected) return;
            setVisitedAt((prev) => {
                const next = new Date(selected);
                next.setHours(prev.getHours(), prev.getMinutes(), prev.getSeconds(), prev.getMilliseconds());
                // Guard: never allow a future instant (inline picker maxes the day,
                // but the carried time could still push slightly past now).
                const now = new Date();
                return next.getTime() > now.getTime() ? now : next;
            });
        },
        [],
    );

    // ── Photo viewer state ──────────────────────────────────────────────
    const [viewerVisible, setViewerVisible] = useState(false);
    const [viewerIndex, setViewerIndex] = useState(0);

    // ── Upload generation counter ─────────────────────────────────────
    const uploadGenRefs = useRef(new Map<string, number>());

    // ── Photo machinery ────────────────────────────────────────────────

    const startUploadForSlot = useCallback(async (slotId: string, uri: string) => {
        if (!user?.id) return;
        const gen = (uploadGenRefs.current.get(slotId) ?? 0) + 1;
        uploadGenRefs.current.set(slotId, gen);

        setPhotos((prev) =>
            prev.map((s) => s.id === slotId ? { ...s, uploading: true, error: null } : s),
        );

        try {
            const url = await compressAndUpload(uri, user.id);
            if (uploadGenRefs.current.get(slotId) !== gen) {
                // Approved but unbound: the registry's 48h GC reclaims it.
                return;
            }
            setPhotos((prev) =>
                prev.map((s) =>
                    s.id === slotId ? { ...s, publicUrl: url, uploading: false, uploadGen: gen } : s,
                ),
            );
        } catch (error) {
            if (uploadGenRefs.current.get(slotId) !== gen) return;
            const message = error instanceof PhotoUploadError
                && error.code === 'moderation_rejected'
                ? "That photo can't be used. Tap to choose another."
                : 'Upload failed. Tap to retry.';
            setPhotos((prev) =>
                prev.map((s) =>
                    s.id === slotId ? { ...s, uploading: false, error: message } : s,
                ),
            );
        }
    }, [user?.id]);

    const addPhotoSlot = useCallback((uri: string) => {
        setPhotos((prev) => {
            if (prev.length >= MAX_PHOTOS) return prev;
            const slotId = `photo-${Date.now()}-${Math.random()}`;
            const newSlot: PhotoSlot = {
                id: slotId,
                localUri: uri,
                publicUrl: null,
                uploading: true,
                error: null,
                uploadGen: 0,
            };
            setTimeout(() => startUploadForSlot(slotId, uri), 0);
            return [...prev, newSlot];
        });
    }, [startUploadForSlot]);

    const handleAddPhoto = useCallback(async () => {
        if (!user?.id) return;
        const remaining = MAX_PHOTOS - photos.length;
        if (remaining <= 0) return;

        // SDK 54: the system library picker (PHPicker / Android Photo Picker) is
        // out-of-process and needs NO permission — awaiting a pre-gate was pure
        // latency. Launch straight away; a throw is the only failure to catch.
        let result;
        try {
            result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                selectionLimit: remaining,
                orderedSelection: true,
                quality: 1,
            });
        } catch {
            Alert.alert('Photo Library Unavailable', 'Please try again.');
            return;
        }
        if (result.canceled || !result.assets?.length) return;
        for (const asset of result.assets) {
            addPhotoSlot(asset.uri);
        }
    }, [user?.id, photos.length, addPhotoSlot]);

    const handleRemovePhoto = useCallback((slotId: string) => {
        const currentGen = uploadGenRefs.current.get(slotId) ?? 0;
        uploadGenRefs.current.set(slotId, currentGen + 1);

        setPhotos((prev) => {
            // Approved objects are service-owned; an unbound removal is left
            // for the registry's fenced TTL GC.
            return prev.filter((s) => s.id !== slotId);
        });
    }, []);

    const handleRetryPhoto = useCallback((slotId: string) => {
        const slot = photos.find((s) => s.id === slotId);
        if (slot) startUploadForSlot(slotId, slot.localUri);
    }, [photos, startUploadForSlot]);

    const handleTapPhoto = useCallback((index: number) => {
        setViewerIndex(index);
        setViewerVisible(true);
    }, []);

    const handleViewerRemove = useCallback((slotId: string) => {
        handleRemovePhoto(slotId);
        if (photos.length <= 1) setViewerVisible(false);
    }, [handleRemovePhoto, photos.length]);

    // ── Companion toggle ───────────────────────────────────────────────
    const companionIds = new Set(companions.map((c) => c.user_id));
    const handleToggleCompanion = useCallback((u: UserSearchResult) => {
        setCompanions((prev) => {
            const next = prev.some((c) => c.user_id === u.user_id)
                ? prev.filter((c) => c.user_id !== u.user_id)
                : [...prev, u];
            return next;
        });
    }, []);

    // ── Submit ─────────────────────────────────────────────────────────
    const canSubmit =
        rating > 0 &&
        !createEntry.isPending &&
        !addSupperTake.isPending &&
        !photos.some((p) => p.uploading);

    const handleSave = useCallback(async () => {
        if (!canSubmit || !user?.id) return;

        // ── Supper-take mode: post the caller's own take, not a new log ──
        if (isSupperTake && supperTakeId) {
            const takePhotoUrls = photos
                .filter((p) => p.publicUrl)
                .map((p) => p.publicUrl as string);
            addSupperTake.mutate(
                {
                    supper_id: supperTakeId,
                    rating: Math.round(rating * 2) / 2,
                    content: notes.trim() || null,
                    visited_at: visitedAt.toISOString(),
                    photo_urls: takePhotoUrls,
                    vibe_rating: breakdown.vibe > 0 ? breakdown.vibe : null,
                    flavor_rating: breakdown.flavor > 0 ? breakdown.flavor : null,
                    service_rating: breakdown.service > 0 ? breakdown.service : null,
                    value_rating: breakdown.value > 0 ? breakdown.value : null,
                    liked,
                },
                {
                    onSuccess: () => {
                        // The take is the caller's own entry → surface it in their
                        // Journal (which shows all own entries since 20260616000100).
                        if (user?.id) {
                            qc.invalidateQueries({ queryKey: queryKeys.entries.mySolo(user.id) });
                        }
                        // The take marks the author "been" at the restaurant server-side
                        // → refresh the restaurant page's who's-been / numbers.
                        if (restaurant.id) {
                            qc.invalidateQueries({ queryKey: queryKeys.restaurants.page(restaurant.id) });
                        }
                        toast.show('added your take');
                        router.back();
                    },
                    onError: (err) => {
                        const code = (err as any)?.cause?.code ?? (err as any)?.code;
                        if (code === 'session_expired') {
                            handleSessionExpired();
                            return;
                        }
                        Alert.alert('Error', (err as any)?.message ?? 'Could not add your take');
                    },
                },
            );
            return;
        }

        const photoSlots = photos.map((s) => ({ publicUrl: s.publicUrl }));
        const payload = buildEntryPayload({
            rating,
            notes,
            // TICKET-075: dish removed from the logger — not sent.
            selectedTableIds,
            visitedAt,
            photos: photoSlots,
            breakdown,
            liked,
            selectedCompanions: companions.map((c) => ({ user_id: c.user_id })),
        });

        let restaurantData: any;
        const pp = restaurant.placePayload;
        if (pp) {
            restaurantData = {
                external_id: pp.id ?? pp.external_id ?? restaurant.external_id ?? '',
                name: pp.name ?? restaurant.name,
                location: {
                    address: pp.formattedAddress ?? undefined,
                    locality: pp.city ?? undefined,
                    country: pp.country ?? undefined,
                },
                types: pp.categories ?? ['restaurant'],
                latitude: pp.latitude ?? undefined,
                longitude: pp.longitude ?? undefined,
                photoReference: pp.photoReference ?? undefined,
                photoAttributionHtml: pp.photoAttributionHtml ?? undefined,
                // Founder bug 2026-07-03: first log at a ghost upserted the row
                // WITHOUT these — the invalidated restaurant page then refetched
                // a thin row and the Google numbers vanished until the backfill
                // healed it. The edge fn has forwarded all of these since
                // TICKET-081; the client just never sent them.
                googleRating: pp.googleRating ?? undefined,
                googleRatingCount: pp.googleRatingCount ?? undefined,
                priceLevel: pp.priceLevel ?? undefined,
                cuisine: pp.cuisine ?? undefined,
                phone: pp.phone ?? undefined,
                website: pp.website ?? undefined,
                google_maps_uri: pp.google_maps_uri ?? undefined,
                hours: pp.hours ?? undefined,
            };
        } else if (restaurant.external_id) {
            restaurantData = {
                external_id: restaurant.external_id,
                name: restaurant.name,
                types: ['restaurant'],
            };
        } else if (restaurant.id) {
            restaurantData = undefined;
        }

        createEntry.mutate(
            {
                ...(restaurantData ? { restaurant: restaurantData } : {}),
                ...(restaurant.id && !restaurantData ? { restaurant_id: restaurant.id } : {}),
                ...payload,
            } as any,
            {
                onSuccess: (result) => {
                    // Invalidate the originating page's cache (pageId covers
                    // ghost first-logs where restaurant.id is undefined).
                    const invalidateId = pageId ?? restaurant.id;
                    if (invalidateId) {
                        qc.invalidateQueries({
                            queryKey: queryKeys.restaurants.page(
                                invalidateId,
                                initialTableId ?? undefined,
                            ),
                        });
                    }
                    toast.show(`tried ${restaurant.name}`);
                    // TICKET-159: a supper_suggestion holds the pop-back for the
                    // "add this to the table?" confirm; both answers land back.
                    const suggestion = (result as { supper_suggestion?: SupperSuggestion | null })
                        ?.supper_suggestion;
                    const entryId = (result as { id?: string })?.id;
                    if (suggestion?.supper_id && entryId) {
                        setStitch({ suggestion, entryId });
                        return;
                    }
                    router.back();
                },
                onError: (err) => {
                    const code = (err as any)?.cause?.code ?? (err as any)?.code;
                    if (code === 'session_expired') {
                        handleSessionExpired();
                        return;
                    }
                    if (code !== 'table_not_authorized') {
                        Alert.alert('Error', (err as any)?.message ?? 'Could not save entry');
                    }
                },
            },
        );
    }, [
        canSubmit,
        user?.id,
        rating,
        notes,
        liked,
        selectedTableIds,
        visitedAt,
        photos,
        breakdown,
        companions,
        isSupperTake,
        supperTakeId,
        addSupperTake,
        restaurant,
        initialTableId,
        pageId,
        createEntry,
        toast,
        router,
        qc,
        handleSessionExpired,
    ]);

    // ── Render ─────────────────────────────────────────────────────────
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />

            {/*
             * Plain full-screen flex column — no maxHeight, no KAV at this level.
             * header (pinned) / body (flex-1 scroll) / footer (pinned, true bottom).
             * This is the fix for the "floating save button" complaint (TICKET-071).
             */}
            <View style={[styles.root, { backgroundColor: palette.background }]}>

                {/* ── Pinned header ── */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <View style={styles.headerLeft}>
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>
                            {isSupperTake ? 'ADD YOUR TAKE' : 'LOG A MEAL'}
                        </Text>
                        <Text
                            style={[styles.restaurantName, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {restaurant.name}
                        </Text>
                    </View>
                    <Pressable
                        onPress={() => router.back()}
                        hitSlop={12}
                        accessibilityLabel="close"
                    >
                        <Text style={[styles.closeBtn, { color: palette.textMuted }]}>
                            close
                        </Text>
                    </Pressable>
                </View>

                {/* ── Scrollable body (flex: 1) ── */}
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                >
                    {/* 1 ── YOUR APPRAISAL + rate the details — one vellum card ── */}
                    <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                            YOUR APPRAISAL
                        </Text>
                        <View style={styles.ratingRow}>
                            <HalfStarRating value={rating} onChange={setRating} />
                            <Text
                                style={[
                                    styles.ratingNumeral,
                                    { color: rating > 0 ? '#825516' : palette.textMuted },
                                ]}
                            >
                                {ratingDisplay(rating)}
                            </Text>
                            {/* TICKET-075: like toggle — independent of the rating value. */}
                            <Pressable
                                onPress={() => setLiked((v) => !v)}
                                hitSlop={10}
                                style={styles.likeToggle}
                                accessibilityRole="button"
                                accessibilityState={{ selected: liked }}
                                accessibilityLabel={liked ? 'liked' : 'like'}
                            >
                                <Ionicons
                                    name={liked ? 'heart' : 'heart-outline'}
                                    size={26}
                                    color={liked ? palette.primary : palette.textMuted}
                                />
                            </Pressable>
                        </View>
                        {/* 2 ── rate the details — sub-ratings, inside the appraisal card ── */}
                        <Pressable
                            onPress={() => setShowDetails((v) => !v)}
                            style={[styles.detailsToggle, { marginTop: 2 }]}
                            accessibilityLabel="rate the details"
                            hitSlop={8}
                        >
                            <Text style={[styles.detailsToggleLabel, { color: palette.primary }]}>
                                {showDetails ? '▾ rate the details' : '▸ rate the details'}
                            </Text>
                        </Pressable>
                        {showDetails && (
                            <View style={styles.detailsContent}>
                                <SubRatingRow
                                    label="Vibe"
                                    value={breakdown.vibe}
                                    onChange={(v) =>
                                        setBreakdown((prev) => ({ ...prev, vibe: v }))
                                    }
                                    palette={palette}
                                />
                                <SubRatingRow
                                    label="Flavor"
                                    value={breakdown.flavor}
                                    onChange={(v) =>
                                        setBreakdown((prev) => ({ ...prev, flavor: v }))
                                    }
                                    palette={palette}
                                />
                                <SubRatingRow
                                    label="Service"
                                    value={breakdown.service}
                                    onChange={(v) =>
                                        setBreakdown((prev) => ({ ...prev, service: v }))
                                    }
                                    palette={palette}
                                />
                                <SubRatingRow
                                    label="Value"
                                    value={breakdown.value}
                                    onChange={(v) =>
                                        setBreakdown((prev) => ({ ...prev, value: v }))
                                    }
                                    palette={palette}
                                />
                            </View>
                        )}
                    </View>

                    {/* 3 ── WHEN — month calendar (no future dates) ── */}
                    <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                        <View style={styles.whenRow}>
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                WHEN
                            </Text>
                        </View>
                        <Pressable
                            onPress={() => setCalendarVisible(true)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`when: ${formatWhenLabel(visitedAt)}. tap to change.`}
                        >
                            <Text style={[styles.whenDate, { color: palette.text }]}>
                                {formatWhenLabel(visitedAt)}
                            </Text>
                        </Pressable>
                    </View>

                    {/* 4 ── THE NOTE — tappable preview block → NoteEditorModal ── */}
                    <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                            THE NOTE
                        </Text>
                        <Pressable
                            onPress={() => setNoteEditorVisible(true)}
                            style={[
                                styles.notePreview,
                                { borderBottomColor: palette.ruleInkSoft },
                            ]}
                            accessibilityLabel="edit note"
                            accessibilityRole="button"
                        >
                            {notes.trim() ? (
                                <Text
                                    style={[styles.noteText, { color: palette.text }]}
                                    numberOfLines={6}
                                >
                                    {notes}
                                </Text>
                            ) : (
                                <Text style={[styles.notePlaceholder, { color: palette.textMuted }]}>
                                    — what will you remember?
                                </Text>
                            )}
                        </Pressable>
                    </View>

                    {/* 5 ── PHOTOS — kept prominent (the mosaic is the visual anchor) ── */}
                    <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                            PHOTOS
                        </Text>
                        <PhotoMosaic
                            photos={photos}
                            maxPhotos={MAX_PHOTOS}
                            onAdd={handleAddPhoto}
                            onRemove={handleRemovePhoto}
                            onRetry={handleRetryPhoto}
                            onTapPhoto={handleTapPhoto}
                        />
                    </View>

                    {/* 6 ── WHO WAS THERE — companions + Supper opt-in. Hidden in
                        supper-take mode: the roster is inherited from the Supper. ── */}
                    {!isSupperTake && (
                        <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                WHO WAS THERE
                            </Text>
                            <View style={styles.expanderRow}>
                                <Pressable
                                    onPress={() => setCompanionPickerVisible(true)}
                                    hitSlop={8}
                                    accessibilityLabel="add who was there"
                                >
                                    <Text style={[styles.expander, { color: palette.textMuted }]}>
                                        {companions.length > 0 ? '— who was there' : '+ who was there'}
                                    </Text>
                                </Pressable>
                            </View>

                            {companions.length > 0 && (
                                <Pressable
                                    onPress={() => setCompanionPickerVisible(true)}
                                    hitSlop={8}
                                    accessibilityLabel="edit companions"
                                >
                                    <Text style={[styles.companionsLine, { color: palette.textMuted }]}>
                                        {`with ${companions.map((c) => c.display_name).join(', ')}`}
                                    </Text>
                                </Pressable>
                            )}

                            {/* Supper v2: the "make this a Supper" toggle was RETIRED — a
                                supper is no longer a review you tag people into. It's set as
                                an empty table from the restaurant page ("set a table here"),
                                where everyone (incl. you) adds their own take. Tagging here
                                stays a plain companion log. See [[project_supper_v2_empty_table]]. */}
                        </View>
                    )}

                    {/* 7 ── SHARE TO — hidden when no tables, and in supper-take mode
                        (the take is bound to the Supper, not shared to a Table). ── */}
                    {!isSupperTake && hasAnyTable && (
                        <View style={[styles.card, { backgroundColor: palette.surfaceNote }]}>
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                SHARE TO
                            </Text>
                            {tableList.map((t) => {
                                const checked = selectedTableIds.includes(t.id);
                                return (
                                    <Pressable
                                        key={t.id}
                                        onPress={() =>
                                            setSelectedTableIds((prev) =>
                                                toggleTableId(prev, t.id),
                                            )
                                        }
                                        style={styles.tableRow}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked }}
                                        accessibilityLabel={t.name}
                                    >
                                        <Text
                                            style={[styles.tableName, { color: palette.text }]}
                                            numberOfLines={1}
                                        >
                                            {t.name}
                                        </Text>
                                        <View
                                            style={[
                                                styles.checkCircle,
                                                {
                                                    backgroundColor: checked
                                                        ? palette.primary
                                                        : 'transparent',
                                                    borderColor: checked
                                                        ? palette.primary
                                                        : 'rgba(160,63,40,0.35)',
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.checkMark,
                                                    {
                                                        color: checked
                                                            ? '#fffdf8'
                                                            : 'rgba(160,63,40,0.35)',
                                                    },
                                                ]}
                                            >
                                                ✓
                                            </Text>
                                        </View>
                                    </Pressable>
                                );
                            })}
                            {/* TICKET-093 (decision a) + TICKET-217 P1-1: entries are
                                public-eligible regardless of table selection (solo logs
                                default 'friends' since 2026-07-22) — say so instead of
                                gating. Only when the account is actually public. */}
                            {isAccountPublic && (
                                <Text style={[styles.publicNote, { color: palette.textMuted }]}>
                                    also appears on your public profile
                                </Text>
                            )}
                        </View>
                    )}

                    {/* TICKET-217 P1-1: the SHARE TO card is hidden for no-table
                        users and supper takes, but those logs are public-eligible
                        too — the disclosure must not disappear with the card. */}
                    {(isSupperTake || !hasAnyTable) && isAccountPublic && (
                        <Text style={[styles.publicNote, { color: palette.textMuted, textAlign: 'center' }]}>
                            also appears on your public profile
                        </Text>
                    )}

                    {/* Bottom padding for scroll area */}
                    <View style={{ height: Spacing.lg }} />
                </ScrollView>

                {/* ── Pinned footer — true bottom edge ── */}
                <View
                    style={[
                        styles.footer,
                        {
                            borderTopColor: palette.ruleInkSoft,
                            paddingBottom: insets.bottom > 0 ? insets.bottom : 16,
                        },
                    ]}
                >
                    <Pressable
                        onPress={handleSave}
                        disabled={!canSubmit}
                        accessibilityLabel="Save"
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.saveBtn,
                            {
                                backgroundColor: canSubmit
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                                opacity: pressed
                                    ? 0.85
                                    : createEntry.isPending || addSupperTake.isPending
                                    ? 0.65
                                    : 1,
                            },
                        ]}
                    >
                        {createEntry.isPending || addSupperTake.isPending ? (
                            <ActivityIndicator color="#fffdf8" size="small" />
                        ) : (
                            <Text
                                style={[
                                    styles.saveBtnLabel,
                                    {
                                        color: canSubmit ? '#fffdf8' : palette.textMuted,
                                    },
                                ]}
                            >
                                {isSupperTake ? 'ADD TAKE' : 'SAVE'}
                            </Text>
                        )}
                    </Pressable>
                </View>
            </View>

            {/* Note editor — Letterboxd full-screen slide-up */}
            <NoteEditorModal
                visible={noteEditorVisible}
                value={notes}
                onClose={(committed) => {
                    setNotes(committed);
                    setNoteEditorVisible(false);
                }}
            />

            {/* Calendar — bottom-sheet overlay (floats over the body, no shift) */}
            <CalendarModal
                visible={calendarVisible}
                value={visitedAt}
                onChange={handleCalendarChange}
                onClose={() => setCalendarVisible(false)}
            />

            {/* Photo viewer */}
            <PhotoViewer
                visible={viewerVisible}
                photos={photos}
                initialIndex={viewerIndex}
                onClose={() => setViewerVisible(false)}
                onRemove={handleViewerRemove}
            />

            {/* Companion picker */}
            {user && (
                <CompanionPickerSheet
                    visible={companionPickerVisible}
                    onClose={() => setCompanionPickerVisible(false)}
                    selectedIds={companionIds}
                    onToggle={handleToggleCompanion}
                    currentUserId={user.id}
                    palette={palette}
                />
            )}

            {/* TICKET-159 stray-log stitch — "add this to the table?" */}
            <StitchConfirmSheet
                visible={!!stitch}
                suggestion={stitch?.suggestion ?? null}
                pending={attachTake.isPending}
                onConfirm={() => {
                    if (!stitch) return;
                    attachTake.mutate(
                        { entry_id: stitch.entryId, supper_id: stitch.suggestion.supper_id },
                        {
                            onSuccess: () => {
                                toast.show('added your take');
                                setStitch(null);
                                router.back();
                            },
                            onError: (err) => {
                                // A stale/duplicate confirm is a quiet outcome, not an error.
                                toast.show(
                                    isAttachConflict(err)
                                        ? 'already added to this table'
                                        : "couldn't add it — kept as your log",
                                );
                                setStitch(null);
                                router.back();
                            },
                        },
                    );
                }}
                onDismiss={() => {
                    // NEGATIVE (never auto-attach): the entry stays standalone.
                    setStitch(null);
                    router.back();
                }}
            />
        </>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingBottom: 12,
    },
    headerLeft: {
        flex: 1,
        gap: 6,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 23,
        lineHeight: 28,
    },
    closeBtn: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        paddingLeft: 12,
    },
    // Scroll body
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 12,
        paddingTop: 8,
    },
    // Vellum cards — each section floats as a warm-white note on the cream page.
    // Background shift + ambient shadow IS the brand's sanctioned sectioning
    // (never 1px borders). Cream root → white note cards = the stacked-vellum
    // layers the theme is built around.
    card: {
        borderRadius: Radius.lg,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
        ...Shadow.note,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    ratingNumeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
    },
    likeToggle: {
        marginLeft: 'auto',
        padding: 2,
    },
    whenRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    whenDate: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
    },
    // Note preview block
    notePreview: {
        minHeight: 170,
        borderBottomWidth: 1,
        paddingBottom: 10,
        paddingTop: 6,
        justifyContent: 'flex-start',
    },
    noteText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    notePlaceholder: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    // Expanders
    expanderRow: {
        flexDirection: 'row',
        gap: 20,
    },
    expander: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    companionsLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 2,
    },

    // Share to
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 2,
    },
    publicNote: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        letterSpacing: 0.2,
        marginTop: 6,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
        flex: 1,
        marginRight: 8,
    },
    checkCircle: {
        width: 24,
        height: 24,
        borderRadius: Radius.full,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    checkMark: {
        fontSize: 12,
        lineHeight: 16,
    },
    // Details drawer
    detailsToggle: {
        alignSelf: 'flex-start',
    },
    detailsToggleLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    detailsContent: {
        gap: 4,
        paddingTop: 2,
        paddingBottom: 4,
    },
    // Footer — pinned, true bottom edge
    footer: {
        paddingHorizontal: 24,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    saveBtn: {
        height: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveBtnLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
});
