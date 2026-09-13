import React from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { CREAM, NEAR_ME_DELTA } from '@/components/wishlist/mapShared';
import { MAP_TILE_MODE, MAPTILER_ATTRIBUTION, tileUrlTemplate } from '@/lib/maptiler';
import { restaurantMapCoordinate } from '@/lib/restaurantLocation';

/** A quiet map cutout using the same providers as Places. No location request. */
export function RestaurantLocationPreview({
    name,
    lat,
    lng,
    directionsUrl,
    palette,
}: {
    name: string;
    lat?: number | null;
    lng?: number | null;
    directionsUrl: string;
    palette: typeof Colors.light;
}) {
    const coordinate = restaurantMapCoordinate(lat, lng);
    if (!coordinate) return null;
    const tilesOn = MAP_TILE_MODE === 'maptiler';

    const openMap = async () => {
        try {
            await Linking.openURL(directionsUrl);
        } catch {
            Alert.alert("Couldn't open Maps", 'Try again in a moment.');
        }
    };

    return (
        <Pressable
            onPress={openMap}
            accessibilityRole="link"
            accessibilityLabel={`Map of ${name}. Open in Maps`}
            accessibilityHint="Opens the restaurant's location and directions"
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.surfaceJournalLow },
                pressed && styles.pressed,
            ]}
        >
            <View
                style={[styles.mapFrame, { backgroundColor: CREAM }]}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <MapView
                    key={`${coordinate.latitude}:${coordinate.longitude}`}
                    testID="restaurant-location-map"
                    style={StyleSheet.absoluteFillObject}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                    mapType={tilesOn && Platform.OS === 'android' ? 'none' : 'mutedStandard'}
                    userInterfaceStyle="light"
                    initialRegion={{
                        ...coordinate,
                        latitudeDelta: NEAR_ME_DELTA,
                        longitudeDelta: NEAR_ME_DELTA,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    showsUserLocation={false}
                    showsMyLocationButton={false}
                    showsPointsOfInterest={false}
                    showsCompass={false}
                    showsScale={false}
                    showsBuildings={false}
                    toolbarEnabled={false}
                >
                    {tilesOn ? (
                        <UrlTile
                            urlTemplate={tileUrlTemplate()}
                            shouldReplaceMapContent={Platform.OS === 'ios'}
                            tileSize={512}
                            maximumZ={20}
                        />
                    ) : null}
                    <Marker coordinate={coordinate} pinColor={Colors.light.primary} />
                </MapView>
            </View>
            <View style={styles.footer}>
                <Text style={[Type.restaurantDetailAction, { color: palette.primary }]}>Open in Maps</Text>
                <Ionicons name="open-outline" size={IconSize.sm} color={palette.primary} />
            </View>
            {tilesOn ? (
                <Text style={[styles.attribution, Type.metadata, { color: palette.textMuted }]}>
                    {MAPTILER_ATTRIBUTION}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: Radius.md, overflow: 'hidden', marginBottom: Spacing.sm },
    mapFrame: { height: Spacing.restaurant.locationMapHeight, overflow: 'hidden' },
    footer: {
        minHeight: Spacing.hitTarget,
        paddingHorizontal: Spacing.restaurant.cardHorizontal,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    attribution: {
        paddingHorizontal: Spacing.restaurant.cardHorizontal,
        paddingBottom: Spacing.sm,
    },
    pressed: { opacity: 0.8 },
});
