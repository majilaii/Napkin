/**
 * Create Entry — Concept A "The Page" composer.
 *
 * Layout: masthead (restaurant name + inline stars) / writing surface / chip row / drawer.
 * Table share footer appears only when user has ≥1 Table — defaults OFF.
 * Breakdown ratings live inside the AddDetailsDrawer, off the primary surface.
 * Round mode still reachable via `mode=round` URL param.
 *
 * Submit labels: Save (solo) / Share (Table share ON) / Start Round (round mode).
 * "LOG IT" is removed.
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
import { useRecentlyPostedTables } from '@/hooks/tables/useRecentlyPostedTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useStartRound } from '@/hooks/tables/useStartRound';
import {
    SheetHeader,
    FieldUnderline,
    PhotoCollage,
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { compressAndUpload, removeUploadedPhoto, PhotoUploadError } from '@/lib/imageUpload';
import { CompanionChipsRow, CompanionPickerSheet } from '@/components/logging';
import {
    ComposerMasthead,
    WritingSurface,
    ChipRow,
    AddDetailsDrawer,
    TablePickerSheet,
    TableChipsRow,
} from '@/components/create-entry';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';
import { useQuery } from '@tanstack/react-query';

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
    photoAttributionHtml: string | null;
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
        visitedAt: visitedAtParam,
    } = useLocalSearchParams<{
        tableId?: string;
        restaurantId?: string;
        placePayload?: string;
        mode?: 'solo' | 'round';
        rating?: string;
        visitedAt?: string;
    }>();

    // Tables data
    const { data: tableMemberships, isLoading: tablesLoading, refetch: refetchTables } = useTables(user?.id);
    const tables = (tableMemberships ?? []).map(m => m.tables);
    const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name));

    // TICKET-043: recently posted tables for Smart-three ordering.
    const { data: recentlyPosted } = useRecentlyPostedTables(user?.id);
    // Smart-three order: context-pinned (from URL param) first, then recency, rest alphabetical.
    const orderedTables = React.useMemo(() => {
        const pinnedId = tableIdParam ?? null;
        const recentIds = (recentlyPosted ?? []).map(m => m.tables.id);
        const allTableMap = new Map(tables.map(t => [t.id, t]));

        const pinned = pinnedId && allTableMap.has(pinnedId) ? [allTableMap.get(pinnedId)!] : [];
        const recent = recentIds
            .filter(id => id !== pinnedId && allTableMap.has(id))
            .map(id => allTableMap.get(id)!);
        const rest = tables
            .filter(t => t.id !== pinnedId && !recentIds.includes(t.id))
            .sort((a, b) => a.name.localeCompare(b.name));

        return [...pinned, ...recent, ...rest];
    }, [tables, recentlyPosted, tableIdParam]);

    // Mode picker (round mode reachable via `mode=round` param — not surfaced in solo chrome)
    const [postMode, setPostMode] = useState<PostMode>(modeParam === 'round' ? 'round' : 'solo');

    // TICKET-043: Table selection is now multi-select (selectedTableIds: string[]).
    // Default: pre-select from URL param if provided. Empty = feed-only (private journal).
    // Round mode is single-Table and stays that way; we expose selectedTableIds[0] to it.
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>(
        tableIdParam ? [tableIdParam] : []
    );
    const [tablePickerVisible, setTablePickerVisible] = useState(false);

    // For round mode, maintain a single effective table id (first selected, or first sorted).
    const roundTableId = selectedTableIds[0] ?? (sortedTables[0]?.id ?? null);

    // Round mode requires a table — auto-select first if user arrived with none picked.
    useEffect(() => {
        if (postMode === 'round' && selectedTableIds.length === 0 && sortedTables.length > 0) {
            setSelectedTableIds([sortedTables[0].id]);
        }
    }, [postMode, selectedTableIds.length, sortedTables]);

    // Participant tagging (Round mode on group tables)
    const { data: tableMembers, isLoading: membersLoading } = useTableMembers(
        postMode === 'round' ? roundTableId : null
    );
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        setSelectedParticipantIds(new Set());
    }, [selectedTableIds, postMode]);

    // TICKET-043: pass onTableNotAuthorized to handle revoked-Table 403.
    const createEntry = useCreateEntry(user?.id, null, {
        onTableNotAuthorized: (offendingIds) => {
            // Remove offending ids from selection so user can re-submit without them.
            setSelectedTableIds(prev => prev.filter(id => !offendingIds.includes(id)));
        },
    });
    const startRound = useStartRound(user?.id, roundTableId);

    // ── Prefill from route params ─────────────────────────────────────────────
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
                    photoAttributionHtml: p.photoAttributionHtml ?? null,
                };
            } catch {
                return null;
            }
        }
        return null;
    }, [placePayloadParam]);

    const [query, setQuery] = useState(prefillPlace?.name ?? '');
    const [results, setResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(prefillPlace);
    const [showSearch, setShowSearch] = useState(!prefillPlace && !restaurantIdParam);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (prefillPlace && !selectedPlace) {
            setSelectedPlace(prefillPlace);
            setQuery(prefillPlace.name);
            setShowSearch(false);
        }
    }, [prefillPlace]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    photoAttributionHtml: null,
                };
                setSelectedPlace(place);
                setQuery(place.name);
                setShowSearch(false);
            } catch {
                setSelectedPlace({
                    id: restaurantIdParam,
                    name: '',
                    formattedAddress: null,
                    latitude: null,
                    longitude: null,
                    categories: [],
                    photoReference: null,
                    photoAttributionHtml: null,
                });
                setShowSearch(false);
            }
        })();
    }, [restaurantIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

    // Impression form state
    const [rating, setRating] = useState(Number(ratingParam) || 0);
    const [notes, setNotes] = useState('');

    // Breakdown ratings (inside drawer)
    const [breakdown, setBreakdown] = useState({ vibe: 0, flavor: 0, service: 0, value: 0 });
    const handleBreakdownChange = (key: keyof typeof breakdown, value: number) => {
        setBreakdown(prev => ({ ...prev, [key]: value }));
    };

    // Dish (inside drawer)
    const [dish, setDish] = useState('');

    // visited_at state — prefilled from `visitedAt` route param (ISO) or defaults to now
    const [visitedAt, setVisitedAt] = useState<Date>(() => {
        if (visitedAtParam) {
            const d = new Date(visitedAtParam);
            if (!isNaN(d.getTime())) return d;
        }
        return new Date();
    });

    // Multi-photo upload state
    const [photos, setPhotos] = useState<PhotoSlot[]>([]);
    const uploadGenRefs = useRef(new Map<string, number>());

    // Companion tagging state
    const [selectedCompanions, setSelectedCompanions] = useState<UserSearchResult[]>([]);
    const [companionSheetVisible, setCompanionSheetVisible] = useState(false);

    // Dish picker sheet — we show the drawer inline via the chip tap
    const [dishSheetVisible, setDishSheetVisible] = useState(false);

    const toggleCompanion = useCallback((u: UserSearchResult) => {
        if (!user || u.user_id === user.id) return;
        setSelectedCompanions(prev => {
            const exists = prev.some(c => c.user_id === u.user_id);
            if (exists) return prev.filter(c => c.user_id !== u.user_id);
            return [...prev, u];
        });
    }, [user]);

    const removeCompanion = useCallback((userId: string) => {
        setSelectedCompanions(prev => prev.filter(c => c.user_id !== userId));
    }, []);

    const canSubmit = (selectedPlace !== null || query.trim().length > 0) && rating > 0 && !photos.some(p => p.uploading);
    const isSubmitting = createEntry.isPending || startRound.isPending;

    // Device location for search bias
    const [deviceLocation, setDeviceLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setDeviceLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        })();
    }, []);

    // Debounced search
    useEffect(() => {
        if (selectedPlace) return;
        if (!showSearch) return;
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => searchPlaces(query.trim()), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, selectedPlace, showSearch]);

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
        setShowSearch(false);
    };

    const handleClearPlace = () => {
        setSelectedPlace(null);
        setQuery('');
        setResults([]);
        setShowSearch(true);
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

    const photosRef = useRef(photos);
    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);

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
        const gen = (uploadGenRefs.current.get(slotId) ?? 0) + 1;
        uploadGenRefs.current.set(slotId, gen);

        setPhotos(prev => prev.map(s => s.id === slotId
            ? { ...s, uploading: true, error: null }
            : s
        ));

        try {
            const url = await compressAndUpload(uri, user.id);
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
            setTimeout(() => startUploadForSlot(slotId, uri), 0);
            return [...prev, newSlot];
        });
    }, [startUploadForSlot]);

    const handleRemovePhoto = useCallback((slotId: string) => {
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
            addPhotoSlot(result.assets[0].uri);
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
                // TICKET-057: pair every photoReference with attribution; missing → sentinel.
                photoAttributionHtml: selectedPlace.photoAttributionHtml,
            }
            : {
                external_id: `manual-${query.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
                name: query.trim(),
                types: ['restaurant'] as string[],
            };

        const secondaryRatings = {
            vibe_rating: breakdown.vibe > 0 ? breakdown.vibe : null,
            flavor_rating: breakdown.flavor > 0 ? breakdown.flavor : null,
            service_rating: breakdown.service > 0 ? breakdown.service : null,
            value_rating: breakdown.value > 0 ? breakdown.value : null,
        };

        const ratingValue = Math.round(rating * 2) / 2;
        const photoUrls = photos.filter(p => p.publicUrl !== null).map(p => p.publicUrl as string);

        try {
            if (postMode === 'round') {
                await startRound.mutateAsync({
                    table_id: roundTableId!,
                    restaurant: restaurantData,
                    participant_ids: Array.from(selectedParticipantIds),
                    rating: ratingValue,
                    notes: notes.trim() || undefined,
                    dish_description: dish.trim() || undefined,
                    ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
                    ...secondaryRatings,
                });
            } else {
                // TICKET-043: send table_ids (multi-Table) instead of single table_id.
                await createEntry.mutateAsync({
                    restaurant: restaurantData,
                    rating: ratingValue,
                    content: notes.trim() || undefined,
                    dish_description: dish.trim() || undefined,
                    table_ids: selectedTableIds,
                    visibility: selectedTableIds.length > 0 ? 'table' : 'private',
                    visited_at: visitedAt.toISOString(),
                    ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
                    ...(selectedCompanions.length > 0 ? {
                        companion_ids: selectedCompanions.map(c => c.user_id),
                    } : {}),
                    ...secondaryRatings,
                });
            }
            setPhotos([]);
            router.back();
        } catch (e: any) {
            // table_not_authorized errors are handled by onTableNotAuthorized callback
            // (already shows toast and removes offending ids). Only show Alert for
            // other failures.
            if ((e as any)?.code !== 'table_not_authorized') {
                Alert.alert('Error', e.message ?? 'Could not save entry');
            }
        }
    }, [
        canSubmit, rating, notes, dish, selectedPlace, query,
        selectedTableIds, roundTableId, postMode, selectedParticipantIds,
        breakdown, visitedAt, photos, selectedCompanions,
        createEntry, startRound, router,
    ]);

    // ── Submit label ──────────────────────────────────────────────────────

    // TICKET-043: Share when ≥1 Table selected; Save when feed-only (0 tables).
    const submitLabel = postMode === 'round'
        ? 'Start Round'
        : selectedTableIds.length > 0
            ? 'Share'
            : 'Save';

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
                        title="a new entry"
                        leftLabel="Cancel"
                        rightLabel={canSubmit ? submitLabel : submitLabel}
                        onLeftPress={() => router.back()}
                        onRightPress={handleSubmit}
                        rightDisabled={!canSubmit}
                        rightPending={isSubmitting}
                    />
                </View>
                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingBottom: insets.bottom + 120 },
                    ]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Restaurant search / masthead */}
                    {showSearch ? (
                        <View style={styles.searchBlock}>
                            <View style={{ position: 'relative' }}>
                                <FieldUnderline
                                    value={query}
                                    onChangeText={setQuery}
                                    placeholder="Where did you eat?"
                                    fontVariant="serifItalic"
                                    size="display"
                                    autoFocus={!restaurantIdParam && !placePayloadParam}
                                />
                                {searching ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={palette.textMuted}
                                        style={{ position: 'absolute', right: 4, top: 14 }}
                                    />
                                ) : null}
                            </View>
                            {results.length > 0 ? (
                                <View style={[styles.dropdown, { backgroundColor: palette.surfaceContainerLow, ...Shadow.subtle }]}>
                                    {results.map((place, i) => (
                                        <Pressable
                                            key={place.id}
                                            onPress={() => handleSelectPlace(place)}
                                            style={({ pressed }) => [
                                                styles.dropdownRow,
                                                {
                                                    backgroundColor: pressed ? palette.surfaceContainerHigh : 'transparent',
                                                    borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                                                    borderTopColor: palette.surfaceContainerHigh,
                                                },
                                            ]}
                                        >
                                            <Text style={[Type.body, { color: palette.text, fontFamily: 'Manrope_500Medium' }]} numberOfLines={1}>
                                                {place.name}
                                            </Text>
                                            {place.formattedAddress ? (
                                                <Text style={[Type.caption, { color: palette.textSecondary, marginTop: 1 }]} numberOfLines={1}>
                                                    {place.formattedAddress}
                                                </Text>
                                            ) : null}
                                        </Pressable>
                                    ))}
                                </View>
                            ) : null}
                            {query.trim().length >= 2 && results.length === 0 && !searching ? (
                                <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                                    no results — you can still submit with this name
                                </Text>
                            ) : null}
                        </View>
                    ) : (
                        /* Composer masthead — restaurant name + inline stars */
                        selectedPlace ? (
                            <ComposerMasthead
                                restaurantName={selectedPlace.name}
                                rating={rating}
                                onRatingChange={setRating}
                                onClearPlace={handleClearPlace}
                            />
                        ) : null
                    )}

                    {/* Writing surface — the hero, ≥55% viewport */}
                    {!showSearch ? (
                        <WritingSurface
                            value={notes}
                            onChangeText={setNotes}
                        />
                    ) : null}

                    {/* Chip row — photos / dish / with… / today / tables… */}
                    {!showSearch ? (
                        <View style={[styles.chipRowContainer, { borderTopColor: 'rgba(221,192,186,0.25)' }]}>
                            <ChipRow
                                photoCount={photos.filter(p => p.publicUrl).length}
                                onPhotosPress={handlePhotoPress}
                                dishValue={dish}
                                onDishPress={() => {/* handled in drawer */}}
                                companionCount={selectedCompanions.length}
                                onCompanionsPress={() => setCompanionSheetVisible(true)}
                                visitedAt={visitedAt}
                                onDateChange={setVisitedAt}
                                tablesAvailable={sortedTables.length > 0 && postMode !== 'round'}
                                selectedTableName={
                                    // TICKET-043: show first selected table name + overflow count.
                                    selectedTableIds.length > 0
                                        ? selectedTableIds.length === 1
                                            ? sortedTables.find(t => t.id === selectedTableIds[0])?.name ?? null
                                            : `${sortedTables.find(t => t.id === selectedTableIds[0])?.name ?? ''} +${selectedTableIds.length - 1}`
                                        : null
                                }
                                onTablesPress={() => setTablePickerVisible(true)}
                            />
                        </View>
                    ) : null}

                    {/* TICKET-043: TableChipsRow — Smart-three inline chip preview.
                        Hidden in round mode (single-Table read-only context). */}
                    {!showSearch && postMode !== 'round' && orderedTables.length > 0 ? (
                        <TableChipsRow
                            orderedTables={orderedTables.map(t => ({ id: t.id, name: t.name }))}
                            selectedIds={selectedTableIds}
                            onToggle={(id) =>
                                setSelectedTableIds(prev =>
                                    prev.includes(id)
                                        ? prev.filter(x => x !== id)
                                        : [...prev, id]
                                )
                            }
                            onOpenSheet={() => setTablePickerVisible(true)}
                        />
                    ) : null}

                    {/* Photo collage — visible when photos exist */}
                    {photos.length > 0 ? (
                        <View style={{ marginTop: Spacing.md }}>
                            <PhotoCollage
                                photos={photos}
                                maxPhotos={MAX_PHOTOS}
                                onAdd={handlePhotoPress}
                                onRemove={handleRemovePhoto}
                                onRetry={handleRetryPhoto}
                            />
                        </View>
                    ) : null}

                    {/* Companion chips (when companions selected) */}
                    {selectedCompanions.length > 0 ? (
                        <View style={{ marginTop: Spacing.sm }}>
                            <CompanionChipsRow
                                companions={selectedCompanions.map(c => ({
                                    user_id: c.user_id,
                                    display_name: c.display_name,
                                }))}
                                onRemove={removeCompanion}
                            />
                        </View>
                    ) : null}

                    {/* Add details drawer — breakdown ratings + dish */}
                    {!showSearch ? (
                        <AddDetailsDrawer
                            breakdown={breakdown}
                            onBreakdownChange={handleBreakdownChange}
                            dish={dish}
                            onDishChange={setDish}
                        />
                    ) : null}

                    {/* Round mode attendee picker (when round mode active) */}
                    {postMode === 'round' && roundTableId ? (
                        <View style={{ marginTop: Spacing.lg }}>
                            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                WHO WAS THERE?
                            </Text>
                            {membersLoading ? (
                                <ActivityIndicator size="small" color={palette.textMuted} />
                            ) : tableMembers && tableMembers.filter(m => m.member_id !== user?.id).length > 0 ? (
                                <View style={styles.participantGrid}>
                                    {tableMembers.map((member) => {
                                        const isCreator = member.member_id === user?.id;
                                        const isSelected = isCreator || selectedParticipantIds.has(member.member_id);
                                        const displayName = member.profiles?.display_name ?? 'Member';
                                        const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                                        return (
                                            <Pressable
                                                key={member.member_id}
                                                onPress={() => toggleParticipant(member.member_id)}
                                                disabled={isCreator}
                                                style={[styles.participantChip, { backgroundColor: isSelected ? palette.primary : palette.surfaceContainerLow }]}
                                            >
                                                <View style={[styles.participantAvatar, { backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : palette.surfaceContainerHigh }]}>
                                                    <Text style={{ fontSize: 11, color: isSelected ? palette.textInverse : palette.text, fontFamily: 'Manrope_600SemiBold' }}>
                                                        {initials}
                                                    </Text>
                                                </View>
                                                <Text style={[Type.caption, { color: isSelected ? palette.textInverse : palette.text, maxWidth: 60 }]} numberOfLines={1}>
                                                    {displayName.split(' ')[0]}{isCreator ? ' (you)' : ''}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ) : null}
                        </View>
                    ) : null}

                    {/* Primary CTA */}
                    <Pressable
                        disabled={!canSubmit || isSubmitting}
                        onPress={handleSubmit}
                        style={({ pressed }) => [
                            styles.ctaButton,
                            {
                                backgroundColor: canSubmit ? palette.primary : palette.surfaceContainerHigh,
                                opacity: pressed ? 0.85 : isSubmitting ? 0.6 : 1,
                            },
                        ]}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color={palette.textInverse} />
                        ) : (
                            <Text style={[Type.label, { color: canSubmit ? palette.textInverse : palette.textMuted, letterSpacing: 1.5 }]}>
                                {submitLabel}
                            </Text>
                        )}
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>

            <CompanionPickerSheet
                visible={companionSheetVisible}
                onClose={() => setCompanionSheetVisible(false)}
                selectedIds={new Set(selectedCompanions.map(c => c.user_id))}
                onToggle={toggleCompanion}
                currentUserId={user?.id}
                palette={palette}
            />

            {/* TICKET-043: multi-select TablePickerSheet — commits on Done/dismiss */}
            <TablePickerSheet
                visible={tablePickerVisible}
                tables={sortedTables.map(t => ({ id: t.id, name: t.name }))}
                selectedIds={selectedTableIds}
                onCommit={(ids) => {
                    setSelectedTableIds(ids);
                    setTablePickerVisible(false);
                }}
                palette={palette}
                isLoading={tablesLoading}
                loadError={null}
                onRetryLoad={() => refetchTables()}
            />
        </>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: Spacing.lg + 2,
        paddingTop: Spacing.md,
    },
    searchBlock: {
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
    chipRowContainer: {
        borderTopWidth: 1,
    },
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
    ctaButton: {
        height: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xl,
    },
});
