/**
 * /table-map?tableId= — the table's territory, as geography (TICKET-139).
 *
 * Full-bleed WishlistMapView (the dining-map chrome family: locate FAB at the
 * plain bottom-right corner, no List pill, no people chip) with two layers:
 *   - Saved (default): the table's overlap wishlist — TICKET-138's mapper at
 *     minCount:1 over this one table (singles = terracotta save bubbles tagged to
 *     the saver via peek; ≥2 = amber count bubbles). Peek → gather here (prefills
 *     THIS table) / View restaurant.
 *   - Been together: the table's group meals (suppers + legacy rounds) with
 *     coordinates — olive `been` pins + a "gathered <date>" peek. Lazy-armed.
 * Back lands on the table screen (hierarchical back doctrine).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useTableWishlist } from '@/hooks/wishlist/useTableWishlist';
import { useTableMapPins } from '@/hooks/tables/useTableMapPins';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { WishlistMapView, type WishlistMapItem } from '@/components/wishlist/WishlistMapView';
import { overlapToMapItems, supperPinsToMapItems } from '@/components/wishlist/mapItems';
import { GatherSheet } from '@/components/gatherings';

export default function TableMapScreen() {
    const { tableId } = useLocalSearchParams<{ tableId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const [layer, setLayer] = useState<'saved' | 'been'>('saved');
    const [beenArmed, setBeenArmed] = useState(false);
    const [gatherItem, setGatherItem] = useState<WishlistMapItem | null>(null);

    const { data: memberships } = useTables(user?.id);
    const tableName = useMemo(
        () =>
            (memberships ?? [])
                .map((m) => m.tables)
                .find((t) => t?.id === tableId)?.name ?? 'the table',
        [memberships, tableId],
    );

    // Saved source (already carries lat/lng after TICKET-138's list_table change).
    const { data: tableWishlist } = useTableWishlist(tableId);
    // Been-together source — lazy-armed on the first "Been together" select.
    const { data: beenPins } = useTableMapPins(tableId, { enabled: beenArmed });
    const { coords, status, request } = useNearbyLocation();

    // Singles kept (minCount 1) — 138's overlap mapper over this one table.
    const savedItems = useMemo(
        () =>
            overlapToMapItems([{ tableId: tableId ?? '', tableName, items: tableWishlist ?? [] }], {
                minCount: 1,
            }),
        [tableWishlist, tableId, tableName],
    );
    const beenItems = useMemo(() => supperPinsToMapItems(beenPins), [beenPins]);
    const items = layer === 'saved' ? savedItems : beenItems;

    const handleSource = useCallback((key: string) => {
        const next = key as 'saved' | 'been';
        setLayer(next);
        if (next === 'been') setBeenArmed(true);
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <WishlistMapView
                items={items}
                unmappableCount={0}
                userCoords={coords}
                locationStatus={status}
                onRequestLocation={request}
                onOpenRestaurant={(id) => router.push({ pathname: '/restaurant/[id]', params: { id } })}
                // Saved-layer overlap peeks prefill THIS table.
                onGather={(item) => setGatherItem(item)}
                sources={{
                    options: [
                        { key: 'saved', label: 'Saved' },
                        { key: 'been', label: 'Been together' },
                    ],
                    value: layer,
                    onChange: handleSource,
                }}
                // No onSwitchToList (FAB drops to the corner), no peopleChip.
                chromeTopOffset={insets.top + 56}
                palette={palette}
            />

            {/* Frosted back — lands on the table screen (hierarchical). */}
            <Pressable
                onPress={() => router.back()}
                style={[styles.back, { top: insets.top + 8, backgroundColor: 'rgba(253,246,236,0.92)' }]}
                hitSlop={10}
                accessibilityLabel="back"
            >
                <Ionicons name="chevron-back" size={20} color={palette.text} />
            </Pressable>

            <View style={[styles.titleChip, { top: insets.top + 12, backgroundColor: 'rgba(253,246,236,0.92)' }]}>
                <Text style={[styles.titleText, { color: palette.text }]} numberOfLines={1}>
                    {tableName}
                </Text>
            </View>

            {/* "gather here" from a saved-layer overlap peek → propose a date to
                THIS table. No photo_url; 409 ALREADY_PROPOSED owned by the sheet. */}
            <GatherSheet
                visible={gatherItem !== null}
                onClose={() => setGatherItem(null)}
                restaurant={{
                    id: gatherItem?.id,
                    name: gatherItem?.name ?? '',
                    city: gatherItem?.city ?? null,
                }}
                tableId={tableId ?? null}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    back: {
        position: 'absolute',
        left: 14,
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleChip: {
        position: 'absolute',
        alignSelf: 'center',
        maxWidth: '62%',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
    },
    titleText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16 },
});
