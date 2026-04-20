/**
 * Entry Detail — full view of a single entry (solo share or round take).
 * Shows restaurant, overall rating, secondary ratings, notes, dish, date.
 *
 * TICKET-019 additions:
 *  - Own-entry inline edit affordances: tappable rating, "Add note/dish/photos/breakdown" rows
 *  - Edit gates on viewer?.id === entry.user_id (other members remain read-only)
 *  - Mutations via useUpdateEntry (direct supabase-js PATCH, no feed re-sort)
 *  - Photo add/remove via useAddEntryPhoto / useRemoveEntryPhoto
 */
import React, { useState, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
    Dimensions,
    TextInput,
    Alert,
    ActionSheetIOS,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { StarRating } from '@/components/StarRating';
import { MultiPhotoRow } from '@/components/MultiPhotoRow';
import { useRoundContext } from '@/hooks/tables/useTableNight';
import { useUserRestaurantHistory } from '@/hooks/restaurants/useRestaurantHistory';
import { PreviouslyHereBanner } from '@/components/restaurants';
import { useAuth } from '@/providers/AuthProvider';
import { usePostInteractions, usePostInteractionsRealtime } from '@/hooks/posts';
import { CommentThread } from '@/components/posts';
import { FeedActionRow } from '@/components/feed';
import { useUpdateEntry } from '@/hooks/entries/useUpdateEntry';
import { useAddEntryPhoto, useRemoveEntryPhoto } from '@/hooks/entries/useEntryPhotoMutations';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe' },
    { key: 'flavor_rating' as const, label: 'Flavor' },
    { key: 'service_rating' as const, label: 'Service' },
    { key: 'value_rating' as const, label: 'Value' },
];

interface EntryDetail {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string;
    created_at: string;
    table_id: string | null;
    table_night_id: string | null;
    visibility: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    photo_url: string | null;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: {
        display_name: string;
    };
}

// ── Photo types (for flesh-out editing) ─────────────────────────────────────

interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
    uploadGen: number;
}

const MAX_PHOTOS = 6;

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchEntry(entryId?: string, nightId?: string, userId?: string): Promise<EntryDetail> {
    let entry: any;

    if (entryId) {
        // Direct entry lookup
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                visited_at,
                created_at,
                table_id,
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('id', entryId)
            .single();

        if (error) throw error;
        entry = data;
    } else if (nightId && userId) {
        // Lookup by table_night_id + user_id (for round participants)
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                visited_at,
                created_at,
                table_id,
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('table_night_id', nightId)
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        entry = data;
    } else {
        throw new Error('Either entryId or nightId+userId required');
    }

    // Fetch profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', entry.user_id)
        .single();

    // PostgREST returns FK-joined restaurants as object (with .single()),
    // but TS may infer it as array. Normalize:
    const restaurant = Array.isArray(entry.restaurants)
        ? entry.restaurants[0] ?? null
        : entry.restaurants ?? null;

    return {
        ...entry,
        restaurants: restaurant,
        profiles: profile ?? { display_name: 'User' },
    } as unknown as EntryDetail;
}

function getRelativeDate(dateString: string): { relative: string; full: string } {
    const date = new Date(dateString);
    const full = date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    if (isNaN(date.getTime())) return { relative: full, full };

    const nowMs = Date.now();
    const diffMs = nowMs - date.getTime();
    if (diffMs < 0) return { relative: full, full };
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    let relative: string;
    if (diffSec < 60) {
        relative = 'Just now';
    } else if (diffMin < 60) {
        relative = `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else if (diffHrs < 24) {
        relative = `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
    } else if (diffDays === 1) {
        relative = 'Yesterday';
    } else if (diffDays < 7) {
        relative = `${diffDays} days ago`;
    } else if (diffDays < 14) {
        relative = 'Last week';
    } else {
        relative = full;
    }

    return { relative, full };
}

/**
 * Resolves (nightId, userId) -> entryId so that useEntryDetail can always key
 * on the canonical queryKeys.entries.detail(entryId). Required for useUpdateEntry
 * optimistic patches and invalidations to land on this screen's query.
 */
async function resolveEntryIdByNight(nightId: string, userId: string): Promise<string> {
    const { data, error } = await supabase
        .from('entries')
        .select('id')
        .eq('table_night_id', nightId)
        .eq('user_id', userId)
        .single();
    if (error) throw error;
    return data.id;
}

function useEntryDetail(entryId?: string, nightId?: string, userId?: string) {
    const { data: resolvedId, isLoading: resolvingId, error: resolveError } = useQuery({
        queryKey: ['resolve-entry-by-night', nightId, userId],
        queryFn: () => resolveEntryIdByNight(nightId!, userId!),
        enabled: !entryId && !!nightId && !!userId,
        staleTime: Infinity,
    });
    const effectiveId = entryId ?? resolvedId;

    const detail = useQuery({
        queryKey: queryKeys.entries.detail(effectiveId ?? ''),
        queryFn: () => fetchEntry(effectiveId, undefined, undefined),
        enabled: !!effectiveId,
    });

    return {
        ...detail,
        isLoading: detail.isLoading || resolvingId,
        error: detail.error ?? resolveError,
    };
}

async function fetchEntryPhotos(entryId: string): Promise<{ id: string; photo_url: string; sort_order: number }[]> {
    const { data, error } = await supabase
        .from('entry_photos')
        .select('id, photo_url, sort_order')
        .eq('entry_id', entryId)
        .order('sort_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
}

function useEntryPhotos(entryId?: string) {
    return useQuery({
        queryKey: ['entry-photos', entryId],
        queryFn: () => fetchEntryPhotos(entryId!),
        enabled: !!entryId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { entryId, nightId, userId, focus } = useLocalSearchParams<{
        entryId?: string;
        nightId?: string;
        userId?: string;
        focus?: string;
    }>();
    const { data: entry, isLoading, error } = useEntryDetail(entryId, nightId, userId);
    // Round context for banner — enabled only once we know the entry's table_night_id
    const { data: roundContext } = useRoundContext(entry?.table_night_id ?? null);

    // Post interactions — available immediately on entries (no reveal gate)
    const { data: interactions } = usePostInteractions(
        entry?.id ? 'entry' : null,
        entry?.id ?? null,
    );
    usePostInteractionsRealtime({
        targetType: entry?.id ? 'entry' : null,
        targetId: entry?.id ?? null,
    });
    // entry_photos for carousel (resolved after entry loads) — now returns full rows with id
    const { data: entryPhotoRows } = useEntryPhotos(entry?.id);
    // Viewer's personal history at this restaurant (cross-Table, excludes this entry)
    const { user: viewer } = useAuth();
    const { data: userHistory } = useUserRestaurantHistory(
        entry?.restaurant_id ?? null,
        viewer?.id ?? null,
        entry?.id,
    );
    // Photo carousel index
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);

    // ── Own-entry edit hooks ───────────────────────────────────────────────────
    const isOwnEntry = !!(viewer && entry && viewer.id === entry.user_id);
    const updateEntry = useUpdateEntry(entry?.id ?? '');
    const addEntryPhoto = useAddEntryPhoto(entry?.id ?? '');
    const removeEntryPhoto = useRemoveEntryPhoto(entry?.id ?? '');

    // ── Inline edit states ────────────────────────────────────────────────────
    // Rating
    const [isEditingRating, setIsEditingRating] = useState(false);
    const [localRating, setLocalRating] = useState<number | null>(null);
    const [ratingError, setRatingError] = useState<string | null>(null);

    // Note
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [localNote, setLocalNote] = useState('');
    const [noteError, setNoteError] = useState<string | null>(null);
    const noteSaving = updateEntry.isPending && !isEditingRating;

    // Dish
    const [isEditingDish, setIsEditingDish] = useState(false);
    const [localDish, setLocalDish] = useState('');
    const [dishError, setDishError] = useState<string | null>(null);

    // Breakdown
    const [isEditingBreakdown, setIsEditingBreakdown] = useState(false);
    const [localBreakdown, setLocalBreakdown] = useState<{
        vibe_rating: number;
        flavor_rating: number;
        service_rating: number;
        value_rating: number;
    }>({ vibe_rating: 0, flavor_rating: 0, service_rating: 0, value_rating: 0 });
    const [breakdownErrors, setBreakdownErrors] = useState<Record<string, string>>({});

    // Photo editing (for flesh-out)
    const [newPhotoSlots, setNewPhotoSlots] = useState<PhotoSlot[]>([]);
    const uploadGenRefs = useRef(new Map<string, number>());
    // Photo manage mode — toggled by the pencil icon; shows remove-grid + add button
    const [photoManageMode, setPhotoManageMode] = useState(false);

    // ── Derived photo state ───────────────────────────────────────────────────
    const entryPhotoUrls: string[] = entryPhotoRows
        ? entryPhotoRows.map(r => r.photo_url)
        : [];

    const allPhotos: string[] =
        entryPhotoUrls.length > 0
            ? entryPhotoUrls
            : entry?.photo_url
            ? [entry.photo_url]
            : [];

    const hasUserPhotos = allPhotos.length > 0;
    const heroDisplayUrl = hasUserPhotos ? allPhotos[0] : entry?.restaurants?.photo_url ?? null;
    const hasHeroDisplay = !!heroDisplayUrl;

    // ── Photo upload helpers ──────────────────────────────────────────────────
    const startUploadForSlot = useCallback(async (slotId: string, uri: string) => {
        if (!viewer?.id || !entry?.id) return;
        const gen = (uploadGenRefs.current.get(slotId) ?? 0) + 1;
        uploadGenRefs.current.set(slotId, gen);

        setNewPhotoSlots(prev => prev.map(s => s.id === slotId
            ? { ...s, uploading: true, error: null }
            : s
        ));

        try {
            await addEntryPhoto.mutateAsync({ localUri: uri, userId: viewer.id });

            if (uploadGenRefs.current.get(slotId) !== gen) return;
            setNewPhotoSlots(prev => prev.filter(s => s.id !== slotId));
        } catch {
            if (uploadGenRefs.current.get(slotId) !== gen) return;
            setNewPhotoSlots(prev => prev.map(s => s.id === slotId
                ? { ...s, uploading: false, error: 'Upload failed. Tap to retry.' }
                : s
            ));
        }
    }, [viewer?.id, entry?.id, addEntryPhoto]);

    const addNewPhotoSlot = useCallback((uri: string) => {
        setNewPhotoSlots(prev => {
            if (prev.length + allPhotos.length >= MAX_PHOTOS) return prev;
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
    }, [startUploadForSlot, allPhotos.length]);

    const handlePhotoPress = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
                async (buttonIndex) => {
                    if (buttonIndex === 1) await pickFromCamera();
                    if (buttonIndex === 2) await pickFromLibrary();
                }
            );
        } else {
            Alert.alert('Add a Photo', undefined, [
                { text: 'Take Photo', onPress: pickFromCamera },
                { text: 'Choose from Library', onPress: pickFromLibrary },
                { text: 'Cancel', style: 'cancel' },
            ]);
        }
    };

    const pickFromCamera = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Camera Access Required', 'Please enable camera access in Settings.');
            return;
        }
        let result;
        try {
            result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
        } catch {
            Alert.alert('Camera Unavailable', 'Try choosing from your photo library instead.');
            return;
        }
        if (!result.canceled && result.assets[0]) {
            addNewPhotoSlot(result.assets[0].uri);
        }
    };

    const pickFromLibrary = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Photo Library Access Required', 'Please enable photo library access in Settings.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (!result.canceled && result.assets[0]) {
            addNewPhotoSlot(result.assets[0].uri);
        }
    };

    const handleRemoveExistingPhoto = useCallback((photoUrl: string) => {
        if (!entryPhotoRows) return;
        const row = entryPhotoRows.find(r => r.photo_url === photoUrl);
        if (!row) return;
        const isHero = entry?.photo_url === photoUrl || (entryPhotoRows[0]?.photo_url === photoUrl);
        removeEntryPhoto.mutate({ photoId: row.id, photoUrl: row.photo_url, isHero });
    }, [entryPhotoRows, entry?.photo_url, removeEntryPhoto]);

    // ── Rating edit handlers ──────────────────────────────────────────────────
    const handleRatingTap = () => {
        if (!isOwnEntry || !entry) return;
        setLocalRating(entry.rating ?? 0);
        setRatingError(null);
        setIsEditingRating(true);
    };

    const handleRatingChange = (value: number) => {
        setLocalRating(value);
    };

    const handleRatingSave = async () => {
        if (localRating === null || !entry) return;
        setRatingError(null);
        const ratingValue = Math.round(localRating * 2) / 2;
        try {
            await updateEntry.mutateAsync({ rating: ratingValue });
            setIsEditingRating(false);
        } catch {
            setLocalRating(entry.rating ?? 0);
            setRatingError("Couldn't save. Try again.");
        }
    };

    const handleRatingCancel = () => {
        setIsEditingRating(false);
        setLocalRating(null);
        setRatingError(null);
    };

    // ── Note edit handlers ────────────────────────────────────────────────────
    const handleNoteEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalNote(entry.content ?? '');
        setNoteError(null);
        setIsEditingNote(true);
    };

    const handleNoteSave = async () => {
        if (!entry) return;
        setNoteError(null);
        try {
            await updateEntry.mutateAsync({ content: localNote.trim() || null });
            setIsEditingNote(false);
        } catch {
            setLocalNote(entry.content ?? '');
            setNoteError("Couldn't save. Try again.");
        }
    };

    const handleNoteCancel = () => {
        setIsEditingNote(false);
        setLocalNote('');
        setNoteError(null);
    };

    // ── Dish edit handlers ────────────────────────────────────────────────────
    const handleDishEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalDish(entry.dish_description ?? '');
        setDishError(null);
        setIsEditingDish(true);
    };

    const handleDishSave = async () => {
        if (!entry) return;
        setDishError(null);
        try {
            await updateEntry.mutateAsync({ dish_description: localDish.trim() || null });
            setIsEditingDish(false);
        } catch {
            setLocalDish(entry.dish_description ?? '');
            setDishError("Couldn't save. Try again.");
        }
    };

    const handleDishCancel = () => {
        setIsEditingDish(false);
        setLocalDish('');
        setDishError(null);
    };

    // ── Breakdown edit handlers ───────────────────────────────────────────────
    const handleBreakdownEditStart = () => {
        if (!isOwnEntry || !entry) return;
        setLocalBreakdown({
            vibe_rating: entry.vibe_rating ?? 0,
            flavor_rating: entry.flavor_rating ?? 0,
            service_rating: entry.service_rating ?? 0,
            value_rating: entry.value_rating ?? 0,
        });
        setBreakdownErrors({});
        setIsEditingBreakdown(true);
    };

    const handleBreakdownCategoryChange = async (key: string, value: number) => {
        const ratingValue = Math.round(value * 2) / 2;
        setLocalBreakdown(prev => ({ ...prev, [key]: ratingValue }));
        setBreakdownErrors(prev => ({ ...prev, [key]: '' }));
        try {
            await updateEntry.mutateAsync({ [key]: ratingValue > 0 ? ratingValue : null } as any);
        } catch {
            const entryVal = (entry as any)?.[key] as number | null | undefined;
            setLocalBreakdown(prev => ({ ...prev, [key]: entryVal ?? 0 }));
            setBreakdownErrors(prev => ({ ...prev, [key]: "Couldn't save. Try again." }));
        }
    };

    const handleBreakdownClose = () => {
        setIsEditingBreakdown(false);
    };

    // ── Loading / error states ────────────────────────────────────────────────

    if (isLoading || !entry) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <Text style={[Type.body, { color: palette.error }]}>
                        Couldn&apos;t load this entry.
                    </Text>
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Go back</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    const restaurantName = entry.restaurants?.name ?? 'Unknown spot';
    const displayName = entry.profiles?.display_name ?? 'Someone';
    const { relative: relativeDate, full: fullDate } = getRelativeDate(entry.visited_at ?? entry.created_at);

    const hasCategoryRatings =
        entry.vibe_rating != null ||
        entry.flavor_rating != null ||
        entry.service_rating != null ||
        entry.value_rating != null;

    const isRoundEntry = !!entry.table_night_id;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 40,
                        paddingTop: hasHeroDisplay ? 0 : insets.top + Spacing.md,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero image / carousel */}
                    {hasHeroDisplay ? (
                        <View>
                            {hasUserPhotos && allPhotos.length > 1 ? (
                                // Multi-photo carousel
                                <View>
                                    <ScrollView
                                        horizontal
                                        pagingEnabled
                                        showsHorizontalScrollIndicator={false}
                                        style={{ width: SCREEN_WIDTH }}
                                        onMomentumScrollEnd={(e) => {
                                            const idx = Math.round(
                                                e.nativeEvent.contentOffset.x / SCREEN_WIDTH
                                            );
                                            setActivePhotoIndex(idx);
                                        }}
                                    >
                                        {allPhotos.map((url, i) => (
                                            <Image
                                                key={i}
                                                source={{ uri: url }}
                                                style={{ width: SCREEN_WIDTH, aspectRatio: 16 / 9 }}
                                                resizeMode="cover"
                                            />
                                        ))}
                                    </ScrollView>
                                    {/* Page dots */}
                                    <View style={styles.pageDots}>
                                        {allPhotos.map((_, i) => (
                                            <View
                                                key={i}
                                                style={[
                                                    styles.pageDot,
                                                    {
                                                        backgroundColor: i === activePhotoIndex
                                                            ? palette.tertiary
                                                            : `${palette.textMuted}4D`,
                                                    },
                                                ]}
                                            />
                                        ))}
                                    </View>
                                </View>
                            ) : (
                                // Single hero image
                                <Image
                                    source={{ uri: heroDisplayUrl! }}
                                    style={{ width: '100%', aspectRatio: 16 / 9 }}
                                    resizeMode="cover"
                                />
                            )}
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: insets.top + 56,
                                    backgroundColor: 'rgba(0,0,0,0.35)',
                                }}
                            />
                            <View
                                style={[
                                    styles.topBar,
                                    { position: 'absolute', top: insets.top, left: 0, right: 0 },
                                ]}
                            >
                                <Pressable onPress={() => router.back()}>
                                    <Text style={[Type.body, { color: '#fff' }]}>← Back</Text>
                                </Pressable>
                                {/* Pencil icon toggles unified photo manage mode (add + remove) */}
                                {isOwnEntry && (
                                    <Pressable
                                        onPress={() => setPhotoManageMode((v) => !v)}
                                        hitSlop={12}
                                    >
                                        <View style={[styles.editPhotoButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                                            <Ionicons
                                                name={photoManageMode ? 'checkmark' : 'pencil-outline'}
                                                size={14}
                                                color="#fff"
                                            />
                                        </View>
                                    </Pressable>
                                )}
                            </View>
                            {/* "User photo" caption — only shown for user-uploaded single photos */}
                            {hasUserPhotos && allPhotos.length === 1 && (
                                <View style={styles.userPhotoCaptionContainer}>
                                    <Text style={[Type.caption, { color: 'rgba(255,255,255,0.85)' }]}>
                                        User photo
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        <>
                            <View style={styles.topBar}>
                                <Pressable onPress={() => router.back()}>
                                    <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                                </Pressable>
                            </View>
                            {/* Muted "Add photos" row in the hero area when own entry has no hero */}
                            {isOwnEntry && (
                                <Pressable
                                    onPress={handlePhotoPress}
                                    style={[
                                        styles.addPhotosHero,
                                        { backgroundColor: palette.surfaceContainerLow },
                                    ]}
                                >
                                    <Ionicons
                                        name="camera-outline"
                                        size={22}
                                        color={palette.textMuted}
                                    />
                                    <Text
                                        style={[
                                            Type.body,
                                            { color: palette.textMuted, marginTop: Spacing.xs },
                                        ]}
                                    >
                                        Add photos
                                    </Text>
                                </Pressable>
                            )}
                        </>
                    )}

                    {/* In-progress new photo uploads */}
                    {newPhotoSlots.length > 0 && (
                        <View style={[styles.section, { paddingTop: Spacing.md }]}>
                            <MultiPhotoRow
                                photos={newPhotoSlots}
                                maxPhotos={MAX_PHOTOS - allPhotos.length}
                                onAdd={handlePhotoPress}
                                onRemove={(slotId) => {
                                    setNewPhotoSlots(prev => prev.filter(s => s.id !== slotId));
                                }}
                                onRetry={(slotId) => {
                                    const slot = newPhotoSlots.find(s => s.id === slotId);
                                    if (slot) startUploadForSlot(slotId, slot.localUri);
                                }}
                                palette={palette}
                            />
                        </View>
                    )}

                    {/* Unified photo manage panel — pencil-gated, shows Add + existing Remove */}
                    {isOwnEntry && photoManageMode && hasHeroDisplay && (
                        <View style={[styles.section, { paddingTop: Spacing.sm }]}>
                            {hasUserPhotos && entryPhotoRows && entryPhotoRows.length > 0 && (
                                <>
                                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                                        Tap a photo to remove it
                                    </Text>
                                    <View
                                        style={{
                                            flexDirection: 'row',
                                            flexWrap: 'wrap',
                                            gap: Spacing.sm,
                                            marginTop: Spacing.xs,
                                        }}
                                    >
                                        {entryPhotoRows.map((row) => (
                                            <Pressable
                                                key={row.id}
                                                onPress={() => handleRemoveExistingPhoto(row.photo_url)}
                                                style={styles.photoThumbContainer}
                                            >
                                                <Image
                                                    source={{ uri: row.photo_url }}
                                                    style={styles.photoThumb}
                                                    resizeMode="cover"
                                                />
                                                <View style={[styles.photoRemoveOverlay]}>
                                                    <Ionicons name="trash-outline" size={16} color="#fff" />
                                                </View>
                                            </Pressable>
                                        ))}
                                    </View>
                                </>
                            )}
                            <Pressable
                                onPress={handlePhotoPress}
                                style={[
                                    styles.addPhotoButton,
                                    {
                                        backgroundColor: palette.surfaceContainerLow,
                                        marginTop: hasUserPhotos ? Spacing.md : 0,
                                    },
                                ]}
                            >
                                <Ionicons name="add" size={18} color={palette.primary} />
                                <Text style={[Type.body, { color: palette.primary, marginLeft: Spacing.xs }]}>
                                    Add a photo
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Header */}
                    <View style={styles.headerSection}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Pressable
                                onPress={() => {
                                    if (entry.user_id && entry.table_id) {
                                        router.push({
                                            pathname: '/member/[userId]',
                                            params: { userId: entry.user_id, tableId: entry.table_id },
                                        });
                                    }
                                }}
                                hitSlop={8}
                            >
                                <InitialsAvatar name={displayName} size={36} palette={palette} />
                            </Pressable>
                            <View>
                                <Pressable
                                    onPress={() => {
                                        if (entry.user_id && entry.table_id) {
                                            router.push({
                                                pathname: '/member/[userId]',
                                                params: { userId: entry.user_id, tableId: entry.table_id },
                                            });
                                        }
                                    }}
                                    hitSlop={4}
                                >
                                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                                        {displayName}
                                    </Text>
                                </Pressable>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>
                                    {relativeDate}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 1 }]}>
                                    {fullDate}
                                    {isRoundEntry ? ' · Round' : ''}
                                </Text>
                                {/* View profile link */}
                                {entry.user_id && entry.table_id && (
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/member/[userId]',
                                                params: { userId: entry.user_id, tableId: entry.table_id! },
                                            })
                                        }
                                        hitSlop={4}
                                    >
                                        <Text
                                            style={[
                                                Type.caption,
                                                { color: palette.primary, marginTop: 2 },
                                            ]}
                                        >
                                            View profile
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>

                        <Pressable
                            onPress={() => {
                                if (entry.restaurant_id) {
                                    router.push({
                                        pathname: '/restaurant/[id]',
                                        params: {
                                            id: entry.restaurant_id,
                                            ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                        },
                                    });
                                }
                            }}
                            disabled={!entry.restaurant_id}
                        >
                            <Text
                                style={[
                                    Type.displayLarge,
                                    {
                                        color: palette.text,
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 38,
                                        lineHeight: 44,
                                        marginTop: Spacing.lg,
                                    },
                                ]}
                            >
                                {restaurantName}
                            </Text>

                            {entry.restaurants?.address ? (
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 4 }]}>
                                    {entry.restaurants.address}
                                </Text>
                            ) : null}
                        </Pressable>

                        {/* Dish subheader — inline edit mode or view mode */}
                        {isEditingDish ? (
                            <View style={{ marginTop: Spacing.sm }}>
                                <TextInput
                                    style={[
                                        styles.inlineTextInput,
                                        { backgroundColor: palette.surfaceContainerLow, color: palette.text },
                                    ]}
                                    value={localDish}
                                    onChangeText={setLocalDish}
                                    placeholder="e.g. Spicy rigatoni, negroni"
                                    placeholderTextColor={palette.textMuted}
                                    autoFocus
                                    onBlur={handleDishSave}
                                />
                                {updateEntry.isPending && (
                                    <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: Spacing.xs }} />
                                )}
                                {dishError && (
                                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.xs }]}>{dishError}</Text>
                                )}
                                <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                                    <Pressable onPress={handleDishCancel}>
                                        <Text style={[Type.caption, { color: palette.textSecondary }]}>Cancel</Text>
                                    </Pressable>
                                    <Pressable onPress={handleDishSave} disabled={updateEntry.isPending}>
                                        <Text style={[Type.caption, { color: palette.primary }]}>Save</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : entry.dish_description ? (
                            <Pressable
                                onPress={isOwnEntry ? handleDishEditStart : undefined}
                                disabled={!isOwnEntry}
                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs }}
                            >
                                <Text style={[Type.headlineItalic, { color: palette.textSecondary }]}>
                                    {'\u2014'} {entry.dish_description}
                                </Text>
                                {isOwnEntry && (
                                    <Ionicons
                                        name="pencil-outline"
                                        size={12}
                                        color={palette.textSecondary}
                                        style={{ marginLeft: Spacing.xs }}
                                    />
                                )}
                            </Pressable>
                        ) : isOwnEntry ? (
                            <Pressable onPress={handleDishEditStart} style={{ marginTop: Spacing.sm }}>
                                <View style={[styles.mutedRow, { backgroundColor: palette.surfaceContainerLow }]}>
                                    <Ionicons name="restaurant-outline" size={16} color={palette.textMuted} />
                                    <Text style={[Type.body, { color: palette.textMuted }]}>Add a dish</Text>
                                </View>
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Previously here — viewer's cross-Table personal history */}
                    {userHistory && userHistory.visit_count > 0 && (
                        <PreviouslyHereBanner
                            voice="user"
                            visitCount={userHistory.visit_count}
                            lastRating={userHistory.last_visit?.rating ?? null}
                            lastDate={userHistory.last_visit?.date ?? null}
                            onPress={
                                entry.restaurant_id
                                    ? () =>
                                          router.push({
                                              pathname: '/restaurant/[id]',
                                              params: {
                                                  id: entry.restaurant_id!,
                                                  ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                              },
                                          })
                                    : undefined
                            }
                        />
                    )}

                    {/* Round Context Banner */}
                    {isRoundEntry && roundContext && (
                        <Pressable
                            onPress={() =>
                                router.push({
                                    pathname: '/table-night-detail',
                                    params: { nightId: entry.table_night_id! },
                                })
                            }
                            style={({ pressed }) => [
                                styles.roundBanner,
                                { backgroundColor: palette.primaryMuted, opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={[Type.titleSmall, { color: palette.primary }]}>
                                    Part of a Round
                                </Text>
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                    {roundContext.participantCount} {roundContext.participantCount === 1 ? 'person' : 'people'}
                                    {roundContext.groupAverage != null
                                        ? ` · Group avg ${roundContext.groupAverage.toFixed(1)}`
                                        : ''}
                                </Text>
                            </View>
                            <Text style={[Type.body, { color: palette.primary }]}>›</Text>
                        </Pressable>
                    )}

                    {/* Overall Rating — tappable for own entries */}
                    <View style={{ alignItems: 'center', marginTop: Spacing.xl }}>
                        {isEditingRating ? (
                            // Inline rating editor
                            <View style={{ alignItems: 'center', gap: Spacing.sm }}>
                                <StarRating
                                    value={localRating ?? 0}
                                    size={36}
                                    editable
                                    onChange={handleRatingChange}
                                    showValue
                                />
                                <View style={{ flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm }}>
                                    <Pressable
                                        onPress={handleRatingCancel}
                                        style={[styles.editActionBtn, { backgroundColor: palette.surfaceContainerHigh }]}
                                    >
                                        <Text style={[Type.caption, { color: palette.textSecondary }]}>Cancel</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleRatingSave}
                                        disabled={updateEntry.isPending}
                                        style={[styles.editActionBtn, { backgroundColor: palette.primary }]}
                                    >
                                        {updateEntry.isPending ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <Text style={[Type.caption, { color: '#fff' }]}>Save</Text>
                                        )}
                                    </Pressable>
                                </View>
                                {ratingError && (
                                    <Text style={[Type.caption, { color: palette.error }]}>{ratingError}</Text>
                                )}
                            </View>
                        ) : (
                            <Pressable
                                onPress={isOwnEntry ? handleRatingTap : undefined}
                                disabled={!isOwnEntry}
                            >
                                {entry.rating != null ? (
                                    <View>
                                        <View
                                            style={[
                                                styles.ratingBubble,
                                                { backgroundColor: palette.tertiaryFixed },
                                                Shadow.ambient,
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    Type.ratingLarge ?? Type.rating,
                                                    { color: palette.tertiary, fontSize: 36, lineHeight: 40 },
                                                ]}
                                            >
                                                {entry.rating.toFixed(1)}
                                            </Text>
                                            <Text style={[Type.labelSmall, { color: palette.tertiary, opacity: 0.7 }]}>
                                                Overall
                                            </Text>
                                            {isOwnEntry && (
                                                <Text style={[Type.caption, { color: palette.tertiary, opacity: 0.5, marginTop: 2, fontSize: 9 }]}>
                                                    Tap to edit
                                                </Text>
                                            )}
                                        </View>
                                        <View style={{ marginTop: Spacing.sm }}>
                                            <StarRating value={entry.rating} size={24} editable={false} />
                                        </View>
                                    </View>
                                ) : isOwnEntry ? (
                                    // No rating yet — muted affordance
                                    <View style={[styles.mutedRow, { backgroundColor: palette.surfaceContainerLow }]}>
                                        <Ionicons name="star-outline" size={16} color={palette.textMuted} />
                                        <Text style={[Type.body, { color: palette.textMuted }]}>Add a rating</Text>
                                    </View>
                                ) : null}
                            </Pressable>
                        )}
                    </View>

                    {/* Category Breakdown */}
                    <View style={styles.section}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md }}>
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Breakdown
                            </Text>
                            {isOwnEntry && hasCategoryRatings && !isEditingBreakdown && (
                                <Pressable onPress={handleBreakdownEditStart} hitSlop={8}>
                                    <Text style={[Type.caption, { color: palette.primary }]}>Edit</Text>
                                </Pressable>
                            )}
                            {isOwnEntry && isEditingBreakdown && (
                                <Pressable onPress={handleBreakdownClose} hitSlop={8}>
                                    <Text style={[Type.caption, { color: palette.textSecondary }]}>Done</Text>
                                </Pressable>
                            )}
                        </View>

                        {hasCategoryRatings || isEditingBreakdown ? (
                            // Breakdown grid — editable for own entries
                            isEditingBreakdown ? (
                                <View style={{ gap: Spacing.md }}>
                                    {CATEGORY_LABELS.map(({ key, label }) => (
                                        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                                            <Text style={[Type.bodySmall, { color: palette.text, width: 60 }]}>{label}</Text>
                                            <StarRating
                                                value={localBreakdown[key] ?? 0}
                                                size={22}
                                                editable
                                                onChange={(v) => handleBreakdownCategoryChange(key, v)}
                                            />
                                            {updateEntry.isPending && (
                                                <ActivityIndicator size="small" color={palette.textMuted} />
                                            )}
                                            {breakdownErrors[key] ? (
                                                <Text style={[Type.caption, { color: palette.error }]}>{breakdownErrors[key]}</Text>
                                            ) : null}
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <View style={styles.breakdownGrid}>
                                    {CATEGORY_LABELS.map(({ key, label }) => {
                                        const val = entry[key];
                                        if (val == null) return null;
                                        return (
                                            <View
                                                key={label}
                                                style={[
                                                    styles.breakdownCell,
                                                    { backgroundColor: palette.surfaceContainerLow },
                                                ]}
                                            >
                                                <Text style={[Type.rating, { color: palette.tertiary, fontSize: 22 }]}>
                                                    {val.toFixed(1)}
                                                </Text>
                                                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 4 }]}>
                                                    {label}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            )
                        ) : isOwnEntry ? (
                            // "Rate the details" muted affordance
                            <Pressable onPress={handleBreakdownEditStart}>
                                <View style={[styles.mutedRow, { backgroundColor: palette.surfaceContainerLow }]}>
                                    <Ionicons name="grid-outline" size={16} color={palette.textMuted} />
                                    <Text style={[Type.body, { color: palette.textMuted }]}>Rate the details</Text>
                                </View>
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Notes */}
                    <View style={styles.section}>
                        <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                            Notes
                        </Text>
                        {isEditingNote ? (
                            <View>
                                <TextInput
                                    style={[
                                        styles.inlineTextArea,
                                        { backgroundColor: palette.surfaceContainerLow, color: palette.text },
                                    ]}
                                    value={localNote}
                                    onChangeText={setLocalNote}
                                    placeholder="How was it? Any highlights?"
                                    placeholderTextColor={palette.textMuted}
                                    multiline
                                    numberOfLines={4}
                                    textAlignVertical="top"
                                    autoFocus
                                />
                                {noteSaving && (
                                    <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: Spacing.xs }} />
                                )}
                                {noteError && (
                                    <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.xs }]}>{noteError}</Text>
                                )}
                                <View style={{ flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm }}>
                                    <Pressable onPress={handleNoteCancel}>
                                        <Text style={[Type.caption, { color: palette.textSecondary }]}>Cancel</Text>
                                    </Pressable>
                                    <Pressable onPress={handleNoteSave} disabled={updateEntry.isPending}>
                                        <Text style={[Type.caption, { color: palette.primary }]}>Save</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : entry.content ? (
                            <Pressable onPress={isOwnEntry ? handleNoteEditStart : undefined} disabled={!isOwnEntry}>
                                <View
                                    style={[
                                        styles.quoteCard,
                                        {
                                            backgroundColor: palette.surfaceContainerLow,
                                            borderLeftColor: palette.tertiaryFixed,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            Type.body,
                                            { color: palette.text, fontStyle: 'italic', lineHeight: 24 },
                                        ]}
                                    >
                                        &ldquo;{entry.content}&rdquo;
                                    </Text>
                                    {isOwnEntry && (
                                        <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                                            Tap to edit
                                        </Text>
                                    )}
                                </View>
                            </Pressable>
                        ) : isOwnEntry ? (
                            <Pressable onPress={handleNoteEditStart}>
                                <View style={[styles.mutedRow, { backgroundColor: palette.surfaceContainerLow }]}>
                                    <Ionicons name="pencil-outline" size={16} color={palette.textMuted} />
                                    <Text style={[Type.body, { color: palette.textMuted }]}>Add a note</Text>
                                </View>
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Action row + Replies */}
                    {entry.id && (
                        <View style={styles.section}>
                            <FeedActionRow
                                targetType="entry"
                                targetId={entry.id}
                                topEmojis={interactions?.counts.top_emojis ?? []}
                                reactionCount={interactions?.counts.reactions ?? 0}
                                commentCount={interactions?.counts.comments ?? 0}
                                myReactions={
                                    viewer
                                        ? (interactions?.reactions ?? [])
                                              .filter((r) => r.user_id === viewer.id)
                                              .map((r) => r.emoji)
                                        : []
                                }
                                palette={palette}
                                detailPathname="/entry-detail"
                                detailParams={{ entryId: entry.id }}
                                tableId={entry.table_id ?? undefined}
                            />
                            <View style={{ height: Spacing.lg }} />
                            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                Replies
                            </Text>
                            <CommentThread
                                targetType="entry"
                                targetId={entry.id}
                                comments={interactions?.comments ?? []}
                                autoFocusComposer={focus === 'reply'}
                            />
                        </View>
                    )}
                </ScrollView>
            </View>
        </>
    );
}

// ── Components ─────────────────────────────────────────────────────────────────

function InitialsAvatar({
    name,
    size,
    palette,
}: {
    name: string;
    size: number;
    palette: Palette;
}) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [
        palette.tertiaryFixed,
        palette.secondaryContainer,
        palette.primaryMuted,
    ];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Text
                style={{
                    fontFamily: 'Manrope_600SemiBold',
                    fontSize: size * 0.36,
                    color: palette.text,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerSection: { paddingHorizontal: Spacing.lg },
    ratingBubble: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.xl,
    },
    section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl },
    breakdownGrid: { flexDirection: 'row', gap: Spacing.sm },
    breakdownCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },
    roundBanner: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    userPhotoCaptionContainer: {
        position: 'absolute',
        bottom: Spacing.sm,
        right: Spacing.sm,
        backgroundColor: 'rgba(0,0,0,0.35)',
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.sm,
    },
    pageDots: {
        position: 'absolute',
        bottom: Spacing.sm,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    pageDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    // Edit affordances
    mutedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        padding: Spacing.md,
        borderRadius: Radius.md,
    },
    editActionBtn: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        minWidth: 64,
        alignItems: 'center',
    },
    inlineTextInput: {
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        fontFamily: 'Manrope_400Regular',
        minHeight: 44,
    },
    inlineTextArea: {
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        fontFamily: 'Manrope_400Regular',
        minHeight: 100,
    },
    editPhotoButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoThumbContainer: {
        position: 'relative',
        width: 80,
        height: 80,
    },
    photoThumb: {
        width: 80,
        height: 80,
        borderRadius: Radius.md,
    },
    photoRemoveOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: Radius.md,
        backgroundColor: 'rgba(0,0,0,0.4)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    addPhotosHero: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.md,
        paddingVertical: Spacing.xl,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addPhotoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },
});
