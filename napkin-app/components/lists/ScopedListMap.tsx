/**
 * ScopedListMap — the lean, single-list map behind `ListDetailSheet`
 * (TICKET-186). Renders THIS list's pins over warm paper, frames the collection
 * above the live sheet height, and zooms to a pin on row-locate / pin-tap.
 *
 * Deliberately NOT `WishlistMapView`: no source pills, Discover, filters, import
 * chrome, locate FAB, list/people chips, PeekCarousel, or unmappable sheet. It
 * owns its own MapView / refs / lifecycle and renders its own italic-free saved
 * pin (`ListPin`) — the only shared code is neutral types/constants + the pure
 * `chooseCollectionCamera` from `mapShared` (no type cycle, Codex #6/#7).
 */
import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, {
    Marker,
    UrlTile,
    PROVIDER_GOOGLE,
    PROVIDER_DEFAULT,
    type EdgePadding,
    type LatLng,
    type Region,
} from 'react-native-maps';
import type MapViewType from 'react-native-maps';

import { Colors, Shadow } from '@/constants/theme';
import { heirloomMapStyle } from '@/constants/mapStyle';
import { tileUrlTemplate, MAPTILER_ATTRIBUTION, MAP_TILE_MODE } from '@/lib/maptiler';
import { cuisineGlyph } from '@/lib/engraving';
import type { LatLng as GeoLatLng } from '@/lib/geo';
import {
    chooseCollectionCamera,
    CITY_DELTA,
    CREAM,
    SPOT_DELTA,
    type CameraAction,
    type LocationStatus,
    type WishlistMapItem,
} from '@/components/wishlist/mapShared';
import { listCollectionFrameKey } from '@/components/wishlist/listMapScope';
import { isUnhandledFocus, type FocusRequest } from './focusRequest';

type Palette = typeof Colors.light;

export interface ScopedListMapProps {
    /** Mappable pins for THIS list (listEntriesToWishlistMapItems). */
    items: WishlistMapItem[];
    /** Rows without a usable coordinate — a quiet, non-interactive murmur. */
    unmappableCount: number;
    userCoords: GeoLatLng | null;
    locationStatus: LocationStatus;
    /** Event-like focus (row-locate / pin-tap): repeat taps re-fire via `seq`,
     * which is monotonic for the life of the host screen (review F4). */
    focusRequest: FocusRequest | null;
    /** `list:<id>` — stable identity; frames the collection once per membership. */
    collectionScopeKey: string;
    /** Live sheet height → mapPadding.bottom (the single occlusion source). */
    sheetVisibleHeight: number;
    /** 0=peek · 1=half · 2=full — the callout renders only at peek. */
    settledSnap: 0 | 1 | 2;
    /** Host calls this at a ≤half settle to re-frame the whole collection. */
    reframeRef: React.Ref<() => void>;
    /** Pin tap → ask the host to snap to peek + fire a focus (Codex #8). */
    onPinFocus: (id: string) => void;
    onOpenRestaurant: (id: string) => void;
    palette: Palette;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** A small uniform visual margin for fit — the sheet occlusion rides on
 * mapPadding, never re-added here (Android double-counts otherwise, Codex #4). */
const FIT_MARGIN = 40;
/** Left/right map inset for framing + the back-chevron band above the top. */
const EDGE = 24;
const CHROME_TOP = 56;
/** Bounded wait for a deferred (cross-city, location-pending) first frame. */
const DEFER_FALLBACK_MS = 1500;
/** Calm backdrop for an empty list with no granted location (A11). */
const DEFAULT_REGION: Region = {
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.09,
    longitudeDelta: 0.09,
};

const PEEK: 0 = 0;

function regionAt(item: Pick<WishlistMapItem, 'lat' | 'lng'>, delta: number): Region {
    return { latitude: item.lat, longitude: item.lng, latitudeDelta: delta, longitudeDelta: delta };
}

// ── ListPin (the italic-free saved-variant pin) ─────────────────────────────────
// Cream paper fill + terracotta ring + cuisine glyph (or the list emoji) + a tail
// in the ring color (tip = coordinate). No overlap / network / count numeral, so
// no Newsreader-italic literal ships here (A15).

function ListPin({ item, selected, palette }: { item: WishlistMapItem; selected: boolean; palette: Palette }) {
    const isDark = palette !== Colors.light;
    const size = selected ? 38 : 32;
    const ring = selected ? 3 : 2.5;
    const fill = isDark ? palette.surfaceContainerHigh : CREAM;
    return (
        <View style={pinStyles.wrap}>
            <View
                style={[
                    pinStyles.bubble,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        borderWidth: ring,
                        borderColor: palette.primary,
                        backgroundColor: fill,
                        shadowOpacity: selected ? 0.3 : 0.22,
                    },
                ]}
            >
                {item.emoji ? (
                    <Text style={{ fontSize: selected ? 17 : 15, includeFontPadding: false }}>{item.emoji}</Text>
                ) : (
                    <Ionicons
                        name={cuisineGlyph(item.cuisine)}
                        size={selected ? 18 : 15}
                        color={palette.primary}
                        style={pinStyles.glyph}
                    />
                )}
            </View>
            <View style={[pinStyles.tail, { borderTopColor: palette.primary }]} />
        </View>
    );
}

interface ListMarkerProps {
    item: WishlistMapItem;
    selected: boolean;
    palette: Palette;
    onPress: () => void;
}

function ScopedListMarker({ item, selected, palette, onPress }: ListMarkerProps) {
    const coordinate: LatLng = { latitude: item.lat, longitude: item.lng };
    // Own tracksViewChanges window: re-armed on mount + selection change, then
    // released so the native snapshot settles (mirrors WishlistMarker).
    const [tracking, setTracking] = useState(true);
    useEffect(() => {
        setTracking(true);
        const t = setTimeout(() => setTracking(false), 500);
        return () => clearTimeout(t);
    }, [selected]);

    return (
        <Marker
            coordinate={coordinate}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracking}
            stopPropagation
            onPress={onPress}
        >
            <ListPin item={item} selected={selected} palette={palette} />
        </Marker>
    );
}

// ── ScopedListMap ────────────────────────────────────────────────────────────────

export function ScopedListMap({
    items,
    unmappableCount,
    userCoords,
    locationStatus,
    focusRequest,
    collectionScopeKey,
    sheetVisibleHeight,
    settledSnap,
    reframeRef,
    onPinFocus,
    onOpenRestaurant,
    palette,
}: ScopedListMapProps) {
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapViewType>(null);
    const [mapReady, setMapReady] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const isDark = palette !== Colors.light;
    const isAndroid = Platform.OS === 'android';
    const tilesOn = MAP_TILE_MODE === 'maptiler';
    const frostBg = isDark ? 'rgba(42,39,36,0.92)' : palette.scrimFrost;

    const framedKeyRef = useRef<string | null>(null);
    const framedWithoutCoordsRef = useRef(false);
    const correctedRef = useRef(false);
    const deferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handledSeqRef = useRef<number | null>(null);

    const collectionFrameKey = listCollectionFrameKey(collectionScopeKey, items);

    const applyAction = useCallback((action: CameraAction) => {
        const map = mapRef.current;
        if (!map) return;
        if (action.kind === 'fit') {
            map.fitToCoordinates(action.coords, {
                edgePadding: { top: FIT_MARGIN, right: FIT_MARGIN, bottom: FIT_MARGIN, left: FIT_MARGIN },
                animated: true,
            });
        } else if (action.kind === 'region') {
            map.animateToRegion(action.region, 320);
        }
    }, []);

    // Selection survives only while its restaurant is still on the map.
    useEffect(() => {
        if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(null);
    }, [items, selectedId]);

    // Collection framing — once per membership key, gated on onMapReady. A cross-
    // city spread with location still resolving defers (bounded fallback → first
    // pin); when granted coords land after a non-user frame, ONE corrective
    // reframe re-anchors on the nearest pin (Codex #3/#4/#5).
    useEffect(() => {
        if (!mapReady || !collectionFrameKey || items.length === 0) return;

        if (framedKeyRef.current !== collectionFrameKey) {
            const action = chooseCollectionCamera(items, userCoords, locationStatus);
            if (action.kind === 'defer') {
                if (!deferTimerRef.current) {
                    deferTimerRef.current = setTimeout(() => {
                        deferTimerRef.current = null;
                        if (framedKeyRef.current === collectionFrameKey) return;
                        framedKeyRef.current = collectionFrameKey;
                        framedWithoutCoordsRef.current = true;
                        correctedRef.current = false;
                        applyAction({ kind: 'region', region: regionAt(items[0], CITY_DELTA) });
                    }, DEFER_FALLBACK_MS);
                }
                return;
            }
            if (deferTimerRef.current) {
                clearTimeout(deferTimerRef.current);
                deferTimerRef.current = null;
            }
            framedKeyRef.current = collectionFrameKey;
            framedWithoutCoordsRef.current = !userCoords;
            correctedRef.current = false;
            applyAction(action);
            return;
        }

        // Already framed this key: allow ONE corrective reframe when granted
        // coords arrive after a first non-user frame (cross-city anchor fix).
        if (
            !correctedRef.current
            && framedWithoutCoordsRef.current
            && locationStatus === 'granted'
            && userCoords
        ) {
            const action = chooseCollectionCamera(items, userCoords, locationStatus);
            if (action.kind === 'region') {
                correctedRef.current = true;
                applyAction(action);
            }
        }
    }, [applyAction, collectionFrameKey, items, locationStatus, mapReady, userCoords]);

    useEffect(() => () => {
        if (deferTimerRef.current) clearTimeout(deferTimerRef.current);
    }, []);

    // Empty list + granted coords arriving post-mount → one recenter (initialRegion
    // is ignored after mount, A11/Codex #5).
    const recenteredEmptyRef = useRef(false);
    useEffect(() => {
        if (!mapReady || items.length > 0) return;
        if (recenteredEmptyRef.current || locationStatus !== 'granted' || !userCoords) return;
        recenteredEmptyRef.current = true;
        mapRef.current?.animateToRegion(regionAt({ lat: userCoords.latitude, lng: userCoords.longitude }, CITY_DELTA), 300);
    }, [items.length, locationStatus, mapReady, userCoords]);

    // Focus (row-locate / pin-tap round-trip) — event-like, re-fires on new seq.
    // handledSeqRef persists across restaurant round-trips; the host's seq is
    // monotonic so a re-focus after back always reads as unhandled (F4).
    useEffect(() => {
        if (!mapReady || !isUnhandledFocus(handledSeqRef.current, focusRequest)) return;
        const target = items.find((i) => i.id === focusRequest.id);
        if (!target) return;
        handledSeqRef.current = focusRequest.seq;
        setSelectedId(target.id);
        mapRef.current?.animateToRegion(regionAt(target, SPOT_DELTA), 320);
    }, [focusRequest, items, mapReady]);

    // Imperative reframe the host calls at a ≤half settle (membership change /
    // returning to a framed view). Best-effort: a defer collapses to the first pin.
    useImperativeHandle(reframeRef, () => () => {
        if (!mapReady || items.length === 0) return;
        const action = chooseCollectionCamera(items, userCoords, locationStatus);
        applyAction(
            action.kind === 'defer'
                ? { kind: 'region', region: regionAt(items[0], CITY_DELTA) }
                : action,
        );
    }, [applyAction, items, locationStatus, mapReady, userCoords]);

    const initialRegion: Region = useMemo(() => {
        if (items.length > 0) return regionAt(items[0], 0.08);
        if (userCoords) return regionAt({ lat: userCoords.latitude, lng: userCoords.longitude }, CITY_DELTA);
        return DEFAULT_REGION;
    }, [items, userCoords]);

    const mapPadding: EdgePadding = useMemo(
        () => ({ top: insets.top + CHROME_TOP, right: EDGE, bottom: sheetVisibleHeight, left: EDGE }),
        [insets.top, sheetVisibleHeight],
    );

    const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
    const calloutMeta = useMemo(() => {
        if (!selected) return null;
        return [selected.cuisine, selected.city].filter(Boolean).join(' · ');
    }, [selected]);

    return (
        <View style={[styles.fill, { backgroundColor: CREAM }]}>
            <MapView
                ref={mapRef}
                style={[StyleSheet.absoluteFillObject, { backgroundColor: CREAM }]}
                provider={isAndroid ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                customMapStyle={isAndroid ? heirloomMapStyle : undefined}
                mapType={!tilesOn && Platform.OS === 'ios' ? 'mutedStandard' : undefined}
                userInterfaceStyle="light"
                initialRegion={initialRegion}
                mapPadding={mapPadding}
                showsPointsOfInterest={false}
                showsCompass={false}
                showsMyLocationButton={false}
                showsBuildings={false}
                pitchEnabled={false}
                rotateEnabled={false}
                showsUserLocation={locationStatus === 'granted'}
                onMapReady={() => setMapReady(true)}
                onPress={() => setSelectedId(null)}
            >
                {tilesOn ? (
                    <UrlTile
                        urlTemplate={tileUrlTemplate()}
                        shouldReplaceMapContent={Platform.OS === 'ios'}
                        tileSize={512}
                        maximumZ={20}
                    />
                ) : null}
                {items.map((item) => (
                    <ScopedListMarker
                        key={item.id}
                        item={item}
                        selected={selectedId === item.id}
                        palette={palette}
                        onPress={() => onPinFocus(item.id)}
                    />
                ))}
            </MapView>

            {tilesOn ? (
                <View
                    style={[StyleSheet.absoluteFill, { backgroundColor: CREAM, opacity: 0.15 }]}
                    pointerEvents="none"
                />
            ) : null}

            {/* Hairline warm rule at the top edge (ghosted, not a 1px border). */}
            <View style={[styles.topRule, { backgroundColor: palette.ruleInkSoft }]} pointerEvents="none" />

            {/* Unmappable murmur — quiet, non-interactive (the rows already list them). */}
            {unmappableCount > 0 ? (
                <View
                    style={[styles.murmur, { top: insets.top + CHROME_TOP, backgroundColor: frostBg }, Shadow.ambient]}
                    pointerEvents="none"
                >
                    <Text style={[styles.murmurText, { color: palette.textMuted }]}>
                        {`${unmappableCount} ${unmappableCount === 1 ? 'spot isn’t' : 'spots aren’t'} on the map`}
                    </Text>
                </View>
            ) : null}

            {/* Attribution — ToS-required ghosted caption, maptiler mode only. */}
            {tilesOn ? (
                <Text
                    style={[styles.attribution, { color: palette.textMuted, bottom: sheetVisibleHeight + 8 }]}
                    pointerEvents="none"
                >
                    {MAPTILER_ATTRIBUTION}
                </Text>
            ) : null}

            {/* Compact callout — ONLY at peek (Codex #8); the sheet row is the
                detail at half/full. Positioned just above the peek band. */}
            {selected && settledSnap === PEEK ? (
                <View style={[styles.calloutWrap, { bottom: sheetVisibleHeight + 12 }]} pointerEvents="box-none">
                    <Pressable
                        onPress={() => onOpenRestaurant(selected.id)}
                        style={[styles.callout, { backgroundColor: palette.card }, Shadow.ambient]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${selected.name}`}
                    >
                        <View style={styles.calloutCopy}>
                            <Text style={[styles.calloutName, { color: palette.text }]} numberOfLines={1}>
                                {selected.name}
                            </Text>
                            {calloutMeta ? (
                                <Text style={[styles.calloutMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                    {calloutMeta}
                                </Text>
                            ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
    topRule: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
    murmur: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
    },
    murmurText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13, // metadata floor (review F5b)
    },
    attribution: {
        position: 'absolute',
        right: 10,
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        opacity: 0.7,
    },
    calloutWrap: {
        position: 'absolute',
        left: 16,
        right: 16,
        alignItems: 'center',
    },
    callout: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 16,
    },
    calloutCopy: { flex: 1, minWidth: 0 },
    calloutName: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 18,
        lineHeight: 22,
    },
    calloutMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        marginTop: 2,
    },
});

const pinStyles = StyleSheet.create({
    wrap: { width: 56, alignItems: 'center', paddingTop: 6 },
    bubble: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 5,
        elevation: 4,
    },
    glyph: { opacity: 0.85 },
    tail: {
        width: 0,
        height: 0,
        marginTop: -1,
        borderLeftWidth: 5,
        borderRightWidth: 5,
        borderTopWidth: 6,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
    },
});
