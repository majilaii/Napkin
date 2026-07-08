/**
 * /table-map?tableId= — the table's territory, as geography (TICKET-139/143).
 *
 * Full-bleed WishlistMapView with the Map tab's chrome (TICKET-143 parity):
 *   - Source pills (top-left): Saved · Been together.
 *   - Filter chip (top-right): the shared FilterTabsSheet — cuisine/price/city
 *     over the active layer (Sort hidden: position is the signal on a map).
 *   - List pill (bottom-right, corner law v2 — locate FAB stacks above it): opens
 *     the active layer's ledger. Saved → the count-ranked table wishlist (reuses
 *     TableWishlistRow); Been → a simple gathered ledger, most recent first.
 *   - Peek carousel: the same WishlistMapView nearest-first carousel as the Map
 *     tab (shared component — nothing to wire).
 *
 * Layers:
 *   - Saved (default): TICKET-138's overlap mapper at minCount:1 over this one
 *     table (singles = terracotta save bubbles → peek "saved by «Name»"; ≥2 =
 *     amber count bubbles). Peek → gather here (prefills THIS table) / restaurant.
 *   - Been together: the table's group meals (suppers + legacy rounds) with
 *     coordinates — olive `been` pins + a "gathered <date>" peek. Lazy-armed.
 * Back lands on the table screen (hierarchical back doctrine).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useTableWishlist, type TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import { useTableMapPins } from '@/hooks/tables/useTableMapPins';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { WishlistMapView, type WishlistMapItem } from '@/components/wishlist/WishlistMapView';
import { overlapToMapItems, supperPinsToMapItems } from '@/components/wishlist/mapItems';
import {
    cuisineFacets,
    priceFacets,
    cityFacets,
    filterMapItems,
    sortGatheredRecent,
} from '@/components/wishlist/mapFacets';
import { FilterTabsSheet, TableWishlistRow } from '@/components/wishlist';
import type { FilterOption } from '@/components/wishlist/FilterActionSheet';
import { GatherSheet } from '@/components/gatherings';
import { priceTierLabel } from '@/lib/priceLevel';

type Palette = typeof Colors.light;

/** "12 jun" — lowercase gathered-date label (matches the peek's voice). */
function fmtShortDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return `${d.getDate()} ${mo}`;
}

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
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [listOpen, setListOpen] = useState(false);

    // Filters — cuisine/price/city over the active layer. Reset on layer switch
    // so a Saved-only cuisine never blanks the Been layer.
    const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
    const [priceFilter, setPriceFilter] = useState<string | null>(null);
    const [cityFilter, setCityFilter] = useState<string | null>(null);

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

    // The active layer's UNFILTERED items drive the facet option lists; the
    // FILTERED items drive the pins.
    const rawItems = layer === 'saved' ? savedItems : beenItems;
    const items = useMemo(
        () => filterMapItems(rawItems, { cuisine: cuisineFilter, price: priceFilter, city: cityFilter }),
        [rawItems, cuisineFilter, priceFilter, cityFilter],
    );

    const cuisineOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'All cuisines' },
            ...cuisineFacets(rawItems).map((c) => ({ value: c.value, label: c.value, count: c.count })),
        ],
        [rawItems],
    );
    const priceOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'Any price' },
            ...priceFacets(rawItems).map((p) => ({
                value: String(p.value),
                label: priceTierLabel(p.value),
                count: p.count,
            })),
        ],
        [rawItems],
    );
    const cityOptions = useMemo<FilterOption[]>(
        () => [
            { value: null, label: 'All cities' },
            ...cityFacets(rawItems).map((c) => ({ value: c.value, label: c.value, count: c.count })),
        ],
        [rawItems],
    );
    const hideAreaTab = cityFacets(rawItems).length < 2;
    const filtersActive = !!cuisineFilter || !!priceFilter || !!cityFilter;

    // The List sheet's ledgers: Saved = the full count-ranked table wishlist (the
    // canonical ledger from the table screen's Wishlist tab); Been = the mapped
    // gatherings, most recent first.
    const savedLedger = tableWishlist ?? [];
    const beenLedger = useMemo(() => sortGatheredRecent(beenItems), [beenItems]);

    const handleSource = useCallback((key: string) => {
        const next = key as 'saved' | 'been';
        setLayer(next);
        if (next === 'been') setBeenArmed(true);
        // Reset filters — cuisines/prices don't carry across layers.
        setCuisineFilter(null);
        setPriceFilter(null);
        setCityFilter(null);
    }, []);

    const openRestaurant = useCallback(
        (id: string) => router.push({ pathname: '/restaurant/[id]', params: { id } }),
        [router],
    );

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <WishlistMapView
                items={items}
                unmappableCount={0}
                userCoords={coords}
                locationStatus={status}
                onRequestLocation={request}
                onOpenRestaurant={openRestaurant}
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
                // Filter chip (top-right) + List pill (bottom-right, corner law v2).
                onOpenFilters={() => setFiltersOpen(true)}
                filtersActive={filtersActive}
                onSwitchToList={() => setListOpen(true)}
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

            {/* Filter chip → the shared tabbed sheet. Sort hidden (map: position is
                the signal); Area hides with <2 cities. */}
            <FilterTabsSheet
                visible={filtersOpen}
                onDismiss={() => setFiltersOpen(false)}
                palette={palette}
                hideSort
                hideArea={hideAreaTab}
                cuisine={{ options: cuisineOptions, selected: cuisineFilter, onSelect: setCuisineFilter }}
                price={{ options: priceOptions, selected: priceFilter, onSelect: setPriceFilter }}
                area={{ options: cityOptions, selected: cityFilter, onSelect: setCityFilter }}
                sort={{ options: [], selected: null, onSelect: () => undefined }}
            />

            {/* List pill → the active layer's ledger. */}
            <ListSheet
                visible={listOpen}
                onClose={() => setListOpen(false)}
                palette={palette}
                layer={layer}
                savedRows={savedLedger}
                beenRows={beenLedger}
                onOpenRestaurant={(id) => {
                    setListOpen(false);
                    openRestaurant(id);
                }}
            />

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

// ── List sheet — the active layer's ledger ──────────────────────────────────

function ListSheet({
    visible,
    onClose,
    palette,
    layer,
    savedRows,
    beenRows,
    onOpenRestaurant,
}: {
    visible: boolean;
    onClose: () => void;
    palette: Palette;
    layer: 'saved' | 'been';
    savedRows: TableWishlistItem[];
    beenRows: WishlistMapItem[];
    onOpenRestaurant: (id: string) => void;
}) {
    const insets = useSafeAreaInsets();
    const empty = layer === 'saved' ? savedRows.length === 0 : beenRows.length === 0;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Pressable
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + Spacing.lg },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />
                    <Text style={[styles.listKicker, { color: palette.textMuted }]}>
                        {layer === 'saved' ? 'the table wishlist' : 'been together'}
                    </Text>

                    <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                        {empty ? (
                            <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                                {layer === 'saved'
                                    ? 'no one has saved a spot yet.'
                                    : 'no gatherings on the map yet.'}
                            </Text>
                        ) : layer === 'saved' ? (
                            savedRows.map((it, i) =>
                                it.restaurant ? (
                                    <TableWishlistRow
                                        key={it.restaurant.id}
                                        index={i + 1}
                                        item={it}
                                        palette={palette}
                                        onPress={() => onOpenRestaurant(it.restaurant!.id)}
                                    />
                                ) : null,
                            )
                        ) : (
                            beenRows.map((it) => (
                                <GatheredRow
                                    key={it.id}
                                    item={it}
                                    palette={palette}
                                    onPress={() => onOpenRestaurant(it.id)}
                                />
                            ))
                        )}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/** One gathered place — name serif italic · gathered <date> · participants. */
function GatheredRow({
    item,
    palette,
    onPress,
}: {
    item: WishlistMapItem;
    palette: Palette;
    onPress: () => void;
}) {
    const g = item.gathered;
    const people = g?.participants?.length ?? 0;
    const meta = [
        g ? `gathered ${fmtShortDate(g.on)}` : null,
        people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.gatheredRow,
                { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityLabel={`Open ${item.name}`}
        >
            <View style={styles.gatheredText}>
                <Text style={[styles.gatheredName, { color: palette.text }]} numberOfLines={1}>
                    {item.name}
                </Text>
                {meta ? (
                    <Text style={[styles.gatheredMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </Pressable>
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

    // List sheet
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(74,55,42,0.25)',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: 8,
        paddingHorizontal: 22,
        maxHeight: '80%',
    },
    grabber: {
        width: 40,
        height: 5,
        borderRadius: Radius.sm,
        alignSelf: 'center',
        opacity: 0.5,
        marginBottom: 10,
    },
    listKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.9,
        textTransform: 'uppercase',
        marginBottom: 6,
    },
    listScroll: {
        marginTop: 2,
    },
    emptyLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
        paddingVertical: 24,
    },
    gatheredRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    gatheredText: {
        flex: 1,
        minWidth: 0,
    },
    gatheredName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        letterSpacing: -0.3,
    },
    gatheredMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
});
