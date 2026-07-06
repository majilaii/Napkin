/**
 * WishlistMapView — map of your saved spots, "what's near me right now."
 *
 * Purpose-built for the wishlist (TICKET-08x map fast-follow). Unlike the Atlas
 * map (person-cluster pins built around visits/members), a saved spot has no
 * visit history — so pins are simple terracotta teardrops and the tap-target is
 * a lightweight peek card: name · city · cuisine · distance, a `directions`
 * deep-link, and a tap-through to the restaurant page.
 *
 * Provider mirrors AtlasMapView:
 *   iOS     → PROVIDER_DEFAULT (Apple Maps, free, no key)
 *   Android → PROVIDER_GOOGLE  (needs a key in app.config; iOS is the test target)
 *
 * react-native-maps is autolinked (pod installed). The map fits to the pin set on
 * mount; the recenter FAB animates to the user (lazy foreground location).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Platform,
    Linking,
    Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, {
    Marker,
    PROVIDER_GOOGLE,
    PROVIDER_DEFAULT,
    type LatLng,
    type Region,
} from 'react-native-maps';
import type MapViewType from 'react-native-maps';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { heirloomMapStyle } from '@/constants/mapStyle';
import { haversineMiles, formatDistance, type LatLng as GeoLatLng } from '@/lib/geo';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WishlistMapItem {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    lat: number;
    lng: number;
}

type LocationStatus = 'idle' | 'pending' | 'granted' | 'denied';

interface Props {
    /** Saved spots WITH valid coordinates (parent filters these). */
    items: WishlistMapItem[];
    /** Count of saved spots that lack coordinates — surfaced as a quiet murmur. */
    unmappableCount: number;
    /** User location for the "you are here" dot + recenter + distance labels. */
    userCoords: GeoLatLng | null;
    locationStatus: LocationStatus;
    onRequestLocation: () => void;
    onOpenRestaurant: (restaurantId: string) => void;
    /** Switch back to the list view (toggle lives bottom-right, like the Map
     * button). Optional — screens with their own chrome (dining map, TICKET-092)
     * omit it and the toggle hides. */
    onSwitchToList?: () => void;
    palette: typeof Colors.light;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CREAM = '#fdf6ec';
/** Clearance so the FAB / peek card sit above the floating bottom nav. */
const NAV_CLEARANCE = 64;

// ── Directions deep-link (mirrors InfoMapPreview / MetaActions) ─────────────────

function openDirections(item: WishlistMapItem) {
    const label = encodeURIComponent(item.name);
    const url =
        Platform.OS === 'ios'
            ? `maps:?q=${label}&ll=${item.lat},${item.lng}`
            : `geo:${item.lat},${item.lng}?q=${label}`;
    Linking.openURL(url).catch(() => {
        Linking.openURL(`https://maps.google.com/?q=${item.lat},${item.lng}`).catch(() => {});
    });
}

// ── WishlistPin ─────────────────────────────────────────────────────────────────
// Terracotta teardrop, cream interior dot. Selected = larger + cream ring.

function WishlistPin({ selected, palette }: { selected: boolean; palette: typeof Colors.light }) {
    const size = selected ? 22 : 16;
    return (
        <View style={pinStyles.wrap}>
            <View
                style={[
                    pinStyles.pin,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: palette.primary,
                        borderColor: CREAM,
                        borderWidth: selected ? 2 : 1.5,
                    },
                ]}
            >
                <View
                    style={[
                        pinStyles.dot,
                        {
                            width: size * 0.4,
                            height: size * 0.4,
                            borderRadius: (size * 0.4) / 2,
                            backgroundColor: CREAM,
                        },
                    ]}
                />
            </View>
        </View>
    );
}

const pinStyles = StyleSheet.create({
    // 44×44 transparent hit area (iOS HIG min target) around the small visible
    // teardrop — the dot stays small, but the tap-target is finger-sized so pins
    // are easy to hit on a dense map. anchor={0.5,0.5} keeps the pin on-coordinate.
    wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    pin: {
        // Teardrop: rotated rounded square w/ one square corner, like InfoMapPreview
        borderBottomLeftRadius: 0,
        transform: [{ rotate: '-45deg' }],
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 5,
        elevation: 4,
    },
    dot: {
        transform: [{ rotate: '45deg' }], // counter-rotate so the dot stays upright
    },
});

// ── WishlistMarker ───────────────────────────────────────────────────────────────
// One pin. Owns its own tracksViewChanges window (re-armed on mount + whenever its
// `selected` size change needs a fresh native snapshot) so churn stays scoped to the
// pin that changed — mirrors AtlasMapView's inner PinMarker.
//
// `stopPropagation` is essential: on iOS / Apple Maps (the shipping target) a
// Marker's onPress otherwise bubbles to the parent MapView's onPress, which would
// select then immediately clear the pin in the same gesture — the peek card would
// never open.

interface WishlistMarkerProps {
    item: WishlistMapItem;
    selected: boolean;
    palette: typeof Colors.light;
    onPress: () => void;
}

function WishlistMarker({ item, selected, palette, onPress }: WishlistMarkerProps) {
    const coordinate: LatLng = { latitude: item.lat, longitude: item.lng };
    const [tracking, setTracking] = useState(true);
    useEffect(() => {
        setTracking(true);
        const t = setTimeout(() => setTracking(false), 500);
        return () => clearTimeout(t);
    }, [selected]);

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracking}
            stopPropagation
            onPress={onPress}
        >
            <WishlistPin selected={selected} palette={palette} />
        </Marker>
    );
}

// ── WishlistMapView ──────────────────────────────────────────────────────────────

export function WishlistMapView({
    items,
    unmappableCount,
    userCoords,
    locationStatus,
    onRequestLocation,
    onOpenRestaurant,
    onSwitchToList,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapViewType>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Selection survives only while its restaurant is still on the map.
    useEffect(() => {
        if (selectedId && !items.some((i) => i.id === selectedId)) {
            setSelectedId(null);
        }
    }, [items, selectedId]);

    // Frame the map ONCE per open. This is a "near me" map, so prefer centering on
    // the user at city zoom — fitting ALL pins zooms way out for a globally-spread
    // wishlist ("why is it so zoomed out every time I switch to map"). Falls back to
    // the first saved spot when there's no location. Re-frames only on the next OPEN
    // (the component remounts when you toggle back to map), never on the live location
    // updates you get while walking — so the camera doesn't yank around under you.
    const framedRef = useRef(false);
    useEffect(() => {
        if (items.length === 0 || framedRef.current) return;
        const timer = setTimeout(() => {
            if (framedRef.current) return;
            if (locationStatus === 'granted' && userCoords) {
                mapRef.current?.animateCamera(
                    { center: { latitude: userCoords.latitude, longitude: userCoords.longitude }, zoom: 13 },
                    { duration: 300 },
                );
                framedRef.current = true;
            } else if (locationStatus !== 'pending') {
                mapRef.current?.animateCamera(
                    { center: { latitude: items[0].lat, longitude: items[0].lng }, zoom: 13 },
                    { duration: 300 },
                );
                framedRef.current = true;
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [items, locationStatus, userCoords]);

    const initialRegion: Region | undefined = useMemo(() => {
        if (items.length === 0) return undefined;
        const first = items[0];
        return {
            latitude: first.lat,
            longitude: first.lng,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
        };
    }, [items]);

    const handleRecenter = () => {
        if (locationStatus === 'granted' && userCoords) {
            mapRef.current?.animateCamera(
                { center: { latitude: userCoords.latitude, longitude: userCoords.longitude }, zoom: 14 },
                { duration: 350 },
            );
        } else {
            onRequestLocation();
        }
    };

    const selected = useMemo(
        () => items.find((i) => i.id === selectedId) ?? null,
        [items, selectedId],
    );

    // ── Empty (defensive — parent only enters map mode with mappable items) ──
    if (items.length === 0) {
        return (
            <View style={[styles.fill, styles.emptyWrap]}>
                <Ionicons name="map-outline" size={28} color={palette.textMuted} />
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                    none of your saved spots have a map location yet.
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.fill}>
            {/* Rounded, ambient-shadowed map container with a hairline warm rule at
                the top edge — the map reads as a framed plate on the warm page, not
                an edge-to-edge system raster. Theme tokens only. */}
            <View
                style={[
                    styles.mapFrame,
                    { backgroundColor: palette.surfaceContainerLow },
                    Shadow.ambient,
                ]}
            >
                <MapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFillObject}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                    // iOS (Apple Maps) ignores customMapStyle → mutedStandard desaturates
                    // the tiles toward paper. Android (Google) honors customMapStyle.
                    mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
                    customMapStyle={Platform.OS === 'android' ? heirloomMapStyle : undefined}
                    initialRegion={initialRegion}
                    showsPointsOfInterest={false}
                    showsCompass={false}
                    showsMyLocationButton={false}
                    showsBuildings={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    showsUserLocation={locationStatus === 'granted'}
                    onPress={() => setSelectedId(null)}
                >
                    {items.map((item) => (
                        <WishlistMarker
                            key={item.id}
                            item={item}
                            selected={selectedId === item.id}
                            palette={palette}
                            onPress={() => setSelectedId(item.id)}
                        />
                    ))}
                </MapView>

                {/* Hairline warm rule at the top edge (ghosted, not a 1px border). */}
                <View
                    style={[styles.topRule, { backgroundColor: palette.ruleInkSoft }]}
                    pointerEvents="none"
                />
            </View>

            {/* Unmappable murmur — top-left, quiet. The map area already begins
                below the header, so this is a small offset from the map's own top,
                not an inset-counted one. */}
            {unmappableCount > 0 ? (
                <View style={[styles.murmurWrap, { top: 10 }]} pointerEvents="none">
                    <View style={[styles.murmurPill, { backgroundColor: palette.surfaceContainerLow }]}>
                        <Text style={[styles.murmurText, { color: palette.textMuted }]}>
                            {`${unmappableCount} saved ${unmappableCount === 1 ? 'spot has' : 'spots have'} no map location`}
                        </Text>
                    </View>
                </View>
            ) : null}

            {/* Recenter FAB — hidden once a peek card is up (card owns the bottom). */}
            {!selected ? (
                <Pressable
                    onPress={handleRecenter}
                    style={[
                        styles.fab,
                        {
                            backgroundColor: palette.background,
                            bottom: insets.bottom + NAV_CLEARANCE,
                        },
                    ]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="center map on my location"
                >
                    {locationStatus === 'pending' ? (
                        <Ionicons name="ellipsis-horizontal" size={20} color={palette.textMuted} />
                    ) : (
                        <Ionicons
                            name="navigate"
                            size={18}
                            color={locationStatus === 'granted' ? palette.primary : palette.textSecondary}
                        />
                    )}
                </Pressable>
            ) : null}

            {/* List toggle — bottom-RIGHT, the same corner as the list view's Map
                button, so the view toggle stays put. Hidden while a peek card is up. */}
            {!selected && onSwitchToList ? (
                <Pressable
                    onPress={onSwitchToList}
                    style={[styles.listToggle, { backgroundColor: palette.surfaceNote, bottom: insets.bottom + 76 }]}
                    accessibilityRole="button"
                    accessibilityLabel="list view"
                >
                    <Ionicons name="list" size={15} color={palette.primary} />
                    <Text style={[styles.listToggleText, { color: palette.primary }]}>List</Text>
                </Pressable>
            ) : null}

            {/* Peek card — rises when a pin is tapped */}
            {selected ? (
                <PeekCard
                    key={selected.id}
                    item={selected}
                    userCoords={userCoords}
                    palette={palette}
                    bottomInset={insets.bottom + NAV_CLEARANCE}
                    onClose={() => setSelectedId(null)}
                    onOpen={() => onOpenRestaurant(selected.id)}
                />
            ) : null}
        </View>
    );
}

// ── PeekCard ────────────────────────────────────────────────────────────────────

interface PeekCardProps {
    item: WishlistMapItem;
    userCoords: GeoLatLng | null;
    palette: typeof Colors.light;
    bottomInset: number;
    onClose: () => void;
    onOpen: () => void;
}

function PeekCard({ item, userCoords, palette, bottomInset, onClose, onOpen }: PeekCardProps) {
    const slide = useRef(new Animated.Value(40)).current;
    const fade = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.parallel([
            Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240 }),
            Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]).start();
    }, [slide, fade]);

    const distanceLabel = userCoords
        ? formatDistance(haversineMiles(userCoords, { latitude: item.lat, longitude: item.lng }))
        : null;
    const meta = [distanceLabel, item.city, item.cuisine].filter(Boolean).join(' · ');

    return (
        <Animated.View
            style={[
                styles.peekCard,
                {
                    backgroundColor: palette.surfaceContainerLow,
                    bottom: bottomInset,
                    opacity: fade,
                    transform: [{ translateY: slide }],
                },
            ]}
        >
            <Pressable style={styles.peekBody} onPress={onOpen} accessibilityLabel={`Open ${item.name}`}>
                <Text style={[styles.peekName, { color: palette.text }]} numberOfLines={1}>
                    {item.name}
                </Text>
                {meta ? (
                    <Text style={[styles.peekMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </Pressable>

            <View style={styles.peekActions}>
                <Pressable
                    onPress={() => openDirections(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="directions"
                    style={({ pressed }) => [
                        styles.directionsPill,
                        { borderColor: 'rgba(160,63,40,0.35)', opacity: pressed ? 0.7 : 1 },
                    ]}
                >
                    <Ionicons name="navigate-outline" size={15} color={palette.primary} />
                    <Text style={[styles.directionsLabel, { color: palette.primary }]}>directions</Text>
                </Pressable>
                <Pressable
                    onPress={onClose}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="close"
                    style={styles.peekClose}
                >
                    <Ionicons name="close" size={20} color={palette.textMuted} />
                </Pressable>
            </View>
        </Animated.View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    fill: { flex: 1 },
    // Framed map plate — rounded top corners, ambient shadow, overflow-clipped so
    // the raster respects the radius. Sits on the warm page as a discrete surface.
    mapFrame: {
        ...StyleSheet.absoluteFillObject,
        borderTopLeftRadius: Radius.lg,
        borderTopRightRadius: Radius.lg,
        overflow: 'hidden',
    },
    // Hairline warm rule hugging the top edge (ghosted, not a solid border).
    topRule: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: StyleSheet.hairlineWidth,
    },
    emptyWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 40,
    },
    emptyText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
    },
    // Unmappable murmur
    murmurWrap: {
        position: 'absolute',
        left: 16,
        right: 16,
        alignItems: 'flex-start',
    },
    murmurPill: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
    },
    murmurText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    // Recenter FAB — bottom-LEFT, so it doesn't collide with the bottom-right List toggle.
    fab: {
        position: 'absolute',
        left: 18,
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 5,
    },
    // List toggle (map → list)
    listToggle: {
        position: 'absolute',
        right: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 11,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.14,
        shadowRadius: 14,
        elevation: 6,
    },
    listToggleText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.4,
    },
    // Peek card
    peekCard: {
        position: 'absolute',
        left: 18,
        right: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 16,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
        elevation: 10,
    },
    peekBody: {
        flex: 1,
        gap: 3,
    },
    peekName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 19,
        lineHeight: 23,
    },
    peekMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    peekActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    directionsPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderWidth: 1.5,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    directionsLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    peekClose: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default WishlistMapView;
