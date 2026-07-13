import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MapView, {
    Marker,
    PROVIDER_DEFAULT,
    PROVIDER_GOOGLE,
    type Region,
} from 'react-native-maps';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { heirloomMapStyle } from '@/constants/mapStyle';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ListEntry } from '@/hooks/lists/useList';
import { buildListMapPins } from './listMapItems';

type Palette = typeof Colors.light;

interface Props {
    entries: ListEntry[];
    ranked: boolean;
    topInset: number;
    palette: Palette;
    scheme: 'light' | 'dark';
    onBack: () => void;
    onRestaurantPress: (restaurantId: string) => void;
}

const HERO_HEIGHT = 370;
const FIT_PADDING = { top: 88, right: 52, bottom: 88, left: 52 };

export function ListMapHero({
    entries,
    ranked,
    topInset,
    palette,
    scheme,
    onBack,
    onRestaurantPress,
}: Props) {
    const mapRef = useRef<MapView>(null);
    const [mapReady, setMapReady] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const pins = useMemo(() => buildListMapPins(entries, ranked), [entries, ranked]);
    const cover = entries.find((entry) => !!entry.restaurant.photo_url)?.restaurant.photo_url ?? null;
    const selected = pins.find((pin) => pin.restaurantId === selectedId) ?? null;
    const pinKey = pins.map((pin) => pin.id).join(',');

    const initialRegion: Region | undefined = pins[0]
        ? {
            latitude: pins[0].latitude,
            longitude: pins[0].longitude,
            latitudeDelta: pins.length === 1 ? 0.025 : 0.12,
            longitudeDelta: pins.length === 1 ? 0.025 : 0.12,
        }
        : undefined;

    useEffect(() => {
        if (!mapReady || pins.length < 2) return;
        const timer = setTimeout(() => {
            mapRef.current?.fitToCoordinates(
                pins.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude })),
                { edgePadding: FIT_PADDING, animated: false },
            );
        }, 180);
        return () => clearTimeout(timer);
    }, [mapReady, pinKey, pins]);

    return (
        <View style={[styles.hero, { height: HERO_HEIGHT + topInset, backgroundColor: palette.surfaceContainerLow }]}>
            {pins.length > 0 ? (
                <>
                    <MapView
                        ref={mapRef}
                        style={StyleSheet.absoluteFillObject}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
                        userInterfaceStyle="light"
                        customMapStyle={Platform.OS === 'android' ? heirloomMapStyle : undefined}
                        initialRegion={initialRegion}
                        onMapReady={() => setMapReady(true)}
                        showsPointsOfInterest={false}
                        showsCompass={false}
                        showsBuildings={false}
                        showsMyLocationButton={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                        toolbarEnabled={false}
                    >
                        {pins.map((pin) => {
                            const isSelected = selectedId === pin.restaurantId;
                            return (
                                <Marker
                                    // Custom markers are native snapshots when tracking is disabled.
                                    // Remount the two markers whose selection state changes so the
                                    // halo is captured without keeping every marker live on the map.
                                    key={`${pin.id}:${isSelected ? 'selected' : 'idle'}`}
                                    coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                                    anchor={{ x: 0.5, y: 0.8 }}
                                    onPress={() => setSelectedId(pin.restaurantId)}
                                    tracksViewChanges={false}
                                >
                                    <View style={[styles.markerHalo, isSelected && { backgroundColor: palette.primaryMuted }]}>
                                        <View style={[styles.marker, { backgroundColor: palette.primary, borderColor: palette.background }]}>
                                            {pin.rank ? (
                                                <Text style={[styles.markerRank, { color: palette.textInverse }]}>{pin.rank}</Text>
                                            ) : (
                                                <View style={[styles.markerDot, { backgroundColor: palette.textInverse }]} />
                                            )}
                                        </View>
                                    </View>
                                </Marker>
                            );
                        })}
                    </MapView>
                    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.mapWash, { backgroundColor: palette.background }]} />
                </>
            ) : cover ? (
                <>
                    <Image
                        source={{ uri: cover }}
                        style={[
                            StyleSheet.absoluteFillObject,
                            {
                                borderWidth: StyleSheet.hairlineWidth,
                                borderColor: scheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                            },
                        ]}
                        contentFit="cover"
                        transition={180}
                    />
                    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.photoWash, { backgroundColor: palette.background }]} />
                </>
            ) : (
                <View style={styles.fallback}>
                    <View style={[styles.fallbackGlyph, { backgroundColor: palette.primaryMuted }]}>
                        <Ionicons name="map-outline" size={30} color={palette.primary} />
                    </View>
                    <Text style={[styles.fallbackText, { color: palette.textMuted }]}>places will gather here</Text>
                </View>
            )}

            <LinearGradient
                pointerEvents="none"
                colors={['rgba(0,0,0,0.10)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.08)']}
                locations={[0, 0.34, 1]}
                style={StyleSheet.absoluteFillObject}
            />

            <View style={[styles.backPosition, { top: topInset + Spacing.sm }]}>
                <PressableScale
                    onPress={onBack}
                    haptic="selection"
                    style={[styles.backButton, Shadow.subtle, { backgroundColor: palette.scrimFrost }]}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons name="chevron-back" size={21} color={palette.text} style={styles.backIcon} />
                </PressableScale>
            </View>

            {selected ? (
                <View style={styles.selectedPosition}>
                    <PressableScale
                        onPress={() => onRestaurantPress(selected.restaurantId)}
                        haptic="light"
                        style={[styles.selectedPill, Shadow.ambient, { backgroundColor: palette.scrimFrost }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${selected.name}`}
                    >
                        <Text style={[styles.selectedName, { color: palette.text }]} numberOfLines={1}>{selected.name}</Text>
                        <Ionicons name="arrow-forward" size={16} color={palette.primary} />
                    </PressableScale>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    hero: {
        position: 'relative',
        overflow: 'hidden',
    },
    mapWash: {
        opacity: 0.16,
    },
    photoWash: {
        opacity: 0.18,
    },
    fallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    fallbackGlyph: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fallbackText: {
        ...Type.editorialBody,
    },
    backPosition: {
        position: 'absolute',
        left: Spacing.md,
        width: 44,
        height: 44,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backIcon: {
        marginLeft: -2,
    },
    markerHalo: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    marker: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderBottomLeftRadius: 4,
        borderWidth: 2,
        transform: [{ rotate: '-45deg' }],
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 5,
        elevation: 3,
    },
    markerRank: {
        transform: [{ rotate: '45deg' }],
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        fontVariant: ['tabular-nums'],
    },
    markerDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    selectedPosition: {
        position: 'absolute',
        left: Spacing.lg,
        right: Spacing.lg,
        bottom: 38,
        height: 48,
    },
    selectedPill: {
        minHeight: 48,
        borderRadius: Radius.xl,
        paddingHorizontal: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    selectedName: {
        flex: 1,
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
});
