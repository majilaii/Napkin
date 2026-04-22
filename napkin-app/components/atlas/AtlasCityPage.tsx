/**
 * AtlasCityPage — full city deep-dive screen content.
 *
 * Layout:
 *   1. Page header (chevron + italic city name + meta micro-line)
 *   2. Scope pills — "everyone · [Clara] · [Thomas] · [you]"
 *   3. Sort + view toggle row  (grid default, map toggle)
 *   4a. Grid view — AtlasGridView
 *   4b. Map view  — AtlasMapView + AtlasLegend + AtlasPeekStrip
 *       Peek sheet rises on pin/card tap.
 *
 * Phase 2: view toggle fully wired. Scope pills and sort persist across views.
 * Wireframe: atlas-canvas.html — artboards 03/04.
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    RefreshControl,
    ActivityIndicator,
    Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { PressableScale } from '@/components/ui/napkin';
import { AtlasGridView } from './AtlasGridView';
import { AtlasEmptyState } from './AtlasEmptyState';
import { AtlasMapView, AtlasMapViewRef } from './AtlasMapView';
import { AtlasLegend } from './AtlasLegend';
import { AtlasPeekSheet } from './AtlasPeekSheet';
import type { TableAtlasCityData, AtlasRestaurantTile } from '@/hooks/tables/useTableAtlasCity';

export type SortOrder = 'most_recent' | 'top_rated';

interface ScopePillDef {
    id: string | 'everyone';
    label: string;
    avatarUrl?: string | null;
}

interface Props {
    data: TableAtlasCityData;
    currentUserId: string;
    /** Table members to build scope pills from */
    members: Array<{
        user_id: string;
        display_name: string;
        avatar_url?: string | null;
    }>;
    onBack: () => void;
    onRestaurantPress: (restaurantId: string) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    isLoading?: boolean;
    palette?: typeof Colors.light;
}

// ── AtlasPeekStrip ────────────────────────────────────────────────────────────
// Horizontal scroll of 80px mini-cards beneath the map.
// Tapping a card: flies camera to that pin AND opens peek sheet.

interface PeekStripProps {
    tiles: AtlasRestaurantTile[];
    palette: typeof Colors.light;
    onCardPress: (tile: AtlasRestaurantTile) => void;
}

function AtlasPeekStrip({ tiles, palette, onCardPress }: PeekStripProps) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peekStripContent}
            style={styles.peekStrip}
        >
            {tiles.map((tile) => {
                const ratingStr =
                    tile.rating != null
                        ? tile.rating % 1 === 0
                            ? `${tile.rating}`
                            : `${tile.rating}`
                        : '—';

                return (
                    <PressableScale
                        key={tile.id}
                        onPress={() => onCardPress(tile)}
                        haptic="selection"
                        scaleTo={0.97}
                    >
                        <View
                            style={[
                                styles.peekCard,
                                { backgroundColor: palette.surfaceContainerLow },
                            ]}
                        >
                            {/* Photo or placeholder */}
                            <View
                                style={[
                                    styles.peekPhoto,
                                    { backgroundColor: palette.surfaceContainerHigh },
                                ]}
                            >
                                {tile.photo_url ? (
                                    <Image
                                        source={{ uri: tile.photo_url }}
                                        style={StyleSheet.absoluteFillObject}
                                        resizeMode="cover"
                                    />
                                ) : null}
                                {/* Image outline */}
                                <View style={styles.imgOutline} />
                                {/* Round chip overlay */}
                                {tile.tile_type !== 'solo' && (
                                    <View
                                        style={[
                                            styles.peekChip,
                                            { backgroundColor: palette.amberChipHi },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.peekChipText,
                                                { color: palette.amberInk },
                                            ]}
                                        >
                                            {tile.tile_type === 'mixed' ? 'mixed' : 'round'}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {/* Meta below photo */}
                            <View style={styles.peekMeta}>
                                <Text
                                    style={[styles.peekName, { color: palette.text }]}
                                    numberOfLines={1}
                                >
                                    {tile.name}
                                </Text>
                                <View style={styles.peekRow}>
                                    <Text
                                        style={[styles.peekCount, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                    >
                                        {tile.tile_type === 'round' || tile.tile_type === 'mixed'
                                            ? `${tile.member_names.length} of us`
                                            : tile.member_names[0] ?? ''}
                                    </Text>
                                    <Text
                                        style={[styles.peekRating, { color: palette.star }]}
                                    >
                                        {ratingStr}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </PressableScale>
                );
            })}
        </ScrollView>
    );
}

// ── AtlasCityPage ─────────────────────────────────────────────────────────────

export function AtlasCityPage({
    data,
    currentUserId,
    members,
    onBack,
    onRestaurantPress,
    onRefresh,
    isRefreshing = false,
    isLoading = false,
    palette: paletteProp,
}: Props) {
    const palette = paletteProp ?? Colors.light;

    const [selectedScope, setSelectedScope] = useState<string>('everyone');
    const [sortOrder, setSortOrder] = useState<SortOrder>('most_recent');
    const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');

    // Peek sheet state
    const [peekRestaurant, setPeekRestaurant] = useState<AtlasRestaurantTile | null>(null);
    const [sheetVisible, setSheetVisible] = useState(false);

    // Map ref for camera control
    const mapRef = useRef<AtlasMapViewRef>(null);

    // Build scope pills from members
    const scopePills: ScopePillDef[] = useMemo(() => {
        const pills: ScopePillDef[] = [{ id: 'everyone', label: 'everyone' }];
        for (const m of members) {
            const label = m.user_id === currentUserId ? 'you' : m.display_name;
            pills.push({ id: m.user_id, label, avatarUrl: m.avatar_url });
        }
        return pills;
    }, [members, currentUserId]);

    // Filter tiles by scope (shared between grid + map)
    const filteredTiles = useMemo<AtlasRestaurantTile[]>(() => {
        if (!data?.restaurants) return [];
        if (selectedScope === 'everyone') return data.restaurants;
        return data.restaurants.filter(
            (t) =>
                t.member_ids.includes(selectedScope) ||
                t.companion_ids.includes(selectedScope),
        );
    }, [data?.restaurants, selectedScope]);

    // Sort tiles (applies to grid order + peek-strip order; pin positions unchanged)
    const sortedTiles = useMemo<AtlasRestaurantTile[]>(() => {
        if (sortOrder === 'top_rated') {
            return [...filteredTiles].sort((a, b) => {
                const ar = a.rating ?? -1;
                const br = b.rating ?? -1;
                return br - ar;
            });
        }
        return [...filteredTiles].sort((a, b) => {
            const ad = a.visits[0]?.date ?? '';
            const bd = b.visits[0]?.date ?? '';
            return bd.localeCompare(ad);
        });
    }, [filteredTiles, sortOrder]);

    const toggleSort = useCallback(() => {
        setSortOrder((prev) => (prev === 'most_recent' ? 'top_rated' : 'most_recent'));
    }, []);

    const sortLabel = sortOrder === 'most_recent' ? 'most recent' : 'top rated';

    // Peek sheet handlers
    const openPeekSheet = useCallback((restaurant: AtlasRestaurantTile) => {
        setPeekRestaurant(restaurant);
        setSheetVisible(true);
    }, []);

    const closePeekSheet = useCallback(() => {
        setSheetVisible(false);
        // Keep restaurant in state until animation completes
        setTimeout(() => setPeekRestaurant(null), 300);
    }, []);

    // Pin press: fly camera + open sheet
    const handlePinPress = useCallback(
        (restaurant: AtlasRestaurantTile) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (restaurant.lat != null && restaurant.lng != null) {
                mapRef.current?.animateToPin(restaurant.lat, restaurant.lng);
            }
            openPeekSheet(restaurant);
        },
        [openPeekSheet],
    );

    // Peek strip card press: fly camera + open sheet
    const handlePeekCardPress = useCallback(
        (tile: AtlasRestaurantTile) => {
            if (tile.lat != null && tile.lng != null) {
                mapRef.current?.animateToPin(tile.lat, tile.lng);
            }
            openPeekSheet(tile);
        },
        [openPeekSheet],
    );

    const { city, city_stats } = data;
    const metaLine = `${city_stats.spot_count} spot${city_stats.spot_count !== 1 ? 's' : ''} · ${city_stats.member_count} of us`;

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {/* ── Header ── */}
            <View style={styles.header}>
                <PressableScale onPress={onBack} haptic="light" scaleTo={0.96}>
                    <View style={styles.backBtn}>
                        <Ionicons name="chevron-back" size={24} color={palette.textSecondary} />
                    </View>
                </PressableScale>

                <View style={styles.titleBlock}>
                    <Text style={[styles.cityName, { color: palette.text }]}>{city}</Text>
                    <Text style={[styles.metaLine, { color: palette.textMuted }]}>
                        {metaLine}
                    </Text>
                </View>
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={
                    onRefresh ? (
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={onRefresh}
                            tintColor={palette.primary}
                        />
                    ) : undefined
                }
            >
                {/* ── Scope pills ── */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.scopeRow}
                >
                    {scopePills.map((pill) => {
                        const isActive = selectedScope === pill.id;
                        return (
                            <PressableScale
                                key={pill.id}
                                onPress={() => setSelectedScope(pill.id)}
                                haptic="selection"
                                scaleTo={0.96}
                            >
                                <View
                                    style={[
                                        styles.scopePill,
                                        {
                                            backgroundColor: isActive
                                                ? palette.primary
                                                : 'rgba(250,240,224,0.8)',
                                            shadowColor: palette.outlineVariant,
                                        },
                                        !isActive && {
                                            borderWidth: 1,
                                            borderColor: 'rgba(221,192,186,0.35)',
                                        },
                                    ]}
                                >
                                    {pill.id !== 'everyone' && (
                                        <View
                                            style={[
                                                styles.miniAv,
                                                {
                                                    backgroundColor: isActive
                                                        ? 'rgba(253,246,236,0.22)'
                                                        : '#d4c4b0',
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.miniAvInitial,
                                                    {
                                                        color: isActive
                                                            ? '#fdf6ec'
                                                            : palette.textSecondary,
                                                    },
                                                ]}
                                            >
                                                {pill.label.slice(0, 1).toUpperCase()}
                                            </Text>
                                        </View>
                                    )}
                                    <Text
                                        style={[
                                            styles.pillLabel,
                                            {
                                                color: isActive
                                                    ? palette.background
                                                    : palette.text,
                                            },
                                        ]}
                                    >
                                        {pill.label}
                                    </Text>
                                </View>
                            </PressableScale>
                        );
                    })}
                </ScrollView>

                {/* ── Sort + view toggle row ── */}
                <View style={styles.sortRow}>
                    <Pressable onPress={toggleSort} style={styles.sortBtn}>
                        <Text style={[styles.sortLabel, { color: palette.textSecondary }]}>
                            {sortLabel}
                        </Text>
                        <Ionicons
                            name="chevron-down"
                            size={14}
                            color={palette.textSecondary}
                        />
                    </Pressable>

                    <View style={[styles.viewToggle, { backgroundColor: 'rgba(250,240,224,0.6)' }]}>
                        {/* Grid button */}
                        <Pressable
                            onPress={() => setViewMode('grid')}
                            style={[
                                styles.viewBtn,
                                viewMode === 'grid' && [
                                    styles.viewBtnActive,
                                    { backgroundColor: palette.background },
                                ],
                            ]}
                        >
                            <Ionicons
                                name="grid-outline"
                                size={18}
                                color={viewMode === 'grid' ? palette.primary : palette.textMuted}
                            />
                        </Pressable>
                        {/* Map button */}
                        <Pressable
                            onPress={() => setViewMode('map')}
                            style={[
                                styles.viewBtn,
                                viewMode === 'map' && [
                                    styles.viewBtnActive,
                                    { backgroundColor: palette.background },
                                ],
                            ]}
                        >
                            <Ionicons
                                name="map-outline"
                                size={18}
                                color={viewMode === 'map' ? palette.primary : palette.textMuted}
                            />
                        </Pressable>
                    </View>
                </View>

                {/* ── Content ── */}
                {isLoading ? (
                    <ActivityIndicator
                        color={palette.primary}
                        style={{ marginTop: Spacing.xxl }}
                    />
                ) : sortedTiles.length === 0 ? (
                    <AtlasEmptyState palette={palette} />
                ) : viewMode === 'grid' ? (
                    <AtlasGridView
                        tiles={sortedTiles}
                        onTilePress={onRestaurantPress}
                        palette={palette}
                    />
                ) : (
                    /* ── Map view ── */
                    <View>
                        <AtlasMapView
                            ref={mapRef}
                            restaurants={filteredTiles}
                            onPinPress={handlePinPress}
                            palette={palette}
                            mapHeight={340}
                        />

                        <AtlasLegend palette={palette} />

                        <AtlasPeekStrip
                            tiles={sortedTiles}
                            palette={palette}
                            onCardPress={handlePeekCardPress}
                        />
                    </View>
                )}
            </ScrollView>

            {/* ── Peek sheet (modal, outside scroll) ── */}
            <AtlasPeekSheet
                visible={sheetVisible}
                restaurant={peekRestaurant}
                city={city}
                currentUserId={currentUserId}
                palette={palette}
                onClose={closePeekSheet}
            />
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: 14,
        gap: 10,
    },
    backBtn: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -8,
        marginTop: 2,
    },
    titleBlock: {
        flex: 1,
    },
    cityName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        letterSpacing: -0.4,
        lineHeight: 32,
    },
    metaLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.2,
        marginTop: 3,
        fontVariant: ['tabular-nums'],
    },
    scopeRow: {
        paddingHorizontal: 20,
        paddingVertical: 14,
        gap: 8,
        paddingBottom: 8,
    },
    scopePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 40,
        borderRadius: Radius.full,
    },
    miniAv: {
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    miniAvInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 9,
        lineHeight: 11,
    },
    pillLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    sortRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 8,
        paddingBottom: 10,
    },
    sortBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 10,
        paddingHorizontal: 8,
        minHeight: 40,
        marginLeft: -8,
    },
    sortLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    viewToggle: {
        flexDirection: 'row',
        gap: 2,
        borderRadius: 10,
        padding: 3,
    },
    viewBtn: {
        width: 40,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
    },
    viewBtnActive: {
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },

    // ── Peek strip ────────────────────────────────────────────────────────────
    peekStrip: {
        marginTop: 4,
        marginBottom: Spacing.md,
    },
    peekStripContent: {
        paddingHorizontal: 20,
        paddingVertical: 6,
        gap: 10,
    },
    peekCard: {
        width: 130,
        borderRadius: 10,
        overflow: 'hidden',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
    },
    peekPhoto: {
        height: 80,
        position: 'relative',
    },
    imgOutline: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 0,
        borderWidth: 0,
        // CSS: inset 0 0 0 1px rgba(0,0,0,0.08)
        // In RN we render as an overlay with borderWidth inside
        borderColor: 'rgba(0,0,0,0.08)',
    },
    peekChip: {
        position: 'absolute',
        top: 6,
        right: 6,
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 4,
    },
    peekChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 8,
        letterSpacing: 0.8,
    },
    peekMeta: {
        padding: 8,
    },
    peekName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 15,
        marginBottom: 3,
    },
    peekRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 4,
    },
    peekCount: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        flex: 1,
    },
    peekRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
});

export default AtlasCityPage;
