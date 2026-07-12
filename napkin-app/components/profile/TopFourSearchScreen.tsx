/**
 * TopFourSearchScreen — full-screen Google Places search for adding a restaurant
 * to the profile Top 4. Rendered as a content-swap INSIDE ProfileTopFourSheet's
 * modal (not its own Modal — nesting two pageSheets is unreliable on iOS), so
 * pressing "add a spot" makes "a whole screen come up" and the back chevron
 * returns to the slot list.
 *
 * Reuses useRestaurantSearch → real Places results, tiered:
 *   your spots (your Tables have logged) · on Napkin · more places (Google)
 *
 * ANY result is addable, logged or not (product decision 2026-06-17). A ghost
 * (Google-only, no Napkin id) is upserted via usePersistPlace to mint a
 * restaurant_id before it's handed back. Already-picked rows render "added".
 *
 * Stays mounted while you add (mark "added", keep searching) so all four slots
 * can be filled in one pass; the back chevron closes it.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    TextInput,
    ActivityIndicator,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRestaurantSearch, type SearchResultRow as SearchRow } from '@/hooks/search/useRestaurantSearch';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';

export interface TopFourSearchPick {
    restaurant_id: string;
    name: string;
    photo_url: string | null;
}

interface Props {
    onClose: () => void;
    onPick: (pick: TopFourSearchPick) => void;
    userId: string | null | undefined;
    /** restaurant_ids already in the draft — rendered as "added", non-tappable. */
    pickedIds: Set<string>;
    /** True when the draft already holds 4 — only already-picked rows respond. */
    atCapacity: boolean;
}

// Stable per-row key (Napkin id when persisted, else the Google Place ID).
function rowKey(r: SearchRow): string {
    return r.id ?? r.placeId ?? r.name;
}

export function TopFourSearchScreen({ onClose, onPick, userId, pickedIds, atCapacity }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    // The row key currently being persisted (spinner on that row).
    const [resolvingKey, setResolvingKey] = useState<string | null>(null);
    // Rows added this session — marks ghosts (no restaurant_id yet) as "added".
    const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
    // Synchronous in-flight guard — blocks a same-frame double-tap from firing a
    // second (billed) Places Details call before resolvingKey state lands.
    const inFlightRef = useRef<Set<string>>(new Set());

    const persistPlace = usePersistPlace();

    // Debounce the query that drives the (cost-bearing) Places call.
    useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);

    const { results, isLoading, isPlacesError, refetch } = useRestaurantSearch(
        debounced,
        userId,
        null,
    );

    const isAdded = useCallback(
        (r: SearchRow) =>
            (r.id != null && pickedIds.has(r.id)) || addedKeys.has(rowKey(r)),
        [pickedIds, addedKeys],
    );

    const handlePick = useCallback(
        (r: SearchRow) => {
            if (isAdded(r) || atCapacity) return;
            const key = rowKey(r);

            // Persisted result → has a Napkin id already (synchronous add).
            if (r.id) {
                setAddedKeys((prev) => new Set(prev).add(key));
                onPick({ restaurant_id: r.id, name: r.name, photo_url: r.photoUrl });
                return;
            }

            // Ghost (Google-only) → upsert to mint a restaurant_id first.
            if (r.placeId) {
                if (inFlightRef.current.has(key)) return;
                inFlightRef.current.add(key);
                setResolvingKey(key);
                persistPlace.mutate(r.placeId, {
                    onSuccess: (restaurantId) => {
                        inFlightRef.current.delete(key);
                        setResolvingKey((cur) => (cur === key ? null : cur));
                        setAddedKeys((prev) => new Set(prev).add(key));
                        onPick({ restaurant_id: restaurantId, name: r.name, photo_url: r.photoUrl });
                    },
                    onError: () => {
                        inFlightRef.current.delete(key);
                        setResolvingKey((cur) => (cur === key ? null : cur));
                    },
                });
            }
        },
        [isAdded, atCapacity, onPick, persistPlace],
    );

    const sections = useMemo(
        () =>
            [
                { label: 'YOUR SPOTS', rows: results.visited },
                { label: 'ON NAPKIN', rows: results.onNapkin },
                { label: 'MORE PLACES', rows: results.morePlaces },
            ].filter((s) => s.rows.length > 0),
        [results],
    );

    const hasQuery = debounced.length >= 2;
    const hasResults = sections.length > 0;

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back">
                    <Ionicons name="chevron-back" size={24} color={palette.text} />
                </Pressable>
                <Text
                    style={[
                        Type.screenTitle,
                        { color: palette.text },
                    ]}
                >
                    Add to Top 4
                </Text>
                <View style={{ width: 24 }} />
            </View>

            {/* Search field */}
            <View style={[styles.searchField, { backgroundColor: palette.surfaceJournalLow }]}>
                <Ionicons name="search" size={17} color={palette.textMuted} />
                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="search any restaurant"
                    placeholderTextColor={palette.textMuted}
                    style={[styles.searchInput, { color: palette.text }]}
                    autoFocus
                    autoCorrect={false}
                    returnKeyType="search"
                />
                {query.length > 0 ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                        <Ionicons name="close-circle" size={17} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </View>

            {atCapacity ? (
                <Text style={[styles.capacityNote, { color: palette.textMuted }]}>
                    Top 4 is full — remove one to add another.
                </Text>
            ) : null}

            {/* Results */}
            {!hasQuery ? (
                <View style={styles.centered}>
                    <Text style={[Type.body, { color: palette.textMuted, textAlign: 'center' }]}>
                        Search for a restaurant to feature —{'\n'}logged or not.
                    </Text>
                </View>
            ) : isLoading && !hasResults ? (
                <View style={styles.centered}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : (
                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                >
                    {sections.map((section) => (
                        <View key={section.label}>
                            <Text style={[styles.tierLabel, { color: palette.textMuted }]}>
                                {section.label}
                            </Text>
                            {section.rows.map((r) => {
                                const key = rowKey(r);
                                const added = isAdded(r);
                                const resolving = resolvingKey === key;
                                const dimmed = atCapacity && !added;
                                const meta = [r.city ?? r.address, r.cuisine].filter(Boolean).join(' · ');
                                return (
                                    <Pressable
                                        key={key}
                                        onPress={() => handlePick(r)}
                                        disabled={added || resolving || dimmed}
                                        style={({ pressed }) => [
                                            styles.row,
                                            pressed && { backgroundColor: palette.surfaceContainer },
                                            dimmed && { opacity: 0.4 },
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel={added ? `${r.name}, added` : `Add ${r.name}`}
                                    >
                                        {r.photoUrl ? (
                                            <ExpoImage source={{ uri: r.photoUrl }} style={styles.thumb} contentFit="cover" />
                                        ) : (
                                            <View style={[styles.thumb, styles.thumbGhost, { backgroundColor: palette.surfaceJournalHi }]}>
                                                <Ionicons name="location-outline" size={18} color={palette.textMuted} />
                                            </View>
                                        )}

                                        <View style={styles.textBlock}>
                                            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                                {r.name}
                                            </Text>
                                            {meta ? (
                                                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                                    {meta}
                                                </Text>
                                            ) : null}
                                        </View>

                                        {resolving ? (
                                            <ActivityIndicator size="small" color={palette.primary} style={styles.signal} />
                                        ) : added ? (
                                            <View style={[styles.signal, styles.addedPill]}>
                                                <Ionicons name="checkmark" size={14} color={palette.secondary} />
                                                <Text style={[styles.addedText, { color: palette.secondary }]}>added</Text>
                                            </View>
                                        ) : (
                                            <Text style={[styles.addPill, { color: palette.primary, borderColor: 'rgba(160,63,40,0.35)' }]}>
                                                ADD
                                            </Text>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}

                    {!hasResults && !isLoading ? (
                        <Text style={[Type.body, { color: palette.textMuted, textAlign: 'center', paddingTop: Spacing.xl }]}>
                            {isPlacesError ? (
                                <Text onPress={refetch}>Couldn’t reach search — tap to retry.</Text>
                            ) : (
                                `No results for “${debounced}”.`
                            )}
                        </Text>
                    ) : null}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingBottom: Spacing.sm,
    },
    searchField: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        marginHorizontal: 18,
        marginTop: Spacing.xs,
        marginBottom: Spacing.sm,
        paddingHorizontal: 12,
        height: 44,
        borderRadius: Radius.md,
    },
    searchInput: {
        ...Type.body,
        flex: 1,
        padding: 0,
    },
    capacityNote: {
        ...Type.metadata,
        marginHorizontal: 18,
        marginBottom: Spacing.xs,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xxl,
    },
    tierLabel: {
        ...Type.sectionKicker,
        paddingHorizontal: 18,
        marginTop: Spacing.md,
        marginBottom: Spacing.xs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingVertical: Spacing.sm + 2,
        gap: 12,
    },
    thumb: {
        width: 46,
        height: 46,
        borderRadius: Radius.sm,
        flexShrink: 0,
    },
    thumbGhost: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    textBlock: { flex: 1, minWidth: 0, gap: 2 },
    name: {
        ...Type.editorialBody,
    },
    meta: {
        ...Type.metadata,
    },
    signal: { flexShrink: 0 },
    addPill: {
        ...Type.label,
        borderWidth: 1,
        borderRadius: Radius.full,
        paddingHorizontal: 12,
        paddingVertical: 5,
        overflow: 'hidden',
        flexShrink: 0,
    },
    addedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    addedText: {
        ...Type.metadata,
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
    },
});
