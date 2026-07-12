/**
 * DiningMapPreview — the Beli move: your eating history as geography.
 * A quiet 120px map card fitted to the user's been-pins, cream-washed like
 * MapHero, tap → the full dining map. Renders nothing without ≥1 mappable spot.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';

import { Colors, Spacing, Type } from '@/constants/theme';
import { SectionHeader } from './SectionHeader';
import type { SpotSummary } from '@/hooks/users/useUserSpots';

interface Props {
    spots: SpotSummary[];
    onPress: () => void;
    palette: typeof Colors.light;
}

const CREAM = '#fdf6ec';

export function DiningMapPreview({ spots, onPress, palette }: Props) {
    const pins = useMemo(
        () => spots.filter((s) => s.lat != null && s.lng != null),
        [spots],
    );

    const region = useMemo(() => {
        if (pins.length === 0) return null;
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of pins) {
            minLat = Math.min(minLat, p.lat!);
            maxLat = Math.max(maxLat, p.lat!);
            minLng = Math.min(minLng, p.lng!);
            maxLng = Math.max(maxLng, p.lng!);
        }
        return {
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            // Clamped: meals on two continents would otherwise compute deltas
            // outside MKCoordinateRegion's meaningful range.
            latitudeDelta: Math.min(Math.max((maxLat - minLat) * 1.5, 0.04), 100),
            longitudeDelta: Math.min(Math.max((maxLng - minLng) * 1.5, 0.04), 180),
        };
    }, [pins]);

    if (!region) return null;

    return (
        <View>
            <SectionHeader title="Dining map" />
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: palette.card, opacity: pressed ? 0.9 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Dining map, ${pins.length} places`}
            >
                <View style={styles.mapWrap} pointerEvents="none">
                    <MapView
                        style={StyleSheet.absoluteFill}
                        provider={Platform.OS === 'ios' ? PROVIDER_DEFAULT : PROVIDER_GOOGLE}
                        // Maps never go dark — Apple tiles follow the SYSTEM
                        // appearance, not the light-forced palette (2026-07-08).
                        userInterfaceStyle="light"
                        initialRegion={region}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        rotateEnabled={false}
                        pitchEnabled={false}
                        showsPointsOfInterest={false}
                        showsCompass={false}
                    >
                        {pins.map((p) => (
                            <Marker
                                key={p.restaurant_id}
                                coordinate={{ latitude: p.lat!, longitude: p.lng! }}
                                anchor={{ x: 0.5, y: 0.5 }}
                                tracksViewChanges={false}
                            >
                                <View style={[styles.dot, { backgroundColor: palette.primary }]} />
                            </Marker>
                        ))}
                    </MapView>
                    {/* Warm wash so the map sits inside the paper world */}
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: CREAM, opacity: 0.28 }]} />
                </View>
                <View style={styles.metaRow}>
                    <Text style={[styles.count, { color: palette.textMuted }]}>
                        {`${pins.length} ${pins.length === 1 ? 'place' : 'places'}  ›`}
                    </Text>
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: Spacing.lg,
        borderRadius: 16,
        overflow: 'hidden',
    },
    mapWrap: {
        height: 120,
    },
    dot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
        borderWidth: 1.5,
        borderColor: '#fffdf8',
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        minHeight: 44,
    },
    count: {
        ...Type.metadata,
        marginLeft: 'auto',
    },
});
