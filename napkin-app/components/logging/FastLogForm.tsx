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
 *
 * UI kit migration (TICKET-023): Heirloom Journal layout — RestaurantHeader →
 * PhotoStrip placeholder → stars + caption → FieldUnderline note → friend/tag
 * chip row → "+ Break it down" link. No behavioural change.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import * as Location from 'expo-location';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { StarRating } from '@/components/StarRating';
import {
    RestaurantHeader,
    FieldUnderline,
    Chip,
    Label,
    LabelSmall,
} from '@/components/ui';
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

// Caption for the current rating — "Really good · 4.5/5".
function ratingCaption(value: number): string {
    if (value <= 0) return 'tap a star to rate';
    if (value >= 5) return 'perfect';
    if (value >= 4.5) return 'really good';
    if (value >= 4) return 'very good';
    if (value >= 3.5) return 'good';
    if (value >= 3) return 'fine';
    if (value >= 2.5) return 'mixed';
    if (value >= 2) return 'meh';
    if (value >= 1) return 'not good';
    return 'rough';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FastLogForm({
    presentation,
    lockedRestaurant,
    initialTableId,
    onSubmitted,
    onAddDetails,
    onClose: _onClose, // kept for API compat; SheetHeader now owns close in sheet mode
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

    // ── Note (optional one-liner from the Fast Log canvas) ────────────────
    const [note, setNote] = useState('');

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
                content: note.trim() || undefined,
                table_id: selectedTableId ?? undefined,
                visibility: selectedTableId ? 'table' : 'private',
            });
            const entryId = result?.id ?? result?.entry?.id ?? '';
            onSubmitted(entryId);
        } catch (e: any) {
            setSubmitError(e.message ?? 'Could not save entry. Tap to retry.');
        }
    }, [canSubmit, isSubmitting, lockedRestaurant, selectedPlace, query, rating, note, selectedTableId, createEntry, onSubmitted]);

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

    // Meta string for RestaurantHeader — prefer address, else use placeholder copy.
    const restaurantMeta: string | undefined = lockedRestaurant
        ? (lockedRestaurant.placePayload?.formattedAddress ?? undefined)
        : selectedPlace?.formattedAddress ?? undefined;
    const restaurantPhoto: string | null | undefined = lockedRestaurant?.placePayload?.photoReference
        ? undefined // photoReference is a Places ref, not a URL — let header fall back to tile
        : undefined;

    const restaurantName = lockedRestaurant?.name ?? selectedPlace?.name ?? '';

    const content = (
        <ScrollView
            contentContainerStyle={[
                styles.scrollContent,
                isModal && styles.scrollContentModal,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            {/* Restaurant header — canonical Heirloom header block */}
            {lockedRestaurant ? (
                <RestaurantHeader
                    name={lockedRestaurant.name}
                    meta={restaurantMeta}
                    photoUrl={restaurantPhoto}
                    locked
                />
            ) : selectedPlace ? (
                <RestaurantHeader
                    name={restaurantName}
                    meta={restaurantMeta}
                    onClear={handleClearPlace}
                />
            ) : (
                <View style={styles.fieldGroup}>
                    <LabelSmall color={palette.textSecondary}>Where did you eat?</LabelSmall>
                    <View style={{ position: 'relative' }}>
                        <FieldUnderline
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search restaurants…"
                            fontVariant="serifItalic"
                            size="display"
                            autoFocus={isModal}
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
                                    {place.formattedAddress ? (
                                        <Text
                                            style={[Type.caption, { color: palette.textSecondary, marginTop: 1 }]}
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

            {/* Photo strip — placeholder only in Fast Log (no uploads wired here) */}
            {/*
              Fast Log has never accepted photos pre-submit. We render the empty "+"
              tile to preserve the canonical canvas; tapping it routes to the full
              composer via "Add details" so photos can be attached there. This is a
              visual-only affordance per the ticket (no behaviour change).
            */}
            <View style={{ marginTop: Spacing.lg }}>
                <Pressable
                    onPress={handleAddDetails}
                    style={({ pressed }) => [
                        styles.photoPlaceholder,
                        { borderColor: palette.ruleInkSoft, opacity: pressed ? 0.6 : 1 },
                    ]}
                >
                    <Text
                        style={{
                            fontSize: 22,
                            color: palette.textMuted,
                            fontWeight: '300',
                            lineHeight: 26,
                        }}
                    >
                        +
                    </Text>
                </Pressable>
            </View>

            {/* Overall rating — stacked: stars + caption underneath */}
            <View style={{ marginTop: Spacing.xl - 4 }}>
                <StarRating
                    value={rating}
                    size={34}
                    editable
                    onChange={setRating}
                />
                <Text
                    style={[
                        styles.ratingCaption,
                        { color: palette.textMuted },
                    ]}
                >
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 15,
                            color: palette.text,
                        }}
                    >
                        {ratingCaption(rating)}
                    </Text>
                    <Text>  ·  </Text>
                    <Text>{rating > 0 ? `${rating.toFixed(1)} / 5` : 'no rating yet'}</Text>
                </Text>
            </View>

            {/* Note — underline-only FieldUnderline */}
            <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
            <FieldUnderline
                value={note}
                onChangeText={setNote}
                placeholder="a line about it (optional)"
                fontVariant="serif"
                size="body"
            />

            {/* Table picker — pill chip row, single-select */}
            {sortedTables.length > 0 ? (
                <>
                    <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                    <View style={styles.chipHeader}>
                        <Label>Post to</Label>
                    </View>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                    >
                        {sortedTables.map(t => (
                            <Chip
                                key={t.id}
                                variant="pill"
                                active={selectedTableId === t.id}
                                onPress={() => setSelectedTableId(t.id)}
                            >
                                {t.name}
                            </Chip>
                        ))}
                    </ScrollView>
                </>
            ) : null}

            {/* "+ Break it down" — terracotta link routes to full composer */}
            <Pressable
                onPress={handleAddDetails}
                disabled={createEntry.isPending || createEntry.isSuccess}
                style={({ pressed }) => [
                    styles.breakDownLink,
                    {
                        opacity:
                            pressed || createEntry.isPending || createEntry.isSuccess
                                ? 0.5
                                : 1,
                    },
                ]}
            >
                <Text
                    style={{
                        fontFamily: 'Manrope_500Medium',
                        fontSize: 13,
                        color: palette.primary,
                    }}
                >
                    + break it down
                </Text>
            </Pressable>

            {/* Error state */}
            {submitError ? (
                <View style={[styles.errorRow, { marginTop: Spacing.md }]}>
                    <Text style={[Type.bodySmall, { color: palette.error }]}>
                        {submitError}
                    </Text>
                    <Pressable onPress={handleSubmit}>
                        <Text
                            style={[
                                Type.caption,
                                {
                                    color: palette.error,
                                    textDecorationLine: 'underline',
                                    marginLeft: Spacing.xs,
                                },
                            ]}
                        >
                            retry
                        </Text>
                    </Pressable>
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
                        LOG IT
                    </Text>
                )}
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
        paddingTop: Spacing.md,
    },
    scrollContentModal: {
        paddingTop: Spacing.lg,
    },
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
    photoPlaceholder: {
        width: 64,
        height: 64,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    ratingCaption: {
        marginTop: Spacing.sm + 2,
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: Spacing.lg - 4,
    },
    chipHeader: {
        marginBottom: Spacing.sm,
    },
    chipRow: {
        gap: Spacing.sm,
        paddingRight: Spacing.sm,
    },
    breakDownLink: {
        marginTop: Spacing.lg,
        paddingVertical: Spacing.sm,
        alignSelf: 'flex-start',
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    ctaButton: {
        height: 52,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xl,
    },
});
