/**
 * AtlasCityPage — full city deep-dive screen content.
 *
 * Layout:
 *   1. Page header (chevron + italic city name + meta micro-line)
 *   2. Scope pills — "everyone · [Clara] · [Thomas] · [you]"
 *   3. Sort + view toggle row
 *   4. Grid view (default) — AtlasGridView
 *   (Map view is Phase 2)
 *
 * Scope pills and sort persist when toggling views.
 * Filtering by scope pill = filter tiles to those that have the selected
 * user_id in tile.member_ids (or companion_ids).
 *
 * Wireframe: atlas-canvas.html — city page artboard
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    RefreshControl,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin';
import { AtlasGridView } from './AtlasGridView';
import { AtlasEmptyState } from './AtlasEmptyState';
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
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];

    const [selectedScope, setSelectedScope] = useState<string>('everyone');
    const [sortOrder, setSortOrder] = useState<SortOrder>('most_recent');
    // Phase 2: view toggle. Grid only in Phase 1.
    // const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');

    // Build scope pills from members
    const scopePills: ScopePillDef[] = useMemo(() => {
        const pills: ScopePillDef[] = [{ id: 'everyone', label: 'everyone' }];
        for (const m of members) {
            const label = m.user_id === currentUserId ? 'you' : m.display_name;
            pills.push({ id: m.user_id, label, avatarUrl: m.avatar_url });
        }
        return pills;
    }, [members, currentUserId]);

    // Filter tiles by scope
    const filteredTiles = useMemo<AtlasRestaurantTile[]>(() => {
        if (!data?.restaurants) return [];
        if (selectedScope === 'everyone') return data.restaurants;
        return data.restaurants.filter(
            (t) =>
                t.member_ids.includes(selectedScope) ||
                t.companion_ids.includes(selectedScope),
        );
    }, [data?.restaurants, selectedScope]);

    // Sort tiles
    const sortedTiles = useMemo<AtlasRestaurantTile[]>(() => {
        if (sortOrder === 'top_rated') {
            return [...filteredTiles].sort((a, b) => {
                const ar = a.rating ?? -1;
                const br = b.rating ?? -1;
                return br - ar;
            });
        }
        // most_recent — already sorted by edge function, but re-sort to be safe
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

    const { city, city_stats } = data;
    const metaLine = `${city_stats.spot_count} spot${city_stats.spot_count !== 1 ? 's' : ''} · ${city_stats.member_count} of us`;

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {/* Header */}
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
                {/* Scope pills */}
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
                                        />
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

                {/* Sort + view toggle row */}
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

                    {/* View toggle — grid only in Phase 1 */}
                    <View style={[styles.viewToggle, { backgroundColor: 'rgba(250,240,224,0.6)' }]}>
                        <View
                            style={[
                                styles.viewBtn,
                                styles.viewBtnActive,
                                { backgroundColor: palette.background },
                            ]}
                        >
                            <Ionicons
                                name="grid-outline"
                                size={18}
                                color={palette.primary}
                            />
                        </View>
                        {/* Map button — disabled until Phase 2 */}
                        <View style={[styles.viewBtn, { opacity: 0.4 }]}>
                            <Ionicons
                                name="map-outline"
                                size={18}
                                color={palette.textMuted}
                            />
                        </View>
                    </View>
                </View>

                {/* Content */}
                {isLoading ? (
                    <ActivityIndicator
                        color={palette.primary}
                        style={{ marginTop: Spacing.xxl }}
                    />
                ) : sortedTiles.length === 0 ? (
                    <AtlasEmptyState palette={palette} />
                ) : (
                    <AtlasGridView
                        tiles={sortedTiles}
                        onTilePress={onRestaurantPress}
                        palette={palette}
                    />
                )}
            </ScrollView>
        </View>
    );
}

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
});

export default AtlasCityPage;
