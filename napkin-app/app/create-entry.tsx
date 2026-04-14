/**
 * Create Entry — log a meal / share to your table.
 * Restaurant search via Google Places → pick table → tag who was there → rate → notes → share.
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
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import Slider from '@react-native-community/slider';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { useTables } from '@/hooks/tables/useTables';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { supabase } from '@/lib/supabase';

// ── Place result type ──────────────────────────────────────────────────────

interface PlaceResult {
    id: string;
    name: string;
    formattedAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    categories: string[];
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function CreateEntryScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { tableId: tableIdParam } = useLocalSearchParams<{ tableId: string }>();

    // Tables data
    const { data: tableMemberships } = useTables(user?.id);

    // Sort tables: personal table first
    const tables = (tableMemberships ?? []).map(m => m.tables);
    const sortedTables = [...tables].sort((a, b) => {
        if (a.is_personal && !b.is_personal) return -1;
        if (!a.is_personal && b.is_personal) return 1;
        return 0;
    });

    // Default selected table: use tableId param if present, else personal table, else first table
    const personalTable = sortedTables.find(t => t.is_personal);
    const defaultTableId = tableIdParam ?? personalTable?.id ?? sortedTables[0]?.id ?? null;
    const [selectedTableId, setSelectedTableId] = useState<string | null>(defaultTableId);

    // Update selected table when tables load (in case they weren't available on mount)
    useEffect(() => {
        if (!selectedTableId && defaultTableId) {
            setSelectedTableId(defaultTableId);
        }
    }, [defaultTableId, selectedTableId]);

    const selectedTable = sortedTables.find(t => t.id === selectedTableId) ?? null;
    const isPersonalTable = selectedTable?.is_personal === true;

    // Participant tagging (only for group tables)
    const { data: tableMembers } = useTableMembers(isPersonalTable ? null : selectedTableId);
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());

    // Reset participant selection when table changes
    useEffect(() => {
        setSelectedParticipantIds(new Set());
    }, [selectedTableId]);

    const createEntry = useCreateEntry(user?.id, selectedTableId);

    // Search state
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Form state
    const [rating, setRating] = useState(3.0);
    const [includeRating, setIncludeRating] = useState(false);
    const [notes, setNotes] = useState('');
    const [dish, setDish] = useState('');

    const canSubmit = selectedPlace !== null || query.trim().length > 0;

    // ── Debounced search ───────────────────────────────────────────────────

    useEffect(() => {
        if (selectedPlace) return; // Don't search after selecting
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
            // Silently fail — user can still submit manually
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
        if (!user || memberId === user.id) return; // creator cannot be deselected
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

    // ── Submit ─────────────────────────────────────────────────────────────

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
            }
            : {
                // Fallback for manual entry (no Google Places result)
                external_id: `manual-${query.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
                name: query.trim(),
                types: ['restaurant'] as string[],
            };

        // Build participant_ids: only tagged others (creator is always included server-side)
        const participantIds = isPersonalTable
            ? undefined
            : Array.from(selectedParticipantIds);

        try {
            await createEntry.mutateAsync({
                restaurant: restaurantData,
                rating: includeRating ? Math.round(rating * 2) / 2 : null,
                content: notes.trim() || undefined,
                dish_description: dish.trim() || undefined,
                table_id: selectedTableId ?? undefined,
                visibility: selectedTableId ? 'table' : 'private',
                participant_ids: participantIds,
            });
            router.back();
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not save entry');
        }
    }, [
        canSubmit,
        selectedPlace,
        query,
        includeRating,
        rating,
        notes,
        dish,
        selectedTableId,
        isPersonalTable,
        selectedParticipantIds,
        createEntry,
        router,
    ]);

    const submitLabel = selectedTableId
        ? selectedTable?.is_personal
            ? 'SAVE TO JOURNAL'
            : 'SHARE TO TABLE'
        : 'SAVE ENTRY';

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
                            /* Selected place chip */
                            <Pressable
                                onPress={handleClearPlace}
                                style={[
                                    styles.selectedChip,
                                    { backgroundColor: palette.surfaceContainerLow },
                                ]}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text
                                        style={[
                                            {
                                                fontFamily: 'Newsreader_400Regular_Italic',
                                                fontSize: 22,
                                                color: palette.text,
                                            },
                                        ]}
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
                            /* Search input */
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

                                {/* Search results dropdown */}
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

                                {/* Manual fallback hint */}
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
                    {sortedTables.length > 0 ? (
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
                                            {t.is_personal ? `${t.name}` : t.name}
                                        </Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    ) : null}

                    {/* Participant tagging (only for group tables) */}
                    {!isPersonalTable && selectedTableId && tableMembers && tableMembers.length > 1 ? (
                        <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Who was there?
                            </Text>
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
                        </View>
                    ) : null}

                    {/* Rating toggle + slider */}
                    <View style={[styles.fieldGroup, { marginTop: Spacing.xl }]}>
                        <Pressable
                            style={styles.toggleRow}
                            onPress={() => setIncludeRating(!includeRating)}
                        >
                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                Add a Rating
                            </Text>
                            <View
                                style={[
                                    styles.toggle,
                                    {
                                        backgroundColor: includeRating
                                            ? palette.primary
                                            : palette.surfaceContainerHigh,
                                    },
                                ]}
                            >
                                <View
                                    style={[
                                        styles.toggleKnob,
                                        {
                                            backgroundColor: '#fff',
                                            transform: [
                                                { translateX: includeRating ? 18 : 2 },
                                            ],
                                        },
                                    ]}
                                />
                            </View>
                        </Pressable>

                        {includeRating && (
                            <View style={{ marginTop: Spacing.md }}>
                                <View style={styles.ratingDisplay}>
                                    <Text
                                        style={[
                                            Type.ratingLarge,
                                            { color: palette.tertiary, fontSize: 36 },
                                        ]}
                                    >
                                        {rating.toFixed(1)}
                                    </Text>
                                </View>
                                <Slider
                                    style={{ width: '100%', height: 36 }}
                                    minimumValue={0.5}
                                    maximumValue={5}
                                    step={0.5}
                                    value={rating}
                                    onValueChange={setRating}
                                    minimumTrackTintColor={palette.primary}
                                    maximumTrackTintColor={palette.surfaceContainerHigh}
                                    thumbTintColor={palette.primary}
                                />
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

                    {/* Submit — inline at the bottom of the scroll */}
                    <Pressable
                        disabled={!canSubmit || createEntry.isPending}
                        onPress={handleSubmit}
                        style={({ pressed }) => [
                            styles.ctaButton,
                            {
                                marginTop: Spacing.xl + Spacing.md,
                                backgroundColor: canSubmit
                                    ? palette.primary
                                    : palette.surfaceContainerHigh,
                                opacity: pressed ? 0.9 : createEntry.isPending ? 0.6 : 1,
                            },
                        ]}
                    >
                        {createEntry.isPending ? (
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

// ── Styles ─────────────────────────────────────────────────────────────────

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
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toggle: {
        width: 44,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
    },
    toggleKnob: {
        width: 22,
        height: 22,
        borderRadius: 11,
    },
    ratingDisplay: {
        alignItems: 'center',
        marginBottom: Spacing.sm,
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
    // Table picker
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
    // Participant tagging
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
});
