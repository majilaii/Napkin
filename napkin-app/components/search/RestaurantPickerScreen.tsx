/** Shared full-screen restaurant picker for profile curation flows. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useRestaurantSearch,
    type SearchResultRow,
} from '@/hooks/search/useRestaurantSearch';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { PlacesCredit } from '@/components/ui/PlacesCredit';
import {
    deriveSearchPlacesCredits,
    resolveVisibleSearchResultPhoto,
    searchPhotoFailureKey,
} from './searchPhotoPresentation';

export type RestaurantPickerPick = {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
};

type Props = {
    title?: string;
    userId: string | null | undefined;
    onBack: () => void;
    onPick: (pick: RestaurantPickerPick) => void;
};

const rowKey = (row: SearchResultRow) => row.id ?? row.placeId ?? row.name;

export function RestaurantPickerScreen({
    title = 'Choose a restaurant',
    userId,
    onBack,
    onPick,
}: Props) {
    const scheme = (useColorScheme() ?? 'light') as keyof typeof Colors;
    const palette = Colors[scheme] as typeof Colors.light;
    const insets = useSafeAreaInsets();
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [resolvingKey, setResolvingKey] = useState<string | null>(null);
    const [failedPhotoKeys, setFailedPhotoKeys] = useState<Set<string>>(() => new Set());
    const inFlight = useRef(new Set<string>());
    const persistPlace = usePersistPlace();

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
        return () => clearTimeout(timer);
    }, [query]);

    const { results, isLoading, isPlacesError, refetch } = useRestaurantSearch(
        debouncedQuery,
        userId,
        null,
    );

    const sections = useMemo(
        () =>
            [
                { label: 'Your spots', rows: results.visited },
                { label: 'On Napkin', rows: results.onNapkin },
                { label: 'More places', rows: results.morePlaces },
            ].filter((section) => section.rows.length > 0),
        [results],
    );
    const visibleRows = useMemo(
        () => sections.flatMap((section) => section.rows),
        [sections],
    );
    const placesCredit = useMemo(
        () => deriveSearchPlacesCredits(visibleRows, failedPhotoKeys),
        [failedPhotoKeys, visibleRows],
    );

    const choose = useCallback(
        (row: SearchResultRow) => {
            const finish = (restaurantId: string) => {
                onPick({
                    restaurant_id: restaurantId,
                    name: row.name,
                    city: row.city,
                    cuisine: row.cuisine,
                });
            };

            if (row.id) {
                finish(row.id);
                return;
            }
            if (!row.placeId) return;

            const key = rowKey(row);
            if (inFlight.current.has(key)) return;
            inFlight.current.add(key);
            setResolvingKey(key);
            persistPlace.mutate(row.placeId, {
                onSuccess: finish,
                onError: () => Alert.alert('Could not add this place', 'Try again in a moment.'),
                onSettled: () => {
                    inFlight.current.delete(key);
                    setResolvingKey((current) => (current === key ? null : current));
                },
            });
        },
        [onPick, persistPlace],
    );

    const hasQuery = debouncedQuery.length >= 2;
    const hasResults = sections.length > 0;
    const imageOutline = scheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';

    return (
        <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable
                    onPress={onBack}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons name="chevron-back" size={24} color={palette.text} />
                </Pressable>
                <Text style={[Type.screenTitle, styles.title, { color: palette.text }]} numberOfLines={1}>
                    {title}
                </Text>
                <View style={styles.iconButton} />
            </View>

            <View style={[styles.search, { backgroundColor: palette.surfaceJournalLow }]}>
                <Ionicons name="search" size={20} color={palette.textMuted} />
                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="search restaurants"
                    placeholderTextColor={palette.textMuted}
                    style={[Type.body, styles.input, { color: palette.text }]}
                    autoFocus
                    autoCorrect={false}
                    returnKeyType="search"
                />
                {query ? (
                    <Pressable
                        onPress={() => setQuery('')}
                        style={styles.clearButton}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                    >
                        <Ionicons name="close-circle" size={20} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </View>

            {!hasQuery ? (
                <View style={styles.center}>
                    <Text style={[Type.body, { color: palette.textMuted }]}>Search for any restaurant.</Text>
                </View>
            ) : isLoading && !hasResults ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : (
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
                >
                    {placesCredit.credits.length > 0 ? (
                        <View style={styles.placesCredit}>
                            <PlacesCredit
                                credits={placesCredit.credits}
                                photoCount={placesCredit.photoCount}
                                testID="restaurant-picker-places-credit"
                            />
                        </View>
                    ) : null}
                    {sections.map((section) => (
                        <View key={section.label}>
                            <Text style={[Type.sectionKicker, styles.sectionLabel, { color: palette.textMuted }]}>
                                {section.label}
                            </Text>
                            {section.rows.map((row) => {
                                const key = rowKey(row);
                                const meta = [row.city ?? row.address, row.cuisine].filter(Boolean).join(' · ');
                                const photoUrl = resolveVisibleSearchResultPhoto(row, failedPhotoKeys).url;
                                const photoFailureKey = searchPhotoFailureKey(row, photoUrl);
                                return (
                                    <PressableScale
                                        key={key}
                                        onPress={() => choose(row)}
                                        disabled={resolvingKey != null}
                                        scaleTo={0.96}
                                        style={styles.row}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Choose ${row.name}`}
                                    >
                                        <View
                                            style={[
                                                styles.thumb,
                                                {
                                                    backgroundColor: palette.surfaceJournalHi,
                                                    borderColor: imageOutline,
                                                },
                                            ]}
                                        >
                                            {photoUrl ? (
                                                <Image
                                                    source={{ uri: photoUrl }}
                                                    style={StyleSheet.absoluteFill}
                                                    contentFit="cover"
                                                    onError={() => {
                                                        if (!photoFailureKey) return;
                                                        setFailedPhotoKeys(
                                                            (current) => new Set(current).add(photoFailureKey),
                                                        );
                                                    }}
                                                />
                                            ) : (
                                                <Ionicons name="restaurant-outline" size={20} color={palette.textMuted} />
                                            )}
                                        </View>
                                        <View style={styles.rowCopy}>
                                            <Text style={[Type.editorialBody, { color: palette.text }]} numberOfLines={1}>
                                                {row.name}
                                            </Text>
                                            {meta ? (
                                                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                                                    {meta}
                                                </Text>
                                            ) : null}
                                        </View>
                                        {resolvingKey === key ? (
                                            <ActivityIndicator size="small" color={palette.primary} />
                                        ) : (
                                            <Ionicons name="add" size={22} color={palette.primary} />
                                        )}
                                    </PressableScale>
                                );
                            })}
                        </View>
                    ))}
                    {!hasResults && !isLoading ? (
                        <Pressable onPress={isPlacesError ? refetch : undefined} style={styles.emptyResult}>
                            <Text style={[Type.body, { color: palette.textMuted, textAlign: 'center' }]}>
                                {isPlacesError ? 'Couldn’t reach search — tap to retry.' : `No results for “${debouncedQuery}”.`}
                            </Text>
                        </Pressable>
                    ) : null}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: {
        minHeight: 56,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: { flex: 1, textAlign: 'center' },
    iconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    search: {
        height: 48,
        marginHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
        paddingLeft: 14,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    input: { flex: 1, paddingVertical: 0 },
    clearButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: Spacing.xl,
    },
    sectionLabel: {
        paddingHorizontal: Spacing.lg,
        marginTop: Spacing.md,
        marginBottom: Spacing.xs,
    },
    placesCredit: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xs,
    },
    row: {
        minHeight: 68,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowCopy: { flex: 1, minWidth: 0 },
    emptyResult: { minHeight: 68, justifyContent: 'center', paddingHorizontal: Spacing.xl },
});
