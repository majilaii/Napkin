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
    Image,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useStartRound } from '@/hooks/tables/useStartRound';
import { StarRating } from '@/components/StarRating';
import { supabase } from '@/lib/supabase';
import { compressAndUpload, removeUploadedPhoto, PhotoUploadError } from '@/lib/imageUpload';

// ── Types ─────────────────────────────────────────────────────────────────

type PostMode = 'solo' | 'round';

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

    const { tableId: tableIdParam } = useLocalSearchParams<{ tableId: string }>();

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
    const [postMode, setPostMode] = useState<PostMode>('solo');

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

    // Search state
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Impression form state
    const [rating, setRating] = useState(0);
    const [vibeRating, setVibeRating] = useState(0);
    const [flavorRating, setFlavorRating] = useState(0);
    const [serviceRating, setServiceRating] = useState(0);
    const [valueRating, setValueRating] = useState(0);
    const [showDetails, setShowDetails] = useState(false);
    const [notes, setNotes] = useState('');
    const [dish, setDish] = useState('');

    // Photo upload state
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [photoPublicUrl, setPhotoPublicUrl] = useState<string | null>(null);
    const [photoUploading, setPhotoUploading] = useState(false);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const photoPublicUrlRef = useRef<string | null>(null);
    const uploadGenRef = useRef(0);

    const canSubmit = (selectedPlace !== null || query.trim().length > 0) && rating > 0 && !photoUploading;
    const isSubmitting = createEntry.isPending || startRound.isPending;

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
                body: { query: q, limit: 5 },
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

    // Keep ref in sync so cleanup always has the current URL
    useEffect(() => {
        photoPublicUrlRef.current = photoPublicUrl;
    }, [photoPublicUrl]);

    // Clean up orphaned upload if user exits without submitting
    useEffect(() => {
        return () => {
            if (photoPublicUrlRef.current) {
                removeUploadedPhoto(photoPublicUrlRef.current).catch(() => {});
            }
        };
    }, []);

    const uploadPhoto = async (uri: string) => {
        if (!user?.id) return;
        const gen = ++uploadGenRef.current;
        setPhotoUploading(true);
        setPhotoError(null);
        try {
            const url = await compressAndUpload(uri, user.id);
            // Stale upload — user dismissed photo before this completed
            if (gen !== uploadGenRef.current) {
                removeUploadedPhoto(url).catch(() => {});
                return;
            }
            setPhotoPublicUrl(url);
        } catch (err) {
            if (gen !== uploadGenRef.current) return;
            if (err instanceof PhotoUploadError) {
                if (err.code === 'too_large') {
                    setPhotoError('Photo is too large. Please choose a smaller image.');
                } else {
                    setPhotoError('Upload failed. Tap to retry.');
                }
            } else {
                setPhotoError('Upload failed. Tap to retry.');
            }
            setPhotoPublicUrl(null);
        } finally {
            if (gen === uploadGenRef.current) {
                setPhotoUploading(false);
            }
        }
    };

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
            const uri = result.assets[0].uri;
            setPhotoUri(uri);
            setPhotoPublicUrl(null);
            setPhotoError(null);
            await uploadPhoto(uri);
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
            const uri = result.assets[0].uri;
            setPhotoUri(uri);
            setPhotoPublicUrl(null);
            setPhotoError(null);
            await uploadPhoto(uri);
        }
    };

    const handleRemovePhoto = async () => {
        // Invalidate any in-flight upload so its callback becomes a no-op
        uploadGenRef.current++;
        if (photoPublicUrl) {
            removeUploadedPhoto(photoPublicUrl).catch(() => {});
        }
        setPhotoUri(null);
        setPhotoPublicUrl(null);
        setPhotoUploading(false);
        setPhotoError(null);
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
                    ...(photoPublicUrl ? { photo_url: photoPublicUrl } : {}),
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
                    ...(photoPublicUrl ? { photo_url: photoPublicUrl } : {}),
                    ...secondaryRatings,
                });
            }
            // Photo is now persisted — clear so the cleanup effect doesn't delete it
            setPhotoPublicUrl(null);
            photoPublicUrlRef.current = null;
            router.back();
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not save entry');
        }
    }, [
        canSubmit, rating, notes, dish, selectedPlace, query,
        selectedTableId, isPersonalTable, postMode, selectedParticipantIds,
        vibeRating, flavorRating, serviceRating, valueRating,
        photoPublicUrl,
        createEntry, startRound, router,
    ]);

    // ── Submit label ──────────────────────────────────────────────────────

    const submitLabel = isPersonalTable
        ? 'LOG IT'
        : postMode === 'round'
            ? 'START THE ROUND'
            : 'SHARE';

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: palette.background }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    contentContainerStyle={{
                        paddingTop: insets.top + Spacing.md,
                        paddingBottom: insets.bottom + 120,
                        paddingHorizontal: Spacing.lg,
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
                                        autoFocus
                                    />
                                    {searching && (
                                        <ActivityIndicator
                                            size="small"
                                            color={palette.textMuted}
                                            style={{ position: 'absolute', right: 16, top: 16 }}
                                        />
                                    )}
                                </View>

                                {results.length > 0 && (
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
                                                {place.formattedAddress && (
                                                    <Text
                                                        style={[
                                                            Type.caption,
                                                            { color: palette.textSecondary, marginTop: 1 },
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {place.formattedAddress}
                                                    </Text>
                                                )}
                                            </Pressable>
                                        ))}
                                    </View>
                                )}

                                {query.trim().length >= 2 && results.length === 0 && !searching && (
                                    <Text
                                        style={[
                                            Type.caption,
                                            { color: palette.textMuted, marginTop: Spacing.xs, paddingLeft: Spacing.xs },
                                        ]}
                                    >
                                        No results — you can still submit with this name
                                    </Text>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Table picker */}
                    {sortedTables.length > 0 && (
                        <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Post to
                            </Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.chipRow}
                            >
                                {sortedTables.map(t => (
                                    <Pressable
                                        key={t.id}
                                        onPress={() => setSelectedTableId(t.id)}
                                        style={[
                                            styles.tableChip,
                                            {
                                                backgroundColor:
                                                    selectedTableId === t.id
                                                        ? palette.primary
                                                        : palette.surfaceContainerLow,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                Type.caption,
                                                {
                                                    color:
                                                        selectedTableId === t.id
                                                            ? '#fff'
                                                            : palette.text,
                                                },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {t.name}
                                        </Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {/* Mode picker (group tables only) */}
                    {!isPersonalTable && selectedTableId && (
                        <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                How are you posting?
                            </Text>
                            <View style={styles.modePicker}>
                                <Pressable
                                    onPress={() => setPostMode('solo')}
                                    style={[
                                        styles.modeCard,
                                        {
                                            backgroundColor: postMode === 'solo'
                                                ? palette.primaryMuted
                                                : palette.surfaceContainerLow,
                                            borderWidth: postMode === 'solo' ? 1.5 : 0,
                                            borderColor: postMode === 'solo' ? palette.primary : 'transparent',
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="chatbubble-outline"
                                        size={20}
                                        color={postMode === 'solo' ? palette.primary : palette.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            Type.titleSmall,
                                            { color: postMode === 'solo' ? palette.primary : palette.text, marginTop: Spacing.xs },
                                        ]}
                                    >
                                        Solo Share
                                    </Text>
                                    <Text
                                        style={[
                                            Type.caption,
                                            { color: palette.textMuted, marginTop: 2 },
                                        ]}
                                    >
                                        Quick rec to the group
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => setPostMode('round')}
                                    style={[
                                        styles.modeCard,
                                        {
                                            backgroundColor: postMode === 'round'
                                                ? palette.primaryMuted
                                                : palette.surfaceContainerLow,
                                            borderWidth: postMode === 'round' ? 1.5 : 0,
                                            borderColor: postMode === 'round' ? palette.primary : 'transparent',
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="people-outline"
                                        size={20}
                                        color={postMode === 'round' ? palette.primary : palette.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            Type.titleSmall,
                                            { color: postMode === 'round' ? palette.primary : palette.text, marginTop: Spacing.xs },
                                        ]}
                                    >
                                        Start a Round
                                    </Text>
                                    <Text
                                        style={[
                                            Type.caption,
                                            { color: palette.textMuted, marginTop: 2 },
                                        ]}
                                    >
                                        Everyone rates it
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    )}

                    {/* Attendee picker (Round mode only) */}
                    {!isPersonalTable && postMode === 'round' && selectedTableId && (
                        <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Who was there?
                            </Text>

                            {membersLoading ? (
                                <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: Spacing.sm }} />
                            ) : tableMembers && tableMembers.filter(m => m.member_id !== user?.id).length > 0 ? (
                                <View style={styles.participantGrid}>
                                    {tableMembers.map(member => {
                                        const isCreator = member.member_id === user?.id;
                                        const isSelected = isCreator || selectedParticipantIds.has(member.member_id);
                                        const displayName = member.profiles?.display_name ?? 'Member';
                                        const initials = displayName
                                            .split(' ')
                                            .map(n => n[0])
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
                                <View style={[styles.emptyMembersBox, { backgroundColor: palette.surfaceContainerLow }]}>
                                    <Text style={[Type.body, { color: palette.textMuted, textAlign: 'center' }]}>
                                        No friends at this table yet
                                    </Text>
                                    <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'center', marginTop: 2 }]}>
                                        Invite people from the table settings
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Overall rating (always visible) */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            Your rating
                        </Text>
                        <View style={styles.ratingRow}>
                            <StarRating
                                value={rating}
                                size={36}
                                editable
                                onChange={setRating}
                                showValue
                            />
                        </View>
                    </View>

                    {/* Secondary ratings (collapsible) */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.lg }]}>
                        <Pressable
                            style={styles.detailsToggle}
                            onPress={() => setShowDetails(!showDetails)}
                        >
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Rate the details
                            </Text>
                            <Ionicons
                                name={showDetails ? 'chevron-up' : 'chevron-down'}
                                size={16}
                                color={palette.textSecondary}
                            />
                        </Pressable>

                        {showDetails && (
                            <View style={styles.detailRatings}>
                                {([
                                    ['Flavor', flavorRating, setFlavorRating],
                                    ['Vibes', vibeRating, setVibeRating],
                                    ['Service', serviceRating, setServiceRating],
                                    ['Value', valueRating, setValueRating],
                                ] as const).map(([label, val, setter]) => (
                                    <View key={label} style={styles.detailRow}>
                                        <Text style={[Type.bodySmall, { color: palette.text, width: 60 }]}>
                                            {label}
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
                        )}
                    </View>

                    {/* What did you have? */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            What did you have?
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                {
                                    backgroundColor: palette.surfaceContainerLow,
                                    color: palette.text,
                                    fontFamily: 'Manrope_400Regular',
                                    fontSize: 15,
                                },
                            ]}
                            placeholder="e.g. Spicy rigatoni, negroni"
                            placeholderTextColor={palette.textMuted}
                            value={dish}
                            onChangeText={setDish}
                        />
                    </View>

                    {/* Notes */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            Notes
                        </Text>
                        <TextInput
                            style={[
                                styles.textArea,
                                {
                                    backgroundColor: palette.surfaceContainerLow,
                                    color: palette.text,
                                    fontFamily: 'Manrope_400Regular',
                                    fontSize: 15,
                                },
                            ]}
                            placeholder="How was it? Any highlights?"
                            placeholderTextColor={palette.textMuted}
                            value={notes}
                            onChangeText={setNotes}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                    </View>

                    {/* Photo */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Text style={[Type.label, { color: palette.textSecondary }]}>
                            Photo
                        </Text>

                        {!photoUri ? (
                            <Pressable
                                onPress={handlePhotoPress}
                                style={[
                                    styles.photoButton,
                                    { backgroundColor: palette.surfaceContainerLow },
                                ]}
                            >
                                <Ionicons name="camera-outline" size={22} color={palette.textMuted} />
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginLeft: Spacing.sm }]}>
                                    Add a photo
                                </Text>
                            </Pressable>
                        ) : (
                            <View style={styles.photoPreviewContainer}>
                                <Image
                                    source={{ uri: photoUri }}
                                    style={[
                                        styles.photoPreview,
                                        { borderRadius: Radius.lg },
                                    ]}
                                    resizeMode="cover"
                                />

                                {/* Upload state overlay */}
                                {photoUploading && (
                                    <View style={[styles.photoOverlay, { borderRadius: Radius.lg }]}>
                                        <ActivityIndicator color="#fff" />
                                    </View>
                                )}

                                {/* Error state overlay */}
                                {photoError && !photoUploading && (
                                    <Pressable
                                        onPress={() => photoUri && uploadPhoto(photoUri)}
                                        style={[styles.photoOverlay, { borderRadius: Radius.lg, backgroundColor: 'rgba(0,0,0,0.55)' }]}
                                    >
                                        <Ionicons name="refresh-outline" size={28} color="#fff" />
                                        <Text style={{ color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 4, textAlign: 'center' }}>
                                            Tap to retry
                                        </Text>
                                    </Pressable>
                                )}

                                {/* Dismiss button */}
                                <Pressable
                                    onPress={handleRemovePhoto}
                                    style={[styles.photoRemoveButton, { backgroundColor: palette.text }]}
                                    hitSlop={8}
                                >
                                    <Ionicons name="close" size={14} color={palette.background} />
                                </Pressable>
                            </View>
                        )}

                        {photoError && !photoUploading && (
                            <Text style={[Type.caption, { color: palette.error, marginTop: 2 }]}>
                                {photoError}
                            </Text>
                        )}
                    </View>

                    {/* Submit */}
                    <Pressable
                        disabled={!canSubmit || isSubmitting}
                        onPress={handleSubmit}
                        style={({ pressed }) => [
                            styles.ctaButton,
                            {
                                marginTop: Spacing.xl + Spacing.md,
                                backgroundColor: canSubmit
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                                opacity: pressed ? 0.9 : isSubmitting ? 0.6 : 1,
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
                                        letterSpacing: 2,
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    fieldGroup: {
        gap: Spacing.sm,
    },
    textInput: {
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 52,
    },
    textArea: {
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 100,
    },
    ctaButton: {
        height: 56,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 52,
    },
    dropdown: {
        borderRadius: Radius.lg,
        marginTop: Spacing.xs,
        overflow: 'hidden',
    },
    dropdownRow: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
    },
    chipRow: {
        gap: Spacing.sm,
        paddingRight: Spacing.sm,
    },
    tableChip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        maxWidth: 160,
    },
    // Mode picker
    modePicker: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    modeCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.lg,
    },
    // Rating
    ratingRow: {
        alignItems: 'center',
        paddingVertical: Spacing.sm,
    },
    detailsToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    detailRatings: {
        gap: Spacing.md,
        paddingTop: Spacing.sm,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
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
    // Photo upload
    photoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 52,
    },
    photoPreviewContainer: {
        position: 'relative',
        alignSelf: 'stretch',
    },
    photoPreview: {
        width: '100%',
        aspectRatio: 16 / 9,
    },
    photoOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoRemoveButton: {
        position: 'absolute',
        top: Spacing.sm,
        right: Spacing.sm,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
