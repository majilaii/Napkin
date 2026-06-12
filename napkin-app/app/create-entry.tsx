/**
 * Create Entry — Heirloom Journal composer (TICKET-064 redesign).
 *
 * Canvas section order (logger-canvas.jsx Fast Log grammar):
 *   SheetHeader → ComposerMasthead (RestaurantHeader) → RatingBand
 *   → PhotoStrip → WritingSurface → with/companions + date
 *   → TableRowChecklist → AddDetailsDrawer → round-attendee picker
 *   → in-flow merge card → primary CTA
 *
 * Route: /create-entry (unchanged — all six router.push call sites untouched)
 * Submit labels: Save (solo) / Share (Table share ON) / Start Round (round mode).
 * Success toast: "tried <name>" (brand grammar, lowercase past-tense).
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
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
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

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
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { compressAndUpload, removeUploadedPhoto, PhotoUploadError } from '@/lib/imageUpload';
import { collectOrphanedBlobUrls } from '@/lib/photoCleanup';
import { CompanionChipsRow, CompanionPickerSheet } from '@/components/logging';
import { CalendarModal } from '@/components/log/CalendarModal';
import {
    ComposerMasthead,
    WritingSurface,
    AddDetailsDrawer,
    TablePickerSheet,
    RatingBand,
    PhotoStrip,
    TableRowChecklist,
} from '@/components/create-entry';
import { MergeCandidateCard } from '@/components/create-entry/MergeCandidateCard';
import { useMergeCandidate } from '@/hooks/rounds/useMergeCandidate';
import { useCreateEntryWithMerge } from '@/hooks/rounds/useCreateEntryWithMerge';
import { useToast } from '@/providers/ToastProvider';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';
import { safeRandomUUID } from '@/lib/uuid';
import { buildEntryPayload, buildRoundPayload, toggleTableId } from '@/lib/composer';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';

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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Lowercase "today · sat 7 jun" / "sat 7 jun" date label for the WHEN row. */
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

// ── Screen ────────────────────────────────────────────────────────────────

export default function CreateEntryScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user, signOut } = useAuth();

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

    // Mode — derived from param, no setter needed (setPostMode was never called)
    const postMode: PostMode = modeParam === 'round' ? 'round' : 'solo';

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
            setSelectedTableIds(prev => prev.filter(id => !offendingIds.includes(id)));
        },
    });
    const startRound = useStartRound(user?.id, roundTableId);
    // TICKET-044: combined merge mutation for the in-flow [merge] action.
    const createEntryWithMerge = useCreateEntryWithMerge();
    const toast = useToast();

    // TICKET-075: route a refreshed-and-still-401 session expiry to re-auth.
    const handleSessionExpired = useCallback(async () => {
        toast.show('your session expired — sign in again');
        try { await signOut(); } catch { /* noop */ }
        router.replace('/auth');
    }, [toast, signOut, router]);

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
    // TICKET-075: Letterboxd-style like — independent of the rating value.
    const [liked, setLiked] = useState(false);
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
    // TICKET-078: calendar lives in a bottom-sheet Modal overlay (no layout shift).
    const [calendarVisible, setCalendarVisible] = useState(false);
    const handleCalendarChange = useCallback(
        (event: DateTimePickerEvent, selected?: Date) => {
            // Android's 'calendar' display is itself a system dialog — close the
            // wrapping modal on any Android result. iOS inline stays open until done.
            if (Platform.OS === 'android') setCalendarVisible(false);
            if (event.type === 'dismissed' || !selected) return;
            setVisitedAt((prev) => {
                const next = new Date(selected);
                next.setHours(prev.getHours(), prev.getMinutes(), prev.getSeconds(), prev.getMilliseconds());
                const now = new Date();
                return next.getTime() > now.getTime() ? now : next;
            });
        },
        [],
    );

    // ── TICKET-044: merge-candidate detection (Trigger B) ────────────────────
    const mergeTableId = selectedTableIds.length === 1 ? selectedTableIds[0] : null;
    const mergeRestaurantId = restaurantIdParam ?? null;
    const visitedAtIso = visitedAt.toISOString();
    const { data: mergeCandidate } = useMergeCandidate(
        mergeTableId,
        mergeRestaurantId,
        visitedAtIso,
    );
    const [separatedCandidateId, setSeparatedCandidateId] = useState<string | null>(null);
    const showMergeCard =
        !!mergeCandidate &&
        mergeCandidate.entry_id !== separatedCandidateId &&
        !!mergeTableId &&
        !!mergeRestaurantId;
    // Stable nonce for the merge mutation; regenerated only when the candidate changes.
    const mergeNonceRef = useRef<string | null>(null);
    useEffect(() => {
        if (mergeCandidate?.entry_id) {
            mergeNonceRef.current = safeRandomUUID();
        }
    }, [mergeCandidate?.entry_id]);

    // Multi-photo upload state
    const [photos, setPhotos] = useState<PhotoSlot[]>([]);
    const uploadGenRefs = useRef(new Map<string, number>());

    // Companion tagging state
    const [selectedCompanions, setSelectedCompanions] = useState<UserSearchResult[]>([]);
    const [companionSheetVisible, setCompanionSheetVisible] = useState(false);

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
    const isSubmitting = createEntry.isPending || startRound.isPending || createEntryWithMerge.isPending;

    // Device location for search bias.
    // Use getLastKnownPositionAsync() first — returns instantly so the very first
    // search has location bias.
    const [deviceLocation, setDeviceLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getLastKnownPositionAsync() ??
                    await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                if (loc) setDeviceLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            } catch {
                // Location unavailable — search works fine without bias
            }
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
                    ...(deviceLocation && {
                        latitude: deviceLocation.latitude,
                        longitude: deviceLocation.longitude,
                        radius: 10000,
                    }),
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

    // Gates the unmount cleanup: a successful save means every blob belongs to
    // the entry and must NOT be deleted. Explicit flag, not the setPhotos([])
    // race (see lib/photoCleanup.ts / TICKET-071 regression).
    const savedRef = useRef(false);

    useEffect(() => {
        return () => {
            for (const url of collectOrphanedBlobUrls(photosRef.current, savedRef.current)) {
                removeUploadedPhoto(url).catch(() => {});
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

    // ── TICKET-044: merge handler ─────────────────────────────────────────────

    const handleMerge = useCallback(async () => {
        if (!canSubmit) return;
        if (!mergeCandidate || !mergeTableId || !mergeRestaurantId) return;
        if (!user?.id) return;

        const restaurantData = selectedPlace
            ? {
                external_id: selectedPlace.id,
                name: selectedPlace.name,
                location: selectedPlace.formattedAddress
                    ? { address: selectedPlace.formattedAddress }
                    : undefined,
                latitude: selectedPlace.latitude ?? undefined,
                longitude: selectedPlace.longitude ?? undefined,
                photoReference: selectedPlace.photoReference ?? undefined,
                photoAttributionHtml: selectedPlace.photoAttributionHtml,
            }
            : null;

        const ratingValue = Math.round(rating * 2) / 2;
        const photoUrls = photos.filter(p => p.publicUrl !== null).map(p => p.publicUrl as string);
        const nonce = mergeNonceRef.current ?? safeRandomUUID();

        try {
            const result = await createEntryWithMerge.mutateAsync({
                entry_a_id: mergeCandidate.entry_id,
                table_id: mergeTableId,
                restaurant_id: mergeRestaurantId,
                visited_at: visitedAt.toISOString(),
                client_nonce: nonce,
                rating: ratingValue,
                content: notes.trim() || null,
                dish_description: dish.trim() || null,
                ...(photoUrls.length > 0 ? { photo_urls: photoUrls } : {}),
                ...(restaurantData ? { restaurant: restaurantData } : {}),
            });
            if (result.merge_outcome === 'merged') {
                toast.show('became a round.');
            }
            savedRef.current = true;
            setPhotos([]);
            router.back();
        } catch (e: any) {
            const code = (e as any)?.cause?.code ?? (e as any)?.code;
            if (code === 'session_expired') {
                handleSessionExpired();
                return;
            }
            Alert.alert('Error', e?.message ?? 'Could not save entry');
        }
    }, [
        canSubmit, mergeCandidate, mergeTableId, mergeRestaurantId, user?.id,
        selectedPlace, rating, photos, notes, dish, visitedAt,
        createEntryWithMerge, toast, router, handleSessionExpired,
    ]);

    const handleSeparate = useCallback(() => {
        if (mergeCandidate?.entry_id) {
            setSeparatedCandidateId(mergeCandidate.entry_id);
        }
    }, [mergeCandidate?.entry_id]);

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

        // Post-save confirmation verb (brand grammar: "tried <name>" for rated logs)
        const restaurantLabel = selectedPlace?.name ?? query.trim();

        try {
            if (postMode === 'round') {
                // Frozen payload shape lives in lib/composer.ts (jest-covered).
                await startRound.mutateAsync({
                    table_id: roundTableId!,
                    restaurant: restaurantData,
                    ...buildRoundPayload({
                        rating, notes, dish, photos, breakdown,
                        selectedParticipantIds: Array.from(selectedParticipantIds),
                    }),
                });
            } else {
                // TICKET-043: table_ids (multi-Table). Frozen shape in lib/composer.ts.
                await createEntry.mutateAsync({
                    restaurant: restaurantData,
                    ...buildEntryPayload({
                        rating, notes, dish, photos, breakdown,
                        selectedTableIds, visitedAt, selectedCompanions, liked,
                    }),
                });
            }
            savedRef.current = true;
            setPhotos([]);
            // Post-save toast: brand grammar lowercase past-tense
            if (restaurantLabel) {
                toast.show(`tried ${restaurantLabel}`);
            }
            router.back();
        } catch (e: any) {
            const code = (e as any)?.cause?.code ?? (e as any)?.code;
            if (code === 'session_expired') {
                handleSessionExpired();
                return;
            }
            // table_not_authorized errors are handled by onTableNotAuthorized callback.
            if (code !== 'table_not_authorized') {
                Alert.alert('Error', e.message ?? 'Could not save entry');
            }
        }
    }, [
        canSubmit, rating, notes, dish, liked, selectedPlace, query,
        selectedTableIds, roundTableId, postMode, selectedParticipantIds,
        breakdown, visitedAt, photos, selectedCompanions,
        createEntry, startRound, toast, router, handleSessionExpired,
    ]);

    // ── Submit label ──────────────────────────────────────────────────────

    // TICKET-043: Share when ≥1 Table selected; Save when feed-only (0 tables).
    const submitLabel = postMode === 'round'
        ? 'Start Round'
        : selectedTableIds.length > 0
            ? 'Share'
            : 'Save';

    // ── Derived masthead data ─────────────────────────────────────────────

    const mastheadMeta = React.useMemo(() => {
        if (!selectedPlace) return undefined;
        return selectedPlace.categories.slice(0, 2).filter(Boolean).join(' · ') || undefined;
    }, [selectedPlace]);

    const mastheadThumbnail = React.useMemo(() => {
        if (!selectedPlace?.photoReference) return null;
        return placesPhotoProxyUrl(selectedPlace.photoReference, { width: 96 });
    }, [selectedPlace?.photoReference]);

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
                        rightLabel={submitLabel}
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
                    {/* SECTION 1: Restaurant search OR ComposerMasthead */}
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
                    ) : selectedPlace ? (
                        <ComposerMasthead
                            restaurantName={selectedPlace.name}
                            meta={mastheadMeta}
                            thumbnailUri={mastheadThumbnail}
                            onClearPlace={handleClearPlace}
                        />
                    ) : null}

                    {/* SECTION 2: Rating band + inline like heart (TICKET-075).
                        The like heart is solo-only in v1: neither the round path
                        (buildRoundPayload/StartRound) nor the merge path
                        (handleMerge/CreateEntryWithMergeInput) carries `liked`, so
                        showing it there would let a user heart and silently lose it.
                        Hidden in round mode and when a merge candidate is active —
                        same solo-only gate as the Table checklist. */}
                    {!showSearch ? (
                        <View style={[styles.sectionDivider, styles.ratingRow, { borderTopColor: palette.divider }]}>
                            <RatingBand
                                rating={rating}
                                onRatingChange={setRating}
                            />
                            {postMode !== 'round' && !showMergeCard ? (
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
                            ) : null}
                        </View>
                    ) : null}

                    {/* SECTION 3: Photo strip — always visible (kills "invisible photos" bug) */}
                    {!showSearch ? (
                        <PhotoStrip
                            photos={photos}
                            maxPhotos={MAX_PHOTOS}
                            onAdd={handlePhotoPress}
                            onRemove={handleRemovePhoto}
                            onRetry={handleRetryPhoto}
                        />
                    ) : null}

                    {/* SECTION 4: Writing surface */}
                    {!showSearch ? (
                        <WritingSurface
                            value={notes}
                            onChangeText={setNotes}
                        />
                    ) : null}

                    {/* SECTION 5: with/companions + date row */}
                    {!showSearch ? (
                        <>
                            <View style={[styles.withRow, { borderTopColor: palette.divider }]}>
                                <Pressable
                                    onPress={() => setCompanionSheetVisible(true)}
                                    style={[
                                        styles.withChip,
                                        { borderColor: palette.divider },
                                    ]}
                                    accessibilityLabel={
                                        selectedCompanions.length > 0
                                            ? `${selectedCompanions.length} companion${selectedCompanions.length !== 1 ? 's' : ''}`
                                            : 'Add companions'
                                    }
                                >
                                    <Ionicons
                                        name="person-add-outline"
                                        size={13}
                                        color={selectedCompanions.length > 0 ? palette.primary : palette.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            styles.withChipLabel,
                                            {
                                                color: selectedCompanions.length > 0
                                                    ? palette.primary
                                                    : palette.textSecondary,
                                            },
                                        ]}
                                    >
                                        {selectedCompanions.length > 0
                                            ? `with ${selectedCompanions.length}`
                                            : 'with…'}
                                    </Text>
                                </Pressable>
                                <View style={{ flex: 1 }} />
                                {/* TICKET-078: tap opens the calendar in a modal overlay (no layout shift) */}
                                <Pressable
                                    onPress={() => setCalendarVisible(true)}
                                    style={[styles.withChip, { borderColor: palette.divider }]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`when: ${formatWhenLabel(visitedAt)}. tap to change.`}
                                >
                                    <Ionicons name="calendar-outline" size={13} color={palette.textSecondary} />
                                    <Text style={[styles.withChipLabel, { color: palette.textSecondary }]}>
                                        {formatWhenLabel(visitedAt)}
                                    </Text>
                                </Pressable>
                            </View>
                            {selectedCompanions.length > 0 ? (
                                <View style={styles.companionsRow}>
                                    <CompanionChipsRow
                                        companions={selectedCompanions.map(c => ({
                                            user_id: c.user_id,
                                            display_name: c.display_name,
                                        }))}
                                        onRemove={removeCompanion}
                                    />
                                </View>
                            ) : null}
                        </>
                    ) : null}

                    {/* SECTION 6: Table row-checklist
                        Hidden in round mode (single-Table read-only context).
                        Zero-table users see nothing (TableRowChecklist returns null). */}
                    {!showSearch && postMode !== 'round' && orderedTables.length > 0 ? (
                        <View style={[styles.sectionBlock, { borderTopColor: palette.divider }]}>
                            <TableRowChecklist
                                tables={orderedTables.map(t => ({
                                    id: t.id,
                                    name: t.name,
                                }))}
                                selectedIds={selectedTableIds}
                                onToggle={(id) =>
                                    setSelectedTableIds(prev => toggleTableId(prev, id))
                                }
                                onOpenOverflow={
                                    orderedTables.length > 5
                                        ? () => setTablePickerVisible(true)
                                        : undefined
                                }
                            />
                        </View>
                    ) : null}

                    {/* SECTION 7: Add details drawer (sub-scores + dish) */}
                    {!showSearch ? (
                        <AddDetailsDrawer
                            breakdown={breakdown}
                            onBreakdownChange={handleBreakdownChange}
                            dish={dish}
                            onDishChange={setDish}
                        />
                    ) : null}

                    {/* SECTION 8: Round mode attendee picker */}
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
                                                style={[
                                                    styles.participantChip,
                                                    { backgroundColor: isSelected ? palette.primary : palette.surfaceContainerLow },
                                                ]}
                                            >
                                                <View style={[
                                                    styles.participantAvatar,
                                                    { backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : palette.surfaceContainerHigh },
                                                ]}>
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

                    {/* SECTION 9: In-flow merge card (TICKET-044, Trigger B).
                        Only when restaurant_id + visited_at + single Table set. */}
                    {!showSearch && postMode !== 'round' && showMergeCard && mergeCandidate ? (
                        <View style={{ marginTop: Spacing.lg }}>
                            <MergeCandidateCard
                                candidate={mergeCandidate}
                                onMerge={handleMerge}
                                onSeparate={handleSeparate}
                                loading={isSubmitting}
                                palette={palette}
                            />
                        </View>
                    ) : null}

                    {/* SECTION 10: Primary CTA */}
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

            {/* TICKET-043: multi-select TablePickerSheet — overflow/search for >5 tables */}
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

            {/* Calendar — bottom-sheet overlay (floats over the body, no shift) */}
            <CalendarModal
                visible={calendarVisible}
                value={visitedAt}
                onChange={handleCalendarChange}
                onClose={() => setCalendarVisible(false)}
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
    // Sections with a ghosted warm top-rule (no solid 1px borders)
    sectionDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    // TICKET-075: rating band + like heart on one row
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    likeToggle: {
        padding: 2,
        marginLeft: Spacing.sm,
    },
    sectionBlock: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: Spacing.md,
        marginTop: Spacing.sm,
    },
    // with/companions + date row
    withRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: Spacing.xs,
    },
    withChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        borderWidth: 1,
    },
    withChipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        fontWeight: '500',
    },
    companionsRow: {
        marginTop: Spacing.xs,
        marginBottom: Spacing.xs,
    },
    // Round mode participant picker
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
    // Primary CTA
    ctaButton: {
        height: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xl,
    },
});
