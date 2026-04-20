/**
 * FastLogForm — shared fast-log form component.
 *
 * Collects exactly three fields: restaurant, rating (0.5–5.0), Table.
 * Renders in two presentation modes:
 *   - 'modal': full-screen (used by app/fast-log.tsx from + tab)
 *   - 'sheet': inline (used by FastLogSheet on restaurant page)
 *
 * Submit path: reuses useCreateEntry verbatim.
 * "Add details" pushes to /create-entry with prefill params (pre-submit only).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    Pressable,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { StarRating } from '@/components/StarRating';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlaceResult {
    id: string;
    name: string;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    categories: string[];
    photoReference: string | null;
}

export interface LockedRestaurant {
    /** Napkin UUID — present if this is a persisted restaurant */
    id?: string;
    /** Google Place ID — present for ghost restaurants */
    external_id?: string;
    name: string;
    /** Full Places payload for passing to create-entry as placePayload */
    placePayload?: any;
}

export interface FastLogFormProps {
    presentation: 'modal' | 'sheet';
    /** When set, restaurant field is non-interactive (restaurant page entry point) */
    lockedRestaurant?: LockedRestaurant;
    /** Defaults to personal Table */
    initialTableId?: string;
    /** Called with the created entryId after successful submit */
    onSubmitted: (entryId: string) => void;
    /** Called when user taps "Add details" — receives prefill data for create-entry */
    onAddDetails: (prefill: {
        rating: number;
        restaurant: PlaceResult | null;
        lockedRestaurant?: LockedRestaurant;
        tableId: string | null;
    }) => void;
    /** Sheet presentation only — called on backdrop tap or close */
    onClose?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FastLogForm({
    presentation,
    lockedRestaurant,
    initialTableId,
    onSubmitted,
    onAddDetails,
    onClose,
}: FastLogFormProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    // ── Tables ────────────────────────────────────────────────────────────
    const { data: tableMemberships } = useTables(user?.id);
    const tables = (tableMemberships ?? []).map(m => m.tables);
    const sortedTables = [...tables].sort((a, b) => {
        if (a.is_personal && !b.is_personal) return -1;
        if (!a.is_personal && b.is_personal) return 1;
        return 0;
    });
    const personalTable = sortedTables.find(t => t.is_personal);
    const defaultTableId = initialTableId ?? personalTable?.id ?? sortedTables[0]?.id ?? null;
    const [selectedTableId, setSelectedTableId] = useState<string | null>(defaultTableId);

    useEffect(() => {
        if (!selectedTableId && defaultTableId) {
            setSelectedTableId(defaultTableId);
        }
    }, [defaultTableId, selectedTableId]);

    // ── Restaurant search (not shown when lockedRestaurant is set) ────────
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Device location for search bias
    const [deviceLocation, setDeviceLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
        if (lockedRestaurant) return; // no search needed
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            setDeviceLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        })();
    }, [lockedRestaurant]);

    useEffect(() => {
        if (lockedRestaurant || selectedPlace) return;
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => searchPlaces(query.trim()), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, selectedPlace, lockedRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // ── Rating ────────────────────────────────────────────────────────────
    const [rating, setRating] = useState(0);

    // ── Submit ────────────────────────────────────────────────────────────
    const createEntry = useCreateEntry(user?.id, selectedTableId);

    const hasRestaurant = !!lockedRestaurant || !!selectedPlace || query.trim().length > 0;
    const canSubmit = hasRestaurant && rating > 0;
    const isSubmitting = createEntry.isPending;
    const [submitError, setSubmitError] = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
        if (!canSubmit || isSubmitting) return;
        setSubmitError(null);

        let restaurantData: any;

        if (lockedRestaurant) {
            // Restaurant page path — build from locked data
            const payload = lockedRestaurant.placePayload;
            if (payload) {
                restaurantData = {
                    external_id: payload.id ?? payload.external_id ?? lockedRestaurant.external_id ?? '',
                    name: payload.name ?? lockedRestaurant.name,
                    location: payload.formattedAddress
                        ? { address: payload.formattedAddress }
                        : undefined,
                    types: payload.categories ?? ['restaurant'],
                    latitude: payload.latitude ?? undefined,
                    longitude: payload.longitude ?? undefined,
                    photoReference: payload.photoReference ?? undefined,
                };
            } else {
                restaurantData = {
                    external_id: lockedRestaurant.external_id ?? lockedRestaurant.id ?? `manual-${Date.now()}`,
                    name: lockedRestaurant.name,
                    types: ['restaurant'],
                };
            }
        } else if (selectedPlace) {
            restaurantData = {
                external_id: selectedPlace.id,
                name: selectedPlace.name,
                location: selectedPlace.formattedAddress
                    ? { address: selectedPlace.formattedAddress }
                    : undefined,
                types: selectedPlace.categories?.length ? selectedPlace.categories : ['restaurant'],
                latitude: selectedPlace.latitude ?? undefined,
                longitude: selectedPlace.longitude ?? undefined,
                photoReference: selectedPlace.photoReference ?? undefined,
            };
        } else {
            // Manual entry — no place selected, use query text
            restaurantData = {
                external_id: `manual-${query.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
                name: query.trim(),
                types: ['restaurant'],
            };
        }

        const ratingValue = Math.round(rating * 2) / 2;

        try {
            const result = await createEntry.mutateAsync({
                restaurant: restaurantData,
                rating: ratingValue,
                table_id: selectedTableId ?? undefined,
                visibility: selectedTableId ? 'table' : 'private',
            });
            const entryId = result?.id ?? result?.entry?.id ?? '';
            onSubmitted(entryId);
        } catch (e: any) {
            setSubmitError(e.message ?? 'Could not save entry. Tap to retry.');
        }
    }, [canSubmit, isSubmitting, lockedRestaurant, selectedPlace, query, rating, selectedTableId, createEntry, onSubmitted]);

    // ── "Add details" — push to full composer with prefill ───────────────
    const handleAddDetails = useCallback(() => {
        if (createEntry.isPending || createEntry.isSuccess) return;
        onAddDetails({
            rating,
            restaurant: selectedPlace,
            lockedRestaurant,
            tableId: selectedTableId,
        });
    }, [rating, selectedPlace, lockedRestaurant, selectedTableId, createEntry.isPending, createEntry.isSuccess, onAddDetails]);

    // ── Render ────────────────────────────────────────────────────────────

    const isModal = presentation === 'modal';

    const content = (
        <ScrollView
            contentContainerStyle={[
                styles.scrollContent,
                isModal && styles.scrollContentModal,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {/* Sheet header — close button */}
            {!isModal && onClose && (
                <View style={styles.sheetHeader}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.text, marginTop: Spacing.md },
                        ]}
                    >
                        Rate this spot
                    </Text>
                </View>
            )}

            {/* Restaurant field */}
            {lockedRestaurant ? (
                // Locked: show name chip, no interaction
                <View style={[styles.fieldGroup, !isModal && { marginTop: Spacing.lg }]}>
                    <Text style={[Type.label, { color: palette.textSecondary }]}>
                        Where did you eat?
                    </Text>
                    <View
                        style={[
                            styles.lockedChip,
                            { backgroundColor: palette.surfaceContainerLow },
                        ]}
                    >
                        <Text
                            style={{
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 22,
                                color: palette.text,
                            }}
                            numberOfLines={1}
                        >
                            {lockedRestaurant.name}
                        </Text>
                        <Ionicons name="lock-closed-outline" size={14} color={palette.textMuted} />
                    </View>
                </View>
            ) : (
                // Search field
                <View style={[styles.fieldGroup, !isModal && { marginTop: Spacing.lg }]}>
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
                                    autoFocus={isModal}
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
                                                    { color: palette.text, fontFamily: 'Manrope_500Medium' },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {place.name}
                                            </Text>
                                            {place.formattedAddress && (
                                                <Text
                                                    style={[Type.caption, { color: palette.textSecondary, marginTop: 1 }]}
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
            )}

            {/* Rating */}
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

            {/* Error state */}
            {submitError && (
                <View style={[styles.errorRow, { marginTop: Spacing.md }]}>
                    <Text style={[Type.bodySmall, { color: palette.error }]}>
                        {submitError}
                    </Text>
                    <Pressable onPress={handleSubmit}>
                        <Text style={[Type.caption, { color: palette.error, textDecorationLine: 'underline', marginLeft: Spacing.xs }]}>
                            Retry
                        </Text>
                    </Pressable>
                </View>
            )}

            {/* Primary CTA */}
            <Pressable
                disabled={!canSubmit || isSubmitting}
                onPress={handleSubmit}
                style={({ pressed }) => [
                    styles.ctaButton,
                    {
                        marginTop: Spacing.xl,
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
                        LOG IT
                    </Text>
                )}
            </Pressable>

            {/* Secondary: Add details */}
            <Pressable
                onPress={handleAddDetails}
                disabled={createEntry.isPending || createEntry.isSuccess}
                style={({ pressed }) => [
                    styles.addDetailsLink,
                    { opacity: pressed || createEntry.isPending || createEntry.isSuccess ? 0.5 : 1 },
                ]}
            >
                <Text style={[Type.caption, { color: palette.textSecondary }]}>
                    Want to add notes or photos?{' '}
                </Text>
                <Text style={[Type.caption, { color: palette.primary }]}>
                    Add details
                </Text>
            </Pressable>
        </ScrollView>
    );

    if (isModal) {
        return (
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: palette.background }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                {content}
            </KeyboardAvoidingView>
        );
    }

    return content;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.xl,
    },
    scrollContentModal: {
        paddingTop: Spacing.xl,
    },
    sheetHeader: {
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
    },
    fieldGroup: {
        gap: Spacing.sm,
    },
    lockedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 52,
        gap: Spacing.sm,
    },
    selectedChip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        minHeight: 52,
    },
    textInput: {
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
    ratingRow: {
        alignItems: 'center',
        paddingVertical: Spacing.sm,
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
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    ctaButton: {
        height: 56,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addDetailsLink: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.md,
        paddingVertical: Spacing.sm,
    },
});
