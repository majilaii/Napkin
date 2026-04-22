/**
 * AtlasMapView — full-bleed Map with Solo / Round / Mixed pin markers.
 *
 * Provider:
 *   iOS  → PROVIDER_DEFAULT (Apple Maps, free)
 *   Android → PROVIDER_GOOGLE (requires API key in app.json)
 *
 * Initial region:
 *   - If ≥2 pins with valid coords: fitToCoordinates with edge padding
 *   - If 1 pin: initialRegion centered on it with modest delta
 *   - If 0 pins: no-op (caller should not render this component)
 *
 * On mount fitToCoordinates is called after a short delay to ensure the map
 * has laid out. MapView ref is forwarded so the parent can call animateCamera.
 *
 * NOTE: react-native-maps native code is NOT rebuilt yet. This file compiles
 * cleanly but will error at runtime until `npx expo prebuild` + `pod install`.
 */

import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
    View,
    StyleSheet,
    Platform,
} from 'react-native';
import MapView, {
    Marker,
    PROVIDER_GOOGLE,
    PROVIDER_DEFAULT,
    LatLng,
    Region,
} from 'react-native-maps';

import type MapViewType from 'react-native-maps';

import { SoloPin, RoundPin, MixedPin } from './AtlasPinMarker';
import { Colors } from '@/constants/theme';
import type { AtlasRestaurantTile } from '@/hooks/tables/useTableAtlasCity';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AtlasMapViewRef {
    animateToPin: (lat: number, lng: number) => void;
}

interface Props {
    restaurants: AtlasRestaurantTile[];
    onPinPress: (restaurant: AtlasRestaurantTile) => void;
    palette?: typeof Colors.light;
    /** Height passed from parent (defaults to 340) */
    mapHeight?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const FIT_PADDING = { top: 60, right: 40, bottom: 60, left: 40 };

export const AtlasMapView = forwardRef<AtlasMapViewRef, Props>(function AtlasMapView(
    { restaurants, onPinPress, palette: paletteProp, mapHeight = 340 },
    ref,
) {
    const palette = paletteProp ?? Colors.light;
    const mapRef = useRef<MapViewType>(null);

    // Forward imperative handle so parent can animateCamera
    useImperativeHandle(ref, () => ({
        animateToPin(lat: number, lng: number) {
            mapRef.current?.animateCamera(
                { center: { latitude: lat, longitude: lng }, zoom: 15 },
                { duration: 350 },
            );
        },
    }));

    // Collect valid coordinates
    const validPins = restaurants.filter(
        (r) => r.lat != null && r.lng != null,
    ) as (AtlasRestaurantTile & { lat: number; lng: number })[];

    // fitToCoordinates after mount
    useEffect(() => {
        if (validPins.length < 2) return;
        const timer = setTimeout(() => {
            mapRef.current?.fitToCoordinates(
                validPins.map((r) => ({ latitude: r.lat, longitude: r.lng })),
                { edgePadding: FIT_PADDING, animated: false },
            );
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [validPins.length]);

    // Fallback region: single pin or center-of-gravity
    const initialRegion: Region | undefined = (() => {
        if (validPins.length === 0) return undefined;
        const first = validPins[0];
        return {
            latitude: first.lat,
            longitude: first.lng,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
        };
    })();

    if (validPins.length === 0) return null;

    return (
        <View style={[styles.container, { height: mapHeight }]}>
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                mapType="standard"
                initialRegion={initialRegion}
                showsPointsOfInterest={false}
                showsCompass={false}
                showsMyLocationButton={false}
                showsBuildings={false}
                pitchEnabled={false}
                rotateEnabled={false}
            >
                {validPins.map((restaurant) => (
                    <PinMarker
                        key={restaurant.id}
                        restaurant={restaurant}
                        palette={palette}
                        onPress={onPinPress}
                    />
                ))}
            </MapView>
        </View>
    );
});

// ── PinMarker (inner) ─────────────────────────────────────────────────────────

interface PinMarkerProps {
    restaurant: AtlasRestaurantTile & { lat: number; lng: number };
    palette: typeof Colors.light;
    onPress: (r: AtlasRestaurantTile) => void;
}

function PinMarker({ restaurant, palette, onPress }: PinMarkerProps) {
    const coordinate: LatLng = {
        latitude: restaurant.lat,
        longitude: restaurant.lng,
    };

    const pinProps = {
        rating: restaurant.rating,
        wishedByViewer: restaurant.wished_by_viewer,
        palette,
    };

    return (
        <Marker
            coordinate={coordinate}
            onPress={() => onPress(restaurant)}
            tracksViewChanges={false}
            // Remove default callout
            anchor={{ x: 0.5, y: 0.5 }}
        >
            {restaurant.tile_type === 'solo' && <SoloPin {...pinProps} />}
            {restaurant.tile_type === 'round' && <RoundPin {...pinProps} />}
            {restaurant.tile_type === 'mixed' && <MixedPin {...pinProps} />}
        </Marker>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 20,
        borderRadius: 18,
        overflow: 'hidden',
        marginBottom: 0,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
    },
});

export default AtlasMapView;
