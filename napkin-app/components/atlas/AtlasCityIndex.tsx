/**
 * AtlasCityIndex — entry view for the Atlas sub-tab.
 *
 * Renders:
 *   1. Stat line — "4 of us · 7 cities · 52 spots · since Mar 2025"
 *   2. 2-column photo masonry of CityCards (staggered heights)
 *
 * Wireframe: atlas-canvas.html — stat-line + city-masonry
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CityCard } from './CityCard';
import { AtlasEmptyState } from './AtlasEmptyState';
import type { TableAtlasData } from '@/hooks/tables/useTableAtlas';

const LEFT_HEIGHTS = [200, 175, 210, 185, 195];
const RIGHT_HEIGHTS = [175, 200, 185, 210, 170];

interface Props {
    data: TableAtlasData;
    onCityPress: (cityName: string) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    palette?: typeof Colors.light;
}

function formatFounded(isoDate: string | null): string {
    if (!isoDate) return '';
    return new Date(isoDate).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
    });
}

export function AtlasCityIndex({
    data,
    onCityPress,
    onRefresh,
    isRefreshing = false,
    palette: paletteProp,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];

    const { stats, cities } = data;
    const foundedLabel = formatFounded(stats.founded_at);

    // Stat line pieces
    const statParts = [
        `${stats.members} of us`,
        `${stats.cities} cit${stats.cities !== 1 ? 'ies' : 'y'}`,
        `${stats.spots} spot${stats.spots !== 1 ? 's' : ''}`,
        ...(foundedLabel ? [`since ${foundedLabel}`] : []),
    ];

    // Split into two staggered columns
    const { leftCol, rightCol } = useMemo(() => {
        const left = cities.filter((_, i) => i % 2 === 0);
        const right = cities.filter((_, i) => i % 2 !== 0);
        return { leftCol: left, rightCol: right };
    }, [cities]);

    if (cities.length === 0) {
        return (
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
                <AtlasEmptyState palette={palette} />
            </ScrollView>
        );
    }

    return (
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
            {/* Stat line */}
            <View style={styles.statLine}>
                <Text style={[styles.statText, { color: palette.textMuted }]}>
                    {statParts.map((part, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <Text style={styles.dot}> · </Text>}
                            {part}
                        </React.Fragment>
                    ))}
                </Text>
            </View>

            {/* 2-col masonry */}
            <View style={styles.masonry}>
                <View style={styles.col}>
                    {leftCol.map((city, i) => (
                        <View key={city.name} style={styles.cardWrap}>
                            <CityCard
                                city={city}
                                onPress={() => onCityPress(city.name)}
                                heroHeight={LEFT_HEIGHTS[i % LEFT_HEIGHTS.length]}
                                palette={palette}
                            />
                        </View>
                    ))}
                </View>

                <View style={styles.col}>
                    {rightCol.map((city, i) => (
                        <View key={city.name} style={styles.cardWrap}>
                            <CityCard
                                city={city}
                                onPress={() => onCityPress(city.name)}
                                heroHeight={RIGHT_HEIGHTS[i % RIGHT_HEIGHTS.length]}
                                palette={palette}
                            />
                        </View>
                    ))}
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    statLine: {
        paddingHorizontal: Spacing.lg,
        paddingTop: 14,
        paddingBottom: 12,
    },
    statText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.2,
        fontVariant: ['tabular-nums'],
    },
    dot: {
        fontFamily: 'Manrope_400Regular',
    },
    masonry: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 20,
        gap: 10,
    },
    col: {
        flex: 1,
        gap: 10,
    },
    cardWrap: {
        // No extra style needed
    },
});

export default AtlasCityIndex;
