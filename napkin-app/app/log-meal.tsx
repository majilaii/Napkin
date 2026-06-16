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
 * All LogSheet logic is preserved: photo slot machinery (gen-guards,
 * cleanup-on-unmount, retry), date edit, companion picker, table checklist,
 * sub-ratings, submit via lib/composer.ts + useCreateEntry hook.
 * Payload contract FROZEN (composer.test.ts must stay green).
 * Toast: "tried {name}" via useToast on success then router.back().
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
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

import { Colors, Radius, Spacing } from '@/constants/theme';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useToast } from '@/providers/ToastProvider';
import { queryKeys } from '@/lib/queryKeys';
import { compressAndUpload, removeUploadedPhoto } from '@/lib/imageUpload';
import { collectOrphanedBlobUrls } from '@/lib/photoCleanup';
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
}

function HalfStarRating({ value, onChange }: StarRatingProps) {
    return (
        <View style={starStyles.row}>
            {[1, 2, 3, 4, 5].map((n) => {
                const filled = value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
                return (
                    <View key={n} style={starStyles.starWrap}>
                        <Text style={starStyles.starEmpty}>★</Text>
                        {filled > 0 && (
                            <View
                                style={[
                                    starStyles.fillOverlay,
                                    { width: filled === 1 ? '100%' : '50%' },
                                ]}
                            >
                                <Text style={starStyles.starFilled}>★</Text>
                            </View>
                        )}
                        <Pressable
                            style={starStyles.halfLeft}
                            onPress={() => onChange(n - 0.5)}
                            accessibilityLabel={`Rate ${n - 0.5}`}
                            hitSlop={{ top: 4, bottom: 4 }}
                        />
                        <Pressable
                            style={starStyles.halfRight}
                            onPress={() => onChange(n)}
                            accessibilityLabel={`Rate ${n}`}
                            hitSlop={{ top: 4, bottom: 4 }}
                        />
                    </View>
                );
            })}
        </View>
    );
}

const STAR_SIZE = 30;

const starStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 2 },
    starWrap: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    starEmpty: {
        fontSize: STAR_SIZE,
        lineHeight: 34,
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
        fontSize: STAR_SIZE,
        lineHeight: 34,
        color: '#d97706',
        width: 34,
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
    return (
        <View style={subStyles.row}>
            <Text style={[subStyles.label, { color: palette.textMuted }]}>
                {label.toUpperCase()}
            </Text>
            <View style={subStyles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                        key={n}
                        onPress={() => onChange(n === value ? 0 : n)}
                        hitSlop={4}
                        accessibilityLabel={`${label} ${n}`}
                    >
                        <Text
                            style={{
                                fontSize: 15,
                                color: n <= value ? '#d97706' : 'rgba(28,28,25,0.18)',
                                marginLeft: 2,
                            }}
                        >
                            ★
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const subStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
    },
    stars: {
        flexDirection: 'row',
        alignItems: 'center',
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
    const { restaurant: restaurantParam, initialTableId, pageId } = useLocalSearchParams<{
        restaurant: string;
        initialTableId?: string;
        pageId?: string;
    }>();

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
    // TICKET-082: opt this log into a Supper — only offered when ≥1 friend is
    // tagged; tagging alone stays a plain companion log. Default OFF.
    const [isSupper, setIsSupper] = useState(false);
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>(() =>
        initialTableId ? [initialTableId] : [],
    );
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

    // ── Stable ref to photos for cleanup effects ──────────────────────
    const photosRef = useRef(photos);
    useEffect(() => { photosRef.current = photos; }, [photos]);

    // Set true once a save succeeds — gates the unmount cleanup so the
    // just-saved photos (now owned by the entry) are NOT deleted.
    const savedRef = useRef(false);

    // ── Unmount cleanup — orphaned blobs only ─────────────────────────
    // On a successful save every blob is referenced by the new entry, so
    // collectOrphanedBlobUrls returns [] and nothing is deleted. Only an
    // abandoned logger (closed without saving) cleans up its uploads.
    useEffect(() => {
        return () => {
            for (const url of collectOrphanedBlobUrls(photosRef.current, savedRef.current)) {
                removeUploadedPhoto(url).catch(() => {});
            }
        };
    }, []);

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
                removeUploadedPhoto(url).catch(() => {});
                return;
            }
            setPhotos((prev) =>
                prev.map((s) =>
                    s.id === slotId ? { ...s, publicUrl: url, uploading: false, uploadGen: gen } : s,
                ),
            );
        } catch {
            if (uploadGenRefs.current.get(slotId) !== gen) return;
            setPhotos((prev) =>
                prev.map((s) =>
                    s.id === slotId ? { ...s, uploading: false, error: 'Upload failed. Tap to retry.' } : s,
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
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Permission needed', 'Allow photo access to add photos.');
            return;
        }
        const remaining = MAX_PHOTOS - photos.length;
        if (remaining <= 0) return;

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            orderedSelection: true,
            quality: 1,
        });
        if (result.canceled || !result.assets?.length) return;
        for (const asset of result.assets) {
            addPhotoSlot(asset.uri);
        }
    }, [user?.id, photos.length, addPhotoSlot]);

    const handleRemovePhoto = useCallback((slotId: string) => {
        const currentGen = uploadGenRefs.current.get(slotId) ?? 0;
        uploadGenRefs.current.set(slotId, currentGen + 1);

        setPhotos((prev) => {
            const slot = prev.find((s) => s.id === slotId);
            if (slot?.publicUrl) {
                removeUploadedPhoto(slot.publicUrl).catch(() => {});
            }
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
            // TICKET-082: a Supper needs ≥1 tagged friend — un-tagging the last
            // one drops the Supper opt-in so we never send supper:true with [].
            if (next.length === 0) setIsSupper(false);
            return next;
        });
    }, []);

    // ── Submit ─────────────────────────────────────────────────────────
    const canSubmit = rating > 0 && !createEntry.isPending && !photos.some((p) => p.uploading);

    const handleSave = useCallback(async () => {
        if (!canSubmit || !user?.id) return;

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
                location: pp.formattedAddress ? { address: pp.formattedAddress } : undefined,
                types: pp.categories ?? ['restaurant'],
                latitude: pp.latitude ?? undefined,
                longitude: pp.longitude ?? undefined,
                photoReference: pp.photoReference ?? undefined,
                photoAttributionHtml: pp.photoAttributionHtml ?? undefined,
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

        // TICKET-082: opt into a Supper only when toggled AND friends are tagged.
        // supper_participant_ids = the tagged ids; server seeds them into
        // supper_members + writes entry_companions (so companion_ids in `payload`
        // stays harmless — the server skips the duplicate companion insert).
        const supperFields =
            isSupper && companions.length > 0
                ? {
                      supper: true,
                      supper_participant_ids: companions.map((c) => c.user_id),
                  }
                : {};

        createEntry.mutate(
            {
                ...(restaurantData ? { restaurant: restaurantData } : {}),
                ...(restaurant.id && !restaurantData ? { restaurant_id: restaurant.id } : {}),
                ...payload,
                ...supperFields,
            } as any,
            {
                onSuccess: (result) => {
                    // Mark saved BEFORE navigating: the unmount cleanup must
                    // not delete photos now owned by the entry (TICKET-071 bug).
                    savedRef.current = true;
                    // TICKET-082: if the host entry saved but the Supper failed to
                    // open, the server returns a soft warning + a plain entry. Surface
                    // it quietly; the log itself still landed.
                    const warnings: Array<{ type: string }> | undefined =
                        (result as any)?.__warnings;
                    const supperFailed =
                        isSupper && warnings?.some((w) => w.type === 'supper_open_failed');
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
                    if (supperFailed) {
                        toast.show("logged, but couldn't start the Supper");
                    } else {
                        toast.show(`tried ${restaurant.name}`);
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
        isSupper,
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
            <View style={[styles.root, { backgroundColor: palette.surfaceNote }]}>

                {/* ── Pinned header ── */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <View style={styles.headerLeft}>
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>
                            LOG A MEAL
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
                    {/* 1 ── YOUR APPRAISAL — rating + inline like heart ── */}
                    <View style={styles.section}>
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
                    </View>

                    {/* 2 ── rate the details — sub-ratings, directly under the main rating ── */}
                    <View style={styles.section}>
                        <Pressable
                            onPress={() => setShowDetails((v) => !v)}
                            style={styles.detailsToggle}
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
                    <View style={styles.section}>
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
                    <View style={styles.section}>
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

                    {/* 5 ── photo mosaic ── */}
                    <PhotoMosaic
                        photos={photos}
                        maxPhotos={MAX_PHOTOS}
                        onAdd={handleAddPhoto}
                        onRemove={handleRemovePhoto}
                        onRetry={handleRetryPhoto}
                        onTapPhoto={handleTapPhoto}
                    />

                    {/* 6 ── + who was there — companions (kept) ── */}
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

                    {/* TICKET-082: quiet Supper opt-in — only when friends are tagged.
                        Default OFF; tagging alone stays a plain companion log. */}
                    {!FRIEND_TEST.hideSuppers && companions.length > 0 && (
                        <Pressable
                            onPress={() => setIsSupper((v) => !v)}
                            style={styles.supperToggleRow}
                            accessibilityRole="switch"
                            accessibilityState={{ checked: isSupper }}
                            accessibilityLabel="make this a Supper — let them add their own take"
                            hitSlop={6}
                        >
                            <View
                                style={[
                                    styles.supperCheck,
                                    {
                                        backgroundColor: isSupper ? palette.primary : 'transparent',
                                        borderColor: isSupper
                                            ? palette.primary
                                            : 'rgba(160,63,40,0.35)',
                                    },
                                ]}
                            >
                                {isSupper ? (
                                    <Text style={[styles.supperCheckMark, { color: '#fffdf8' }]}>✓</Text>
                                ) : null}
                            </View>
                            <Text
                                style={[
                                    styles.supperToggleLabel,
                                    { color: isSupper ? palette.text : palette.textMuted },
                                ]}
                            >
                                make this a Supper — let them add their own take
                            </Text>
                        </Pressable>
                    )}

                    {/* 7 ── SHARE TO — hidden when no tables ── */}
                    {hasAnyTable && (
                        <View style={styles.section}>
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
                        </View>
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
                                opacity: pressed ? 0.85 : createEntry.isPending ? 0.65 : 1,
                            },
                        ]}
                    >
                        {createEntry.isPending ? (
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
                                SAVE
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
        gap: 2,
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
        paddingHorizontal: 24,
        gap: 18,
        paddingTop: 4,
    },
    // Sections
    section: {
        gap: 8,
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
        minHeight: 120,
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
    // TICKET-082: Supper opt-in toggle
    supperToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 8,
    },
    supperCheck: {
        width: 20,
        height: 20,
        borderRadius: Radius.sm,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    supperCheckMark: {
        fontSize: 11,
        lineHeight: 14,
    },
    supperToggleLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
        flex: 1,
    },

    // Share to
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 2,
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
