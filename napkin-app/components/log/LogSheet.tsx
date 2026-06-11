/**
 * LogSheet — canvas "Component · Log sheet" bottom sheet (TICKET-069 phase 2).
 *
 * Opens from the restaurant page. Restaurant is always locked — no search step.
 *
 * Canvas anatomy (top → bottom):
 *   grabber → kicker "LOG A MEAL" + italic 23 restaurant name + quiet "close"
 *   YOUR APPRAISAL: ★×5 34px with half-star hit zones + live italic 26 numeral
 *   WHEN row: "today · thu 11 jun" + terracotta "edit" → DateChip-style picker
 *   THE NOTE: italic serif TextInput, min-height 160, grows with content,
 *             placeholder "— what will you remember?", underline only
 *   PhotoMosaic: Apple Journal adaptive photo grid (1→hero, 2→cols, 3→hero+stack,
 *                4→2×2, 5-6→2×2 with +N overflow tile); add-photo affordance inline
 *   + the dish / + who was there: quiet expanders
 *   SHARE TO table checklist (✓ circles) + caption — hidden for zero-table users
 *   folded "add details" (chevron + Vibe/Flavor/Service/Value sub-rating rows)
 *   footer SAVE pill (gated on rating > 0)
 *
 * Keyboard: Pressable backdrop (flex-end) → KeyboardAvoidingView (behavior=padding
 * on iOS) → pinned header → ScrollView (keyboardShouldPersistTaps) → pinned
 * footer. Mirrors the ImportLinkSheet pattern — proven in this codebase.
 *
 * Submit: buildEntryPayload from lib/composer.ts + useCreateEntry hook.
 *   Contract frozen — payload tests in lib/composer.test.ts must stay green.
 *   photo_urls order = mosaic order (slot insertion order).
 * Toast: "tried {name}" via useToast on success.
 *
 * TICKET-070 Phase B changes:
 *   - MAX_PHOTOS raised to 6
 *   - Multi-photo picker (allowsMultipleSelection, selectionLimit = remaining,
 *     orderedSelection) — no allowsEditing / aspect (kills forced square crop)
 *   - PhotoMosaic replaces PhotoStrip (adaptive mosaic + inline add affordance)
 *   - PhotoViewer: tap any tile → full-screen paged modal viewer
 *   - Note dominance: note moved before photos, minHeight 160
 *   - Keyboard: flex-end backdrop + KAV behavior=padding (no absolute positioning)
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useToast } from '@/providers/ToastProvider';
import { compressAndUpload, removeUploadedPhoto } from '@/lib/imageUpload';
import { buildEntryPayload, toggleTableId } from '@/lib/composer';
import type { ComposerBreakdown } from '@/lib/composer';
import { DateChip } from '@/components/create-entry/DateChip';
import { CompanionPickerSheet } from '@/components/logging/CompanionPickerSheet';
import { PhotoMosaic } from './PhotoMosaic';
import { PhotoViewer } from './PhotoViewer';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogSheetRestaurant {
    id?: string;           // Napkin DB id (if persisted)
    external_id?: string;  // Google Place ID
    name: string;
    city?: string | null;
    cuisine?: string | null;
    price_level?: string | null;
    placePayload?: any;    // Full payload for ghost restaurants
}

interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
    /** Gen counter — bumped on remove to cancel any in-flight upload. */
    uploadGen: number;
}

const MAX_PHOTOS = 6;
const EMPTY_BREAKDOWN: ComposerBreakdown = { vibe: 0, flavor: 0, service: 0, value: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format WHEN label per canvas: "today · thu 11 jun" / "wed 8 jun"
 */
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

/** Format a rating value as a human string (e.g. "4.5" or "—"). */
function ratingDisplay(value: number): string {
    if (value <= 0) return '—';
    const snapped = Math.round(value * 2) / 2;
    return snapped % 1 === 0 ? `${snapped}.0` : `${snapped}`;
}

// ── Half-star rating component ────────────────────────────────────────────────

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
                        {/* Background star (empty) */}
                        <Text style={starStyles.starEmpty}>★</Text>
                        {/* Filled overlay */}
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
                        {/* Left half = N-0.5, right half = N */}
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
    row: {
        flexDirection: 'row',
        gap: 2,
    },
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

// ── Mini star for sub-ratings (5 tappable, integer only) ────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

interface LogSheetProps {
    visible: boolean;
    restaurant: LogSheetRestaurant;
    onClose: () => void;
    /** Called after a successful save with the new entry id. */
    onSubmitted?: (entryId: string) => void;
    /** Initial table ID to pre-select in SHARE TO. */
    initialTableId?: string;
}

export function LogSheet({
    visible,
    restaurant,
    onClose,
    onSubmitted,
    initialTableId,
}: LogSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const toast = useToast();

    const { data: tables } = useTables(user?.id);
    const tableList = tables?.map((m) => m.tables) ?? [];
    const hasAnyTable = tableList.length > 0;

    const createEntry = useCreateEntry(user?.id, null);

    // ── Form state ──────────────────────────────────────────────────────
    const [rating, setRating] = useState(0);
    const [visitedAt, setVisitedAt] = useState(new Date());
    const [notes, setNotes] = useState('');
    const [dish, setDish] = useState('');
    const [showDish, setShowDish] = useState(false);
    const [companionPickerVisible, setCompanionPickerVisible] = useState(false);
    const [companions, setCompanions] = useState<UserSearchResult[]>([]);
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>(() =>
        initialTableId ? [initialTableId] : [],
    );
    const [photos, setPhotos] = useState<PhotoSlot[]>([]);
    const [breakdown, setBreakdown] = useState<ComposerBreakdown>(EMPTY_BREAKDOWN);
    const [showDetails, setShowDetails] = useState(false);

    // ── Photo viewer state ──────────────────────────────────────────────
    const [viewerVisible, setViewerVisible] = useState(false);
    const [viewerIndex, setViewerIndex] = useState(0);

    // ── Upload generation counter (prevents stale uploads from setting state) ─
    const uploadGenRefs = useRef(new Map<string, number>());

    // ── Stable ref to photos for cleanup effects ──────────────────────────────
    const photosRef = useRef(photos);
    useEffect(() => { photosRef.current = photos; }, [photos]);

    // ── Unmount cleanup — orphaned blobs ──────────────────────────────────────
    useEffect(() => {
        return () => {
            for (const slot of photosRef.current) {
                if (slot.publicUrl) removeUploadedPhoto(slot.publicUrl).catch(() => {});
            }
        };
    }, []);

    // ── Reset on close ─────────────────────────────────────────────────
    useEffect(() => {
        if (!visible) {
            // Clean up any uploaded blobs before resetting state
            for (const slot of photosRef.current) {
                if (slot.publicUrl) removeUploadedPhoto(slot.publicUrl).catch(() => {});
            }
            setRating(0);
            setVisitedAt(new Date());
            setNotes('');
            setDish('');
            setShowDish(false);
            setCompanionPickerVisible(false);
            setCompanions([]);
            setSelectedTableIds(initialTableId ? [initialTableId] : []);
            setPhotos([]);
            setBreakdown(EMPTY_BREAKDOWN);
            setShowDetails(false);
            setViewerVisible(false);
            setViewerIndex(0);
        }
    }, [visible, initialTableId]);

    // ── Photo machinery ────────────────────────────────────────────────

    /** Internal: upload one slot, cancelling if its gen counter was bumped. */
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
                // Remove was called while upload was in-flight; discard the blob.
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

    /** Add a slot and kick off the upload. */
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

    /**
     * Multi-photo picker:
     *   - allowsMultipleSelection: true (up to `remaining` slots)
     *   - orderedSelection: true (preserves pick order)
     *   - NO allowsEditing / aspect — photos keep native aspect ratio;
     *     display cropping is layout-only (cover-fit inside mosaic tiles)
     */
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

    /** Remove a slot; bumps gen to cancel any in-flight upload and cleans up
     *  any already-uploaded blob. */
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

    // ── Photo viewer ───────────────────────────────────────────────────
    const handleTapPhoto = useCallback((index: number) => {
        setViewerIndex(index);
        setViewerVisible(true);
    }, []);

    const handleViewerRemove = useCallback((slotId: string) => {
        handleRemovePhoto(slotId);
        // Close viewer if this was the last photo
        if (photos.length <= 1) {
            setViewerVisible(false);
        }
    }, [handleRemovePhoto, photos.length]);

    // ── Companion toggle ───────────────────────────────────────────────
    const companionIds = new Set(companions.map((c) => c.user_id));
    const handleToggleCompanion = useCallback((u: UserSearchResult) => {
        setCompanions((prev) => {
            if (prev.some((c) => c.user_id === u.user_id)) {
                return prev.filter((c) => c.user_id !== u.user_id);
            }
            return [...prev, u];
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
            dish,
            selectedTableIds,
            visitedAt,
            photos: photoSlots,
            breakdown,
            selectedCompanions: companions.map((c) => ({ user_id: c.user_id })),
        });

        // Build restaurant data from prop
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
                // TICKET-057: always pair photoReference with attribution; missing → 'none' sentinel
                photoAttributionHtml: pp.photoAttributionHtml ?? undefined,
            };
        } else if (restaurant.external_id) {
            restaurantData = {
                external_id: restaurant.external_id,
                name: restaurant.name,
                types: ['restaurant'],
            };
        } else if (restaurant.id) {
            // Persisted — server looks up by restaurant_id embedded in the entry row
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
                    const entryId = result?.id ?? '';
                    toast.show(`tried ${restaurant.name}`);
                    onClose();
                    onSubmitted?.(entryId);
                },
                onError: (err) => {
                    // useCreateEntry toasts table_not_authorized; surface everything else.
                    const code = (err as any)?.cause?.code ?? (err as any)?.code;
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
        dish,
        selectedTableIds,
        visitedAt,
        photos,
        breakdown,
        companions,
        restaurant,
        createEntry,
        toast,
        onClose,
        onSubmitted,
    ]);

    // ── Render ─────────────────────────────────────────────────────────
    return (
        <>
            <Modal
                visible={visible}
                transparent
                animationType="slide"
                onRequestClose={onClose}
            >
                {/*
                 * Keyboard pattern (mirrors ImportLinkSheet):
                 *   Pressable backdrop flex-end → KAV behavior=padding → pinned header
                 *   → ScrollView → pinned footer.
                 * The sheet rides above the keyboard naturally. Header never scrolls
                 * off-screen; long notes scroll within the sheet.
                 */}
                <Pressable
                    style={styles.backdrop}
                    onPress={onClose}
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    >
                        <View
                            style={[
                                styles.sheet,
                                { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + 8 },
                                Shadow.ambient,
                            ]}
                            onStartShouldSetResponder={() => true}
                        >
                            {/* Grabber */}
                            <View style={styles.grabberRow}>
                                <View style={styles.grabber} />
                            </View>

                            {/* Header: kicker + restaurant name + close */}
                            <View style={styles.headerRow}>
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
                                <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="close">
                                    <Text style={[styles.closeBtn, { color: palette.textMuted }]}>
                                        close
                                    </Text>
                                </Pressable>
                            </View>

                            {/* Scrollable body */}
                            <ScrollView
                                style={styles.scroll}
                                contentContainerStyle={[
                                    styles.scrollContent,
                                    { paddingBottom: Spacing.lg },
                                ]}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                            >
                                {/* YOUR APPRAISAL */}
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
                                    </View>
                                </View>

                                {/* WHEN */}
                                <View style={styles.section}>
                                    <View style={styles.whenRow}>
                                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                            WHEN
                                        </Text>
                                        <DateChip value={visitedAt} onChange={setVisitedAt} />
                                    </View>
                                    <Text style={[styles.whenDate, { color: palette.text }]}>
                                        {formatWhenLabel(visitedAt)}
                                    </Text>
                                </View>

                                {/* THE NOTE — visual center of the sheet */}
                                <View style={styles.section}>
                                    <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                        THE NOTE
                                    </Text>
                                    <TextInput
                                        value={notes}
                                        onChangeText={setNotes}
                                        placeholder="— what will you remember?"
                                        placeholderTextColor={palette.textMuted}
                                        multiline
                                        style={[
                                            styles.noteInput,
                                            {
                                                color: palette.text,
                                                borderBottomColor: palette.ruleInkSoft,
                                            },
                                        ]}
                                    />
                                </View>

                                {/* PhotoMosaic — Apple Journal adaptive grid */}
                                <PhotoMosaic
                                    photos={photos}
                                    maxPhotos={MAX_PHOTOS}
                                    onAdd={handleAddPhoto}
                                    onRemove={handleRemovePhoto}
                                    onRetry={handleRetryPhoto}
                                    onTapPhoto={handleTapPhoto}
                                />

                                {/* Expanders: + the dish / + who was there */}
                                <View style={styles.expanderRow}>
                                    <Pressable
                                        onPress={() => setShowDish((v) => !v)}
                                        hitSlop={8}
                                        accessibilityLabel="add the dish"
                                    >
                                        <Text style={[styles.expander, { color: palette.textMuted }]}>
                                            {showDish ? '— the dish' : '+ the dish'}
                                        </Text>
                                    </Pressable>
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

                                {showDish && (
                                    <TextInput
                                        value={dish}
                                        onChangeText={setDish}
                                        placeholder="the dish"
                                        placeholderTextColor={palette.textMuted}
                                        style={[
                                            styles.dishInput,
                                            {
                                                color: palette.text,
                                                borderBottomColor: palette.ruleInkSoft,
                                            },
                                        ]}
                                    />
                                )}

                                {companions.length > 0 && (
                                    <Pressable
                                        onPress={() => setCompanionPickerVisible(true)}
                                        hitSlop={8}
                                        accessibilityLabel="edit companions"
                                    >
                                        <Text style={[styles.companionsWithLine, { color: palette.textMuted }]}>
                                            {`with ${companions.map((c) => c.display_name).join(', ')}`}
                                        </Text>
                                    </Pressable>
                                )}

                                {/* SHARE TO — hidden when no tables */}
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
                                                        style={[
                                                            styles.tableName,
                                                            { color: palette.text },
                                                        ]}
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
                                        <Text style={[styles.shareCaption, { color: palette.textMuted }]}>
                                            unchecked = journal only. visibility is derived, never chosen.
                                        </Text>
                                    </View>
                                )}

                                {/* Add details drawer */}
                                <View style={styles.section}>
                                    <Pressable
                                        onPress={() => setShowDetails((v) => !v)}
                                        style={styles.detailsToggle}
                                        accessibilityLabel="add details"
                                        hitSlop={8}
                                    >
                                        <Text style={[styles.detailsToggleLabel, { color: palette.primary }]}>
                                            {showDetails ? '▾ add details' : '▸ add details'}
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
                                            <Text
                                                style={[
                                                    styles.detailsMurmur,
                                                    { color: palette.textMuted },
                                                ]}
                                            >
                                                — only if the meal asks. never shown on rows.
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </ScrollView>

                            {/* Footer SAVE pill — pinned outside ScrollView */}
                            <View
                                style={[
                                    styles.footer,
                                    { borderTopColor: palette.ruleInkSoft },
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
                                            opacity:
                                                pressed ? 0.85 : createEntry.isPending ? 0.65 : 1,
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
                                                    color: canSubmit
                                                        ? '#fffdf8'
                                                        : palette.textMuted,
                                                },
                                            ]}
                                        >
                                            SAVE
                                        </Text>
                                    )}
                                </Pressable>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                </Pressable>
            </Modal>

            {/* Photo viewer — full-screen modal, rendered outside sheet */}
            <PhotoViewer
                visible={viewerVisible}
                photos={photos}
                initialIndex={viewerIndex}
                onClose={() => setViewerVisible(false)}
                onRemove={handleViewerRemove}
            />

            {/* Companion picker — rendered outside sheet to avoid z-index conflict */}
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
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(28,28,25,0.35)',
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '92%',
        overflow: 'hidden',
    },
    grabberRow: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 2,
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        backgroundColor: 'rgba(28,28,25,0.15)',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingTop: 6,
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
    scroll: {
        flexShrink: 1,
    },
    scrollContent: {
        paddingHorizontal: 24,
        gap: 18,
    },
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
    whenRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    whenDate: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
    },
    noteInput: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
        borderBottomWidth: 1,
        paddingBottom: 6,
        paddingTop: 6,
        textAlignVertical: 'top',
        minHeight: 160,
        backgroundColor: 'transparent',
    },
    expanderRow: {
        flexDirection: 'row',
        gap: 20,
    },
    expander: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    dishInput: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        borderBottomWidth: 1,
        paddingBottom: 6,
        paddingTop: 6,
        backgroundColor: 'transparent',
    },
    companionsWithLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 2,
    },
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
    shareCaption: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 16,
        marginTop: 4,
    },
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
    detailsMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        marginTop: 4,
    },
    footer: {
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 24,
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
