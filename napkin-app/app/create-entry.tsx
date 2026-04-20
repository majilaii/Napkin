/**
 * Create Entry — unified logger for solo shares, journal entries, and Rounds.
 *
 * Flow: Restaurant search → Table picker → [Mode picker if group] →
 *       [Attendee picker if Round] → Impression form → Submit
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    Pressable,
    ActivityIndicator,
    Alert,
    ActionSheetIOS,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useStartRound } from '@/hooks/tables/useStartRound';
import { StarRating } from '@/components/StarRating';
import {
    SheetHeader,
    RestaurantHeader,
    FieldUnderline,
    PhotoCollage,
    Label,
    LabelSmall,
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { compressAndUpload, removeUploadedPhoto, PhotoUploadError } from '@/lib/imageUpload';

// ── Types ─────────────────────────────────────────────────────────────────

type PostMode = 'solo' | 'round';

interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
    uploadGen: number;
}

const MAX_PHOTOS = 6;

interface PlaceResult {
    id: string;
    name: string;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    categories: string[];
    photoReference: string | null;
}

// ── Screen ────────────────────────────────────────────────────────────────

export default function CreateEntryScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const {
        tableId: tableIdParam,
        restaurantId: restaurantIdParam,
        placePayload: placePayloadParam,
        mode: modeParam,
        rating: ratingParam,
    } = useLocalSearchParams<{
        tableId?: string;
        restaurantId?: string;
        placePayload?: string;
        mode?: 'solo' | 'round';
        rating?: string;
    }>();

    // Tables data
    const { data: tableMemberships } = useTables(user?.id);

    const tables = (tableMemberships ?? []).map(m => m.tables);
    const sortedTables = [...tables].sort((a, b) => {
        if (a.is_personal && !b.is_personal) return -1;
        if (!a.is_personal && b.is_personal) return 1;
        return 0;
    });

    const personalTable = sortedTables.find(t => t.is_personal);
    const defaultTableId = tableIdParam ?? personalTable?.id ?? sortedTables[0]?.id ?? null;
    const [selectedTableId, setSelectedTableId] = useState<string | null>(defaultTableId);

    useEffect(() => {
        if (!selectedTableId && defaultTableId) {
            setSelectedTableId(defaultTableId);
        }
    }, [defaultTableId, selectedTableId]);

    const selectedTable = sortedTables.find(t => t.id === selectedTableId) ?? null;
    const isPersonalTable = selectedTable?.is_personal === true;

    // Mode picker (group tables only)
    const [postMode, setPostMode] = useState<PostMode>(modeParam === 'round' ? 'round' : 'solo');

    // Reset mode when switching to personal table
    useEffect(() => {
        if (isPersonalTable) setPostMode('solo');
    }, [isPersonalTable]);

    // Participant tagging (Round mode on group tables)
    const { data: tableMembers, isLoading: membersLoading } = useTableMembers(
        !isPersonalTable && postMode === 'round' ? selectedTableId : null
    );
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());

    // Reset participants when table or mode changes
    useEffect(() => {
        setSelectedParticipantIds(new Set());
    }, [selectedTableId, postMode]);

    const createEntry = useCreateEntry(user?.id, selectedTableId);
    const startRound = useStartRound(user?.id, selectedTableId);

    // ── Prefill from route params ─────────────────────────────────────────────
    // Parse placePayload (ghost arrivals from the restaurant page) into a PlaceResult
    const prefillPlace = React.useMemo<PlaceResult | null>(() => {
        if (placePayloadParam) {
            try {
                const p = JSON.parse(placePayloadParam);
                return {
                    id: p.id ?? p.external_id ?? p.placeId ?? '',
                    name: p.name ?? '',
                    formattedAddress: p.formattedAddress ?? p.address ?? null,
                    latitude: p.latitude ?? null,
                    longitude: p.longitude ?? null,
                    categories: p.categories ?? [],
                    photoReference: p.photoReference ?? null,
                };
            } catch {
                return null;
            }
        }
        return null;
    }, [placePayloadParam]);

    // Search state
    const [query, setQuery] = useState(prefillPlace?.name ?? '');
    const [results, setResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(prefillPlace);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // When prefillPlace resolves (from parsed param on first render), ensure it's selected
    useEffect(() => {
        if (prefillPlace && !selectedPlace) {
            setSelectedPlace(prefillPlace);
            setQuery(prefillPlace.name);
        }
    }, [prefillPlace]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch restaurant by Napkin UUID when restaurantId param is present but no placePayload
    useEffect(() => {
        if (!restaurantIdParam || prefillPlace) return;
        (async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const { data, error } = await supabase.functions.invoke(
                    `restaurant-history?action=page&restaurant_id=${encodeURIComponent(restaurantIdParam)}`,
                    {
                        headers: session?.access_token
                            ? { Authorization: `Bearer ${session.access_token}` }
                            : undefined,
                    },
                );
                const r = (!error && data?.data?.restaurant) ? data.data.restaurant : null;
                const place: PlaceResult = {
                    id: r?.external_id ?? restaurantIdParam,
                    name: r?.name ?? '',
                    formattedAddress: r?.address ?? null,
                    latitude: null,
                    longitude: null,
                    categories: r?.cuisine ? [r.cuisine] : [],
                    photoReference: null,
                };
                setSelectedPlace(place);
                setQuery(place.name);
            } catch {
                // Best-effort: at minimum the id is known; submit will still work
                setSelectedPlace({
                    id: restaurantIdParam,
                    name: '',
                    formattedAddress: null,
                    latitude: null,
                    longitude: null,
                    categories: [],
                    photoReference: null,
                });
            }
        })();
    }, [restaurantIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

    // Impression form state — seed rating from fast-log "Add details" path
    const [rating, setRating] = useState(Number(ratingParam) || 0);
    const [vibeRating, setVibeRating] = useState(0);
    const [flavorRating, setFlavorRating] = useState(0);
    const [serviceRating, setServiceRating] = useState(0);
    const [valueRating, setValueRating] = useState(0);
    const [showDetails, setShowDetails] = useState(false);
    const [notes, setNotes] = useState('');
    const [dish, setDish] = useState('');

    // Multi-photo upload state
    const [photos, setPhotos] = useState<PhotoSlot[]>([]);
    const uploadGenRefs = useRef(new Map<string, number>());

    const canSubmit = (selectedPlace !== null || query.trim().length > 0) && rating > 0 && !photos.some(p => p.uploading);
    const isSubmitting = createEntry.isPending || startRound.isPending;

    // ── Device location for search bias ──────────────────────────────────
    const [deviceLocation, setDeviceLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setDeviceLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        })();
    }, []);

    // ── Debounced search ──────────────────────────────────────────────────

    useEffect(() => {
        if (selectedPlace) return;
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => searchPlaces(query.trim()), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, selectedPlace]);

    const searchPlaces = async (q: string) => {
        setSearching(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('places-search', {
                body: {
                    query: q,
                    limit: 5,
                    ...(deviceLocation && { latitude: deviceLocation.latitude, longitude: deviceLocation.longitude }),
                },
                headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : undefined,
            });
            if (error) throw error;
            setResults(data?.data ?? []);
        } catch (e) {
            console.warn('Places search failed:', e);
        } finally {
            setSearching(false);
        }
    };

    const handleSelectPlace = (place: PlaceResult) => {
        setSelectedPlace(place);
        setQuery(place.name);
        setResults([]);
    };

    const handleClearPlace = () => {
        setSelectedPlace(null);
        setQuery('');
        setResults([]);
    };

    const toggleParticipant = (memberId: string) => {
        if (!user || memberId === user.id) return;
        setSelectedParticipantIds(prev => {
            const next = new Set(prev);
            if (next.has(memberId)) {
                next.delete(memberId);
            } else {
                next.add(memberId);
            }
            return next;
        });
    };

    // ── Photo upload ──────────────────────────────────────────────────────

    // Keep a ref to current photos for cleanup — avoids stale closure in unmount effect
    const photosRef = useRef(photos);
    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);

    // Clean up orphaned uploads if user exits without submitting
    useEffect(() => {
        return () => {
            for (const slot of photosRef.current) {
                if (slot.publicUrl) {
                    removeUploadedPhoto(slot.publicUrl).catch(() => {});
                }
            }
        };
    }, []);

    const startUploadForSlot = useCallback(async (slotId: string, uri: string) => {
        if (!user?.id) return;
        // Increment gen for this slot
        const gen = (uploadGenRefs.current.get(slotId) ?? 0) + 1;
        uploadGenRefs.current.set(slotId, gen);

        setPhotos(prev => prev.map(s => s.id === slotId
            ? { ...s, uploading: true, error: null }
            : s
        ));

        try {
            const url = await compressAndUpload(uri, user.id);
            // Check if still current (slot not removed, gen not incremented)
            if (uploadGenRefs.current.get(slotId) !== gen) {
                removeUploadedPhoto(url).catch(() => {});
                return;
            }
            setPhotos(prev => prev.map(s => s.id === slotId
                ? { ...s, publicUrl: url, uploading: false, uploadGen: gen }
                : s
            ));
        } catch (err) {
            if (uploadGenRefs.current.get(slotId) !== gen) return;
            let errorMsg = 'Upload failed. Tap to retry.';
            if (err instanceof PhotoUploadError && err.code === 'too_large') {
                errorMsg = 'Photo is too large. Please choose a smaller image.';
            }
            setPhotos(prev => prev.map(s => s.id === slotId
                ? { ...s, uploading: false, error: errorMsg }
                : s
            ));
        }
    }, [user?.id]);

    const addPhotoSlot = useCallback((uri: string) => {
        setPhotos(prev => {
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
            // Kick off upload asynchronously
            setTimeout(() => startUploadForSlot(slotId, uri), 0);
            return [...prev, newSlot];
        });
    }, [startUploadForSlot]);

    const handleRemovePhoto = useCallback((slotId: string) => {
        // Invalidate in-flight upload for this slot
        const currentGen = uploadGenRefs.current.get(slotId) ?? 0;
        uploadGenRefs.current.set(slotId, currentGen + 1);

        setPhotos(prev => {
            const slot = prev.find(s => s.id === slotId);
            if (slot?.publicUrl) {
                removeUploadedPhoto(slot.publicUrl).catch(() => {});
            }
            return prev.filter(s => s.id !== slotId);
        });
    }, []);

    const handleRetryPhoto = useCallback((slotId: string) => {
        const slot = photos.find(s => s.id === slotId);
        if (slot) {
            startUploadForSlot(slotId, slot.localUri);
        }
    }, [photos, startUploadForSlot]);

    const handlePhotoPress = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Take Photo', 'Choose from Library'],
                    cancelButtonIndex: 0,
                },
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
            Alert.alert(
                'Camera Access Required',
                'Please enable camera access in your device Settings to take a photo.',
                [{ text: 'OK' }]
            );
            return;
        }
        let result;
        try {
            result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 1,
            });
        } catch {
            Alert.alert('Camera Unavailable', 'Camera is not available on this device. Try choosing from your photo library instead.');
            return;
        }
        if (!result.canceled && result.assets[0]) {
            addPhotoSlot(result.assets[0].uri);
        }
    };

    const pickFromLibrary = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(
                'Photo Library Access Required',
                'Please enable photo library access in your device Settings to choose a photo.',
                [{ text: 'OK' }]
            );
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
        });
        if (!result.canceled && result.assets[0]) {
            addPhotoSlot(result.assets[0].uri);
        }
    };

    // ── Submit ────────────────────────────────────────────────────────────

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;

        const restaurantData = selectedPlace
            ? {
                external_id: selectedPlace.id,
                name: selectedPlace.name,
                location: selectedPlace.formattedAddress
                    ? { address: selectedPlace.formattedAddress }
                    : undefined,
                types: selectedPlace.categories?.length
                    ? selectedPlace.categories
                    : ['restaurant'],
                latitude: selectedPlace.latitude ?? undefined,
                longitude: selectedPlace.longitude ?? undefined,
                photoReference: selectedPlace.photoReference ?? undefined,
            }
            : {
                external_id: `manual-${query.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
                name: query.trim(),
                types: ['restaurant'] as string[],
            };

        const secondaryRatings = {
            vibe_rating: vibeRating > 0 ? vibeRating : null,
            flavor_rating: flavorRating > 0 ? flavorRating : null,
            service_rating: serviceRating > 0 ? serviceRating : null,
            value_rating: valueRating > 0 ? valueRating : null,
        };

        const ratingValue = Math.round(rating * 2) / 2;

        // Build ordered photo URLs from uploaded slots
        const photoUrls = photos
            .filter(p => p.publicUrl !== null)
            .map(p => p.publicUrl as string);

        try {
            if (!isPersonalTable && postMode === 'round') {
                // Start a Round
                await startRound.mutateAsync({
                    table_id: selectedTableId!,
                    restaurant: restaurantData,
                    participant_ids: Array.from(selectedParticipantIds),
                    rating: ratingValue,
                    notes: notes.trim() || undefined,
                    dish_description: dish.trim() || undefined,
                    ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
                    ...secondaryRatings,
                });
            } else {
                // Solo journal or Solo share
                await createEntry.mutateAsync({
                    restaurant: restaurantData,
                    rating: ratingValue,
                    content: notes.trim() || undefined,
                    dish_description: dish.trim() || undefined,
                    table_id: selectedTableId ?? undefined,
                    visibility: selectedTableId ? 'table' : 'private',
                    ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
                    ...secondaryRatings,
                });
            }
            // Photos are now persisted — clear so cleanup effect doesn't delete them
            setPhotos([]);
            router.back();
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not save entry');
        }
    }, [
        canSubmit, rating, notes, dish, selectedPlace, query,
        selectedTableId, isPersonalTable, postMode, selectedParticipantIds,
        vibeRating, flavorRating, serviceRating, valueRating,
        photos,
        createEntry, startRound, router,
    ]);

    // ── Submit label ──────────────────────────────────────────────────────

    const submitLabel = isPersonalTable
        ? 'LOG IT'
        : postMode === 'round'
            ? 'START THE ROUND'
            : 'SHARE';

    // Table picker subtitle — neutral placeholder per architect's clarification (3).
    // Do NOT fabricate wishlist/shortlist reasons — ships a lie until the lookup exists.
    const TABLE_SUBTITLE = 'tap to share to this table';

    // Initials for the 30x30 glyph tile per table (first letter of name).
    const tableGlyph = (name: string) =>
        name.trim().charAt(0).toUpperCase() || 'T';

    // Restaurant meta for the header block (Dinner · Tue Apr 14 style is future work;
    // keep it grounded in address for now since that's what we already have).
    const headerMeta = selectedPlace?.formattedAddress ?? undefined;

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: palette.card }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <View style={{ paddingTop: insets.top }}>
                    <SheetHeader
                        title="A new entry"
                        leftLabel="Cancel"
                        rightLabel={submitLabel === 'LOG IT' ? 'Save' : submitLabel === 'START THE ROUND' ? 'Start' : 'Post'}
                        onLeftPress={() => router.back()}
                        onRightPress={handleSubmit}
                        rightDisabled={!canSubmit}
                        rightPending={isSubmitting}
                    />
                </View>
                <ScrollView
                    contentContainerStyle={{
                        paddingTop: Spacing.md,
                        paddingBottom: insets.bottom + 120,
                        paddingHorizontal: Spacing.lg + 2,
                    }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Pressable onPress={() => router.back()}>
                            <Text style={[Type.body, { color: palette.primary }]}>
                                Cancel
                            </Text>
                        </Pressable>
                        <Text
                            style={[
                                Type.headlineLarge,
                                {
                                    color: palette.text,
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 20,
                                },
                            ]}
                        >
                            Log a Meal
                        </Text>
                        <View style={{ width: 50 }} />
                    </View>

                    {/* Restaurant search */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            Where did you eat?
                        </Text>

                        {selectedPlace ? (
                            <Pressable
                                onPress={handleClearPlace}
                                style={[
                                    styles.selectedChip,
                                    { backgroundColor: palette.surfaceContainerLow },
                                ]}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text
                                        style={{
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 22,
                                            color: palette.text,
                                        }}
                                        numberOfLines={1}
                                    >
                                        {selectedPlace.name}
                                    </Text>
                                    {selectedPlace.formattedAddress && (
                                        <Text
                                            style={[
                                                Type.caption,
                                                { color: palette.textSecondary, marginTop: 2 },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {selectedPlace.formattedAddress}
                                        </Text>
                                    )}
                                </View>
                                <Text style={{ fontSize: 18, color: palette.textMuted, marginLeft: Spacing.sm }}>
                                    ✕
                                </Text>
                            </Pressable>
                        ) : (
                            <View>
                                <View style={{ position: 'relative' }}>
                                    <TextInput
                                        style={[
                                            styles.textInput,
                                            {
                                                backgroundColor: palette.surfaceContainerLow,
                                                color: palette.text,
                                                fontFamily: 'Newsreader_400Regular_Italic',
                                                fontSize: 22,
                                            },
                                        ]}
                                        placeholder="Search restaurants..."
                                        placeholderTextColor={palette.textMuted}
                                        value={query}
                                        onChangeText={setQuery}
                                        autoFocus={!restaurantIdParam && !placePayloadParam}
                                    />
                                ) : null}
                            </View>
                            {results.length > 0 ? (
                                <View
                                    style={[
                                        styles.dropdown,
                                        {
                                            backgroundColor: palette.surfaceContainerLow,
                                            ...Shadow.subtle,
                                        },
                                    ]}
                                >
                                    {results.map((place, i) => (
                                        <Pressable
                                            key={place.id}
                                            onPress={() => handleSelectPlace(place)}
                                            style={({ pressed }) => [
                                                styles.dropdownRow,
                                                {
                                                    backgroundColor: pressed
                                                        ? palette.surfaceContainerHigh
                                                        : 'transparent',
                                                    borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                                                    borderTopColor: palette.surfaceContainerHigh,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    Type.body,
                                                    {
                                                        color: palette.text,
                                                        fontFamily: 'Manrope_500Medium',
                                                    },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {place.name}
                                            </Text>
                                            {place.formattedAddress ? (
                                                <Text
                                                    style={[
                                                        Type.caption,
                                                        { color: palette.textSecondary, marginTop: 1 },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {place.formattedAddress}
                                                </Text>
                                            ) : null}
                                        </Pressable>
                                    ))}
                                </View>
                            ) : null}
                            {query.trim().length >= 2 && results.length === 0 && !searching ? (
                                <Text
                                    style={[
                                        Type.caption,
                                        { color: palette.textMuted, marginTop: Spacing.xs },
                                    ]}
                                >
                                    no results — you can still submit with this name
                                </Text>
                            ) : null}
                        </View>
                    )}

                    {/* Overall rating — stars row */}
                    <View style={{ marginTop: Spacing.lg }}>
                        <StarRating
                            value={rating}
                            size={26}
                            editable
                            onChange={setRating}
                        />
                    </View>

                    {/* Dynamic photo collage */}
                    <View style={{ marginTop: Spacing.lg }}>
                        <PhotoCollage
                            photos={photos}
                            maxPhotos={MAX_PHOTOS}
                            onAdd={handlePhotoPress}
                            onRemove={handleRemovePhoto}
                            onRetry={handleRetryPhoto}
                        />
                    </View>

                    {/* Notes — Newsreader 18/1.55 prose, no fill, "Start writing…" ghost */}
                    <View style={{ marginTop: Spacing.xl - 4 }}>
                        <TextInput
                            style={{
                                fontFamily: 'Newsreader_400Regular',
                                fontSize: 18,
                                lineHeight: 28,
                                color: palette.text,
                                minHeight: 160,
                                padding: 0,
                                textAlignVertical: 'top',
                            }}
                            placeholder="Start writing…"
                            placeholderTextColor={palette.textMuted}
                            value={notes}
                            onChangeText={setNotes}
                            multiline
                        />
                    </View>

                    {/* Dish — FieldUnderline with LabelSmall above */}
                    <View style={{ marginTop: Spacing.xl - 4 }}>
                        <FieldUnderline
                            label="What did you have?"
                            value={dish}
                            onChangeText={setDish}
                            placeholder="e.g. spicy rigatoni, negroni"
                            fontVariant="sans"
                            size="body"
                        />
                    </View>

                    {/* Secondary ratings — collapsible, underline-divided */}
                    <View
                        style={[
                            styles.sectionDivider,
                            { backgroundColor: palette.dividerSoft },
                        ]}
                    />
                    <View>
                        <Pressable
                            style={styles.detailsToggle}
                            onPress={() => setShowDetails(!showDetails)}
                        >
                            <Label>Break it down</Label>
                            <Ionicons
                                name={showDetails ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color={palette.textSecondary}
                            />
                        </Pressable>

                        {showDetails ? (
                            <View style={styles.detailRatings}>
                                {([
                                    ['Flavor', flavorRating, setFlavorRating],
                                    ['Vibes', vibeRating, setVibeRating],
                                    ['Service', serviceRating, setServiceRating],
                                    ['Value', valueRating, setValueRating],
                                ] as const).map(([label, val, setter]) => (
                                    <View key={label} style={styles.detailRow}>
                                        <Text
                                            style={[
                                                Type.labelSmall,
                                                { color: palette.textSecondary, width: 72 },
                                            ]}
                                        >
                                            {label.toUpperCase()}
                                        </Text>
                                        <StarRating
                                            value={val as number}
                                            size={22}
                                            editable
                                            onChange={setter as (v: number) => void}
                                        />
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </View>

                    {/* Table picker — single-select radio rows (clarification 2) */}
                    {sortedTables.length > 0 ? (
                        <>
                            <View
                                style={[
                                    styles.sectionDivider,
                                    { backgroundColor: palette.dividerSoft },
                                ]}
                            />
                            <View style={styles.tablePickerHeader}>
                                <Label>Share to a table?</Label>
                                <Text
                                    style={{
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 13,
                                        color: palette.textMuted,
                                    }}
                                >
                                    optional
                                </Text>
                            </View>
                            {sortedTables.map((t) => {
                                const isSelected = selectedTableId === t.id;
                                return (
                                    <Pressable
                                        key={t.id}
                                        onPress={() => setSelectedTableId(t.id)}
                                        style={({ pressed }) => [
                                            styles.tableRow,
                                            {
                                                backgroundColor: isSelected
                                                    ? palette.surfaceContainer
                                                    : 'transparent',
                                                borderColor: isSelected
                                                    ? palette.primary
                                                    : 'transparent',
                                                opacity: pressed ? 0.85 : 1,
                                            },
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.glyphTile,
                                                {
                                                    backgroundColor: isSelected
                                                        ? palette.primary
                                                        : palette.primaryMuted,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={{
                                                    fontFamily: 'Newsreader_400Regular_Italic',
                                                    fontSize: 14,
                                                    fontWeight: '600',
                                                    color: isSelected ? '#fff' : palette.primary,
                                                }}
                                            >
                                                {tableGlyph(t.name)}
                                            </Text>
                                        </View>
                                        <View style={{ flex: 1, minWidth: 0 }}>
                                            <Text
                                                style={{
                                                    fontFamily: 'Newsreader_400Regular_Italic',
                                                    fontSize: 15,
                                                    color: palette.text,
                                                    lineHeight: 18,
                                                }}
                                                numberOfLines={1}
                                            >
                                                {t.name}
                                            </Text>
                                            <Text
                                                style={{
                                                    fontFamily: 'Manrope_400Regular',
                                                    fontSize: 11,
                                                    color: palette.textMuted,
                                                    marginTop: 2,
                                                    lineHeight: 14,
                                                }}
                                                numberOfLines={1}
                                            >
                                                {TABLE_SUBTITLE}
                                            </Text>
                                        </View>
                                        {/* Radio glyph — empty circle / filled dot (clarification 2) */}
                                        <View
                                            style={[
                                                styles.radioOuter,
                                                {
                                                    borderColor: isSelected
                                                        ? palette.primary
                                                        : palette.ruleInkSoft,
                                                },
                                            ]}
                                        >
                                            {isSelected ? (
                                                <View
                                                    style={[
                                                        styles.radioInner,
                                                        { backgroundColor: palette.primary },
                                                    ]}
                                                />
                                            ) : null}
                                        </View>
                                    </Pressable>
                                );
                            })}
                            <Text
                                style={{
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 11,
                                    color: palette.textMuted,
                                    marginTop: Spacing.sm,
                                    lineHeight: 16,
                                }}
                            >
                                Tables see each other&apos;s logs. Leave this on your personal Table to keep it private to your Journal.
                            </Text>
                        </>
                    ) : null}

                    {/* Mode picker (group tables only) — restyled kit chrome */}
                    {!isPersonalTable && selectedTableId ? (
                        <>
                            <View
                                style={[
                                    styles.sectionDivider,
                                    { backgroundColor: palette.dividerSoft },
                                ]}
                            />
                            <Label style={{ marginBottom: Spacing.sm }}>How are you posting?</Label>
                            <View style={styles.modePicker}>
                                <Pressable
                                    onPress={() => setPostMode('solo')}
                                    style={({ pressed }) => [
                                        styles.modeCard,
                                        {
                                            backgroundColor:
                                                postMode === 'solo'
                                                    ? palette.surfaceContainer
                                                    : palette.surfaceContainerLow,
                                            borderColor:
                                                postMode === 'solo'
                                                    ? palette.primary
                                                    : palette.ruleInkSoft,
                                            opacity: pressed ? 0.85 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="chatbubble-outline"
                                        size={20}
                                        color={
                                            postMode === 'solo'
                                                ? palette.primary
                                                : palette.textSecondary
                                        }
                                    />
                                    <Text
                                        style={{
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 16,
                                            color:
                                                postMode === 'solo'
                                                    ? palette.primary
                                                    : palette.text,
                                            marginTop: Spacing.xs,
                                        }}
                                    >
                                        Solo share
                                    </Text>
                                    <Text
                                        style={[
                                            Type.caption,
                                            {
                                                color: palette.textMuted,
                                                marginTop: 2,
                                                textAlign: 'center',
                                            },
                                        ]}
                                    >
                                        a quick rec to the group
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setPostMode('round')}
                                    style={({ pressed }) => [
                                        styles.modeCard,
                                        {
                                            backgroundColor:
                                                postMode === 'round'
                                                    ? palette.surfaceContainer
                                                    : palette.surfaceContainerLow,
                                            borderColor:
                                                postMode === 'round'
                                                    ? palette.primary
                                                    : palette.ruleInkSoft,
                                            opacity: pressed ? 0.85 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="people-outline"
                                        size={20}
                                        color={
                                            postMode === 'round'
                                                ? palette.primary
                                                : palette.textSecondary
                                        }
                                    />
                                    <Text
                                        style={{
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 16,
                                            color:
                                                postMode === 'round'
                                                    ? palette.primary
                                                    : palette.text,
                                            marginTop: Spacing.xs,
                                        }}
                                    >
                                        Start a Round
                                    </Text>
                                    <Text
                                        style={[
                                            Type.caption,
                                            {
                                                color: palette.textMuted,
                                                marginTop: 2,
                                                textAlign: 'center',
                                            },
                                        ]}
                                    >
                                        everyone rates it
                                    </Text>
                                </Pressable>
                            </View>
                        </>
                    ) : null}

                    {/* Attendee picker (Round mode only) */}
                    {!isPersonalTable && postMode === 'round' && selectedTableId ? (
                        <View style={{ marginTop: Spacing.lg }}>
                            <Label style={{ marginBottom: Spacing.sm }}>Who was there?</Label>
                            {membersLoading ? (
                                <ActivityIndicator
                                    size="small"
                                    color={palette.textMuted}
                                    style={{ marginTop: Spacing.sm }}
                                />
                            ) : tableMembers &&
                              tableMembers.filter((m) => m.member_id !== user?.id).length > 0 ? (
                                <View style={styles.participantGrid}>
                                    {tableMembers.map((member) => {
                                        const isCreator = member.member_id === user?.id;
                                        const isSelected =
                                            isCreator || selectedParticipantIds.has(member.member_id);
                                        const displayName = member.profiles?.display_name ?? 'Member';
                                        const initials = displayName
                                            .split(' ')
                                            .map((n) => n[0])
                                            .join('')
                                            .slice(0, 2)
                                            .toUpperCase();

                                        return (
                                            <Pressable
                                                key={member.member_id}
                                                onPress={() => toggleParticipant(member.member_id)}
                                                disabled={isCreator}
                                                style={[
                                                    styles.participantChip,
                                                    {
                                                        backgroundColor: isSelected
                                                            ? palette.primary
                                                            : palette.surfaceContainerLow,
                                                    },
                                                ]}
                                            >
                                                <View
                                                    style={[
                                                        styles.participantAvatar,
                                                        {
                                                            backgroundColor: isSelected
                                                                ? 'rgba(255,255,255,0.25)'
                                                                : palette.surfaceContainerHigh,
                                                        },
                                                    ]}
                                                >
                                                    <Text
                                                        style={{
                                                            fontSize: 11,
                                                            color: isSelected ? '#fff' : palette.text,
                                                            fontFamily: 'Manrope_600SemiBold',
                                                        }}
                                                    >
                                                        {initials}
                                                    </Text>
                                                </View>
                                                <Text
                                                    style={[
                                                        Type.caption,
                                                        {
                                                            color: isSelected ? '#fff' : palette.text,
                                                            maxWidth: 60,
                                                        },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {displayName.split(' ')[0]}
                                                    {isCreator ? ' (you)' : ''}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ) : (
                                <View
                                    style={[
                                        styles.emptyMembersBox,
                                        { backgroundColor: palette.surfaceContainerLow },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            Type.body,
                                            { color: palette.textMuted, textAlign: 'center' },
                                        ]}
                                    >
                                        No friends at this table yet
                                    </Text>
                                    <Text
                                        style={[
                                            Type.caption,
                                            {
                                                color: palette.textMuted,
                                                textAlign: 'center',
                                                marginTop: 2,
                                            },
                                        ]}
                                    >
                                        Invite people from the table settings
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : null}

                    {/* Primary CTA — pill, terracotta, UPPERCASE tracked */}
                    <Pressable
                        disabled={!canSubmit || isSubmitting}
                        onPress={handleSubmit}
                        style={({ pressed }) => [
                            styles.ctaButton,
                            {
                                backgroundColor: canSubmit
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                                opacity: pressed ? 0.85 : isSubmitting ? 0.6 : 1,
                            },
                        ]}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text
                                style={[
                                    Type.label,
                                    {
                                        color: canSubmit ? '#fff' : palette.textMuted,
                                        letterSpacing: 1.5,
                                    },
                                ]}
                            >
                                {submitLabel}
                            </Text>
                        )}
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    fieldGroup: {
        gap: Spacing.sm,
    },
    dropdown: {
        borderRadius: Radius.md,
        marginTop: Spacing.xs,
        overflow: 'hidden',
    },
    dropdownRow: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
    },
    sectionDivider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: Spacing.lg,
    },
    // "Break it down" toggle
    detailsToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    detailRatings: {
        gap: Spacing.md,
        paddingTop: Spacing.md,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    // Table picker
    tablePickerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm + 2,
    },
    tableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md - 4,
        paddingVertical: Spacing.sm + 4,
        paddingHorizontal: Spacing.sm + 4,
        borderRadius: 8,
        marginBottom: Spacing.xs + 2,
        borderWidth: 1,
    },
    glyphTile: {
        width: 30,
        height: 30,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    radioOuter: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    // Mode picker
    modePicker: {
        flexDirection: 'row',
        gap: Spacing.sm + 2,
    },
    modeCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.md,
        borderWidth: 1,
    },
    // Participants
    participantGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
    },
    participantChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.full,
    },
    participantAvatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyMembersBox: {
        paddingVertical: Spacing.lg,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.lg,
        alignItems: 'center',
    },
    // Submit pill
    ctaButton: {
        height: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xl,
    },
});
