/**
 * WishlistMapView — full-bleed warm map of spots, "what's near me right now."
 *
 * TICKET-131 (rec'd-shaped chrome): one map surface grammar shared by the
 * wishlist tab's map mode (Saved · Been · Network) and /dining-map
 * (Mine · Network):
 *   - source pills float top-LEFT on the glass (frosted segmented)
 *   - optional Filter chip top-RIGHT (opens the screen-owned FilterTabsSheet)
 *   - locate FAB bottom-RIGHT, List pill bottom-LEFT — both frosted, both clear
 *     of the floating bottom nav (TICKET-130)
 *   - pins by layer: saved = terracotta teardrop (emoji variant unchanged),
 *     been = olive teardrop, network = followee avatar pin
 *   - tiles: Apple Maps mutedStandard + a vellum wash by default; a key-gated
 *     Google flip (GOOGLE_MAPS_IOS_KEY → PROVIDER_GOOGLE + heirloomMapStyle).
 *
 * Provider:
 *   iOS     → PROVIDER_DEFAULT (Apple Maps, free) UNLESS app.config carries
 *             ios.config.googleMapsApiKey (env-gated) → PROVIDER_GOOGLE.
 *   Android → PROVIDER_GOOGLE (needs a key in app.config; iOS is the test target)
 *
 * react-native-maps is autolinked (pod installed). The map frames on the user
 * (or first pin) once per open; the locate FAB animates to the user (lazy
 * foreground location).
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
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';
import MapView, {
    Marker,
    PROVIDER_GOOGLE,
    PROVIDER_DEFAULT,
    type LatLng,
    type Region,
} from 'react-native-maps';
import type MapViewType from 'react-native-maps';

import { Colors, Shadow } from '@/constants/theme';
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
    /**
     * TICKET-108: owning-list emoji, rendered in place of the pin's cream dot.
     * OPTIONAL — logged-spot mappers omit it, so their pins stay plain
     * teardrops. Absent/null → the default cream dot.
     */
    emoji?: string | null;
    /**
     * TICKET-131: a spot the user has LOGGED (wishlist "Been" layer, dining-map
     * "Mine") — renders the teardrop in olive (`palette.secondary`) instead of
     * terracotta. Set by the shared mappers in mapItems.ts; absent on saves.
     */
    been?: boolean;
    /**
     * TICKET-124 (network layer): when present, this pin is a followee's LOG,
     * not one of the viewer's own saves — the pin becomes an avatar pin and the
     * peek card switches to the network variant (whose pin · rating · note
     * snippet, tap → their review). All four are OPTIONAL and gated on
     * `entryId`: mine-mode pins omit them entirely and render the existing
     * directions-first card, fully backward-compatible.
     */
    author?: { id: string; name: string; avatar: string | null };
    rating?: number | null;
    /** Short note snippet; may be null/absent — the peek degrades gracefully. */
    note?: string | null;
    /** The followee's entry id → entry-detail. Presence = network pin. */
    entryId?: string;
    /**
     * TICKET-124: does the primary entry clear the public-engagement gate (rating
     * + >=20-char content)? Routes the peek tap — true → the followee's review
     * (entry-detail, viewAs public); false/absent → the restaurant page. Keeps the
     * one body affordance while never dead-ending on a thin log entry-detail's
     * public view can't render. Also drives the avatar pin's terracotta dot badge.
     */
    hasReview?: boolean;
    /** Other distinct followees who also logged here; >0 → "+N others". */
    othersCount?: number;
}

type LocationStatus = 'idle' | 'pending' | 'granted' | 'denied';

interface Props {
    /** Spots WITH valid coordinates (parent filters these). */
    items: WishlistMapItem[];
    /** Count of saved spots that lack coordinates — surfaced as a quiet murmur.
     * Saved layer only: parents pass 0 for the been/network layers. */
    unmappableCount: number;
    /** User location for the "you are here" dot + recenter + distance labels. */
    userCoords: GeoLatLng | null;
    locationStatus: LocationStatus;
    onRequestLocation: () => void;
    onOpenRestaurant: (restaurantId: string) => void;
    /**
     * TICKET-124: open a followee's review (entry-detail). Provided by the
     * network layer only; when a selected pin carries `entryId` AND this is set,
     * the peek card shows the network variant and its body taps through here
     * instead of to the restaurant page. Mine-mode consumers omit it.
     */
    onOpenReview?: (entryId: string) => void;
    /** Switch back to the list view — frosted List pill, bottom-LEFT. Optional —
     * screens with their own chrome (dining map, TICKET-092) omit it and the
     * pill hides. */
    onSwitchToList?: () => void;
    /**
     * TICKET-131: source pills — frosted segmented control floating top-LEFT on
     * the map (Saved · Been · Network on the wishlist; Mine · Network on
     * /dining-map). The OWNER of the state is the screen; this just draws the
     * chrome. Stays visible on the empty state (so you can switch back) and —
     * like the locate FAB and List pill — hides while a peek card is up
     * (existing three-piece hide behavior). Absent → no pills.
     */
    sources?: {
        options: { key: string; label: string }[];
        value: string;
        onChange: (k: string) => void;
    };
    /**
     * TICKET-131: renders the top-right Filter chip when present; opens the
     * screen-owned FilterTabsSheet (wishlist). Absent (dining-map) → chip hidden.
     */
    onOpenFilters?: () => void;
    /** Active-filter dot on the Filter chip. */
    filtersActive?: boolean;
    /**
     * Distance from the map's top edge to where the floating top chrome (source
     * pills / Filter chip / murmur) begins. Screens whose own chrome overlays
     * the map top (dining-map's back chevron + title chip) pass insets.top + 56;
     * default 12 suits maps that already start below the screen header.
     */
    chromeTopOffset?: number;
    palette: typeof Colors.light;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CREAM = '#fdf6ec';
/** Clearance so bottom chrome + peek sit above the floating nav pill (TICKET-130). */
const NAV_CLEARANCE = 92;
/** Dark-scheme frost pair for the floating chrome (light uses palette.scrimFrost).
 * Inline by design — no new theme tokens (TICKET-131). */
const FROST_DARK = 'rgba(42,39,36,0.92)';

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
// Teardrop, cream interior dot. Selected = larger + cream ring.
// Terracotta for saves; olive (`palette.secondary`) for logged/"been" spots.

function WishlistPin({
    selected,
    palette,
    emoji,
    been,
}: {
    selected: boolean;
    palette: typeof Colors.light;
    emoji?: string | null;
    been?: boolean;
}) {
    const hasEmoji = !!emoji;
    // Emoji pins are a touch larger so the glyph reads ≥14pt inside the teardrop
    // (AC: pin legibility at default zoom). Plain-dot pins keep the tight size.
    const size = hasEmoji ? (selected ? 30 : 26) : selected ? 22 : 16;
    return (
        <View style={pinStyles.wrap}>
            <View
                style={[
                    pinStyles.pin,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: been ? palette.secondary : palette.primary,
                        borderColor: CREAM,
                        borderWidth: selected ? 2 : 1.5,
                    },
                ]}
            >
                {hasEmoji ? (
                    // Emoji sits in place of the cream dot, counter-rotated +45°
                    // so it stays upright against the teardrop body's -45°.
                    <Text style={[pinStyles.emoji, { fontSize: selected ? 17 : 15 }]}>
                        {emoji}
                    </Text>
                ) : (
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
                )}
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
    emoji: {
        // Counter-rotate +45° so the glyph stays upright vs. the teardrop's -45°.
        transform: [{ rotate: '45deg' }],
        textAlign: 'center',
        includeFontPadding: false,
    },
});

// ── AvatarPin (network layer, TICKET-131) ───────────────────────────────────────
// 34px followee avatar in a cream ring with a small triangular tail below (the
// marker anchors bottom-center so the tail tip sits on the coordinate), and a
// terracotta dot badge top-right when the log clears the public-review gate.
// Fallback when the followee has no avatar: initial on a seeded warm tint
// (same deterministic triple as AtlasPinMarker / feed Avatar, so a person's pin
// color matches their avatar color everywhere).

function avatarTintFor(seed: string, palette: typeof Colors.light): string {
    const tints = [
        palette.tertiaryFixed, // amber-cream
        palette.secondaryContainer, // olive-cream
        palette.primaryMuted, // terracotta-muted
    ];
    return tints[(seed.charCodeAt(0) || 0) % tints.length];
}

function AvatarPin({
    item,
    selected,
    palette,
    onAvatarLoad,
}: {
    item: WishlistMapItem;
    selected: boolean;
    palette: typeof Colors.light;
    onAvatarLoad: () => void;
}) {
    const size = selected ? 38 : 34;
    const avatar = item.author?.avatar ?? null;
    const name = item.author?.name ?? 'Someone';
    const initial = (name.trim()[0] ?? '?').toUpperCase();
    const tint = avatarTintFor(item.author?.id || name, palette);
    const RING = 2.5;
    const inner = size - RING * 2;

    return (
        <View style={avatarPinStyles.wrap}>
            <View
                style={[
                    avatarPinStyles.circle,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        borderWidth: RING,
                        borderColor: CREAM,
                        backgroundColor: tint,
                    },
                ]}
            >
                {avatar ? (
                    <ExpoImage
                        source={{ uri: avatar }}
                        style={{ width: inner, height: inner, borderRadius: inner / 2 }}
                        contentFit="cover"
                        onLoad={onAvatarLoad}
                        // A 404ing avatar must still settle tracksViewChanges,
                        // or this marker re-snapshots every frame forever.
                        onError={onAvatarLoad}
                    />
                ) : (
                    <Text style={[avatarPinStyles.initial, { color: palette.text, fontSize: size * 0.4 }]}>
                        {initial}
                    </Text>
                )}
                {item.hasReview ? (
                    <View
                        style={[
                            avatarPinStyles.badge,
                            { backgroundColor: palette.primary, borderColor: CREAM },
                        ]}
                    />
                ) : null}
            </View>
            {/* Triangular tail — border-trick triangle, no svg. Cream to match the ring. */}
            <View style={avatarPinStyles.tail} />
        </View>
    );
}

const avatarPinStyles = StyleSheet.create({
    // 44-wide hit area; the marker anchors {0.5, 1} so the tail tip = coordinate.
    wrap: { width: 44, alignItems: 'center' },
    circle: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 5,
        elevation: 4,
    },
    initial: {
        fontFamily: 'Manrope_600SemiBold',
        includeFontPadding: false,
        textAlign: 'center',
    },
    badge: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1.5,
    },
    tail: {
        width: 0,
        height: 0,
        marginTop: -1,
        borderLeftWidth: 5,
        borderRightWidth: 5,
        borderTopWidth: 6,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: CREAM,
    },
});

// ── WishlistMarker ───────────────────────────────────────────────────────────────
// One pin. Owns its own tracksViewChanges window (re-armed on mount + whenever its
// `selected` size change needs a fresh native snapshot) so churn stays scoped to the
// pin that changed — mirrors AtlasMapView's inner PinMarker. Avatar pins hold
// tracksViewChanges TRUE until the avatar image fires onLoad (then a 300ms window
// → false) so the native snapshot isn't a blank circle (TICKET-131).
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
    const isNetwork = item.entryId != null;
    const hasAvatarImage = isNetwork && !!item.author?.avatar;
    // No avatar bitmap to wait for → "loaded" from the start.
    const [avatarLoaded, setAvatarLoaded] = useState(!hasAvatarImage);
    const [tracking, setTracking] = useState(true);
    useEffect(() => {
        setTracking(true);
        if (!avatarLoaded) return; // hold true until the avatar image decodes
        const t = setTimeout(() => setTracking(false), isNetwork ? 300 : 500);
        return () => clearTimeout(t);
    }, [selected, avatarLoaded, isNetwork]);

    return (
        <Marker
            coordinate={coordinate}
            // Avatar pins have a tail → anchor bottom-center; teardrops center.
            anchor={isNetwork ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
            tracksViewChanges={tracking}
            stopPropagation
            onPress={onPress}
        >
            {isNetwork ? (
                <AvatarPin
                    item={item}
                    selected={selected}
                    palette={palette}
                    onAvatarLoad={() => setAvatarLoaded(true)}
                />
            ) : (
                <WishlistPin selected={selected} palette={palette} emoji={item.emoji} been={item.been} />
            )}
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
    onOpenReview,
    onSwitchToList,
    sources,
    onOpenFilters,
    filtersActive,
    chromeTopOffset,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapViewType>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Scheme follows the palette the parent passed (the app's use-color-scheme
    // hook is hard-forced to 'light', so a hook call here can't see dark; the
    // palette reference is the render-truth either way).
    const isDark = palette !== Colors.light;

    // TICKET-131: key-gated Google-on-iOS flip. The runtime manifest STRIPS
    // ios.config, so the key can never be read from there (cold-review P1,
    // 2026-07-08 — the old read was permanently undefined). app.config mirrors
    // the key's PRESENCE into extra.hasGoogleMapsIosKey; the same env var
    // compiles the native Google pods in at prebuild, so this flag ⇔ native
    // support by construction. Android is already Google + heirloom style.
    const iosGoogleTiles =
        Platform.OS === 'ios' && Constants.expoConfig?.extra?.hasGoogleMapsIosKey === true;
    const googleTiles = Platform.OS === 'android' || iosGoogleTiles;
    // Vellum wash — Apple-Maps-only warm tint (TICKET-057 idiom), light scheme
    // only (dark tiles don't want a cream veil).
    const showVellumWash = Platform.OS === 'ios' && !iosGoogleTiles && !isDark;

    // Frost family for the floating chrome. Light = scrimFrost token; dark pair
    // is inline by design (no new theme tokens — TICKET-131).
    const frostBg = isDark ? FROST_DARK : palette.scrimFrost;
    const chromeTop = chromeTopOffset ?? 12;

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

    // Cold-review P2 fix (2026-07-08): a layer SWITCH re-frames to the new
    // layer's pins — without this, a Been/Network layer whose spots live in
    // another part of town renders entirely off-screen. The initial layer keeps
    // the user-centric framing above; only a CHANGE of sources.value fits, and
    // only once its pins have arrived (lazy layers load on first select). Item
    // churn on the same layer (filters, refetch) never re-frames.
    const framedSourceRef = useRef(sources?.value);
    useEffect(() => {
        if (!sources || sources.value === framedSourceRef.current) return;
        if (items.length === 0) return; // layer still loading — wait for pins
        framedSourceRef.current = sources.value;
        const timer = setTimeout(() => {
            if (items.length === 1) {
                mapRef.current?.animateCamera(
                    { center: { latitude: items[0].lat, longitude: items[0].lng }, zoom: 14 },
                    { duration: 350 },
                );
            } else {
                mapRef.current?.fitToCoordinates(
                    items.slice(0, 50).map((i) => ({ latitude: i.lat, longitude: i.lng })),
                    { edgePadding: { top: 120, right: 60, bottom: 200, left: 60 }, animated: true },
                );
            }
        }, 350); // let a remounting MapView (empty→loaded flip) attach first
        return () => clearTimeout(timer);
    }, [sources, items]);

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

    // ── Source pills (TICKET-131) — frosted segmented, top-LEFT on the glass ────
    // Shown in BOTH the empty state and the populated map so switching back from
    // an empty layer is always possible. Hidden while a peek is up (the existing
    // three-piece hide set: source pills · locate FAB · List pill).
    const renderSourcePills = (visible: boolean) =>
        sources && visible ? (
            <View
                style={[
                    styles.sourcePills,
                    { backgroundColor: frostBg, top: chromeTop },
                    Shadow.ambient,
                ]}
            >
                {sources.options.map((opt) => {
                    const active = sources.value === opt.key;
                    return (
                        <Pressable
                            key={opt.key}
                            onPress={() => sources.onChange(opt.key)}
                            style={[styles.sourcePillBtn, active && { backgroundColor: palette.primary }]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                        >
                            <Text
                                style={[
                                    styles.sourcePillText,
                                    { color: active ? '#fff' : palette.textSecondary },
                                ]}
                            >
                                {opt.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        ) : null;

    // ── Filter chip — top-right, frosted; opens the screen-owned tabbed filter
    // sheet. Rendered in BOTH branches (cold-review P2, 2026-07-08: filtering a
    // layer down to zero must leave a way to reopen the sheet and clear it).
    const renderFilterChip = () =>
        onOpenFilters ? (
            <Pressable
                onPress={onOpenFilters}
                style={[
                    styles.filterChip,
                    { backgroundColor: frostBg, top: chromeTop },
                    Shadow.ambient,
                ]}
                accessibilityRole="button"
                accessibilityLabel="filters"
            >
                <Ionicons
                    name="options-outline"
                    size={14}
                    color={filtersActive ? palette.primary : palette.textSecondary}
                />
                <Text
                    style={[
                        styles.filterChipText,
                        { color: filtersActive ? palette.primary : palette.textSecondary },
                    ]}
                >
                    Filter
                </Text>
                {filtersActive ? (
                    <View style={[styles.filterChipDot, { backgroundColor: palette.primary }]} />
                ) : null}
            </Pressable>
        ) : null;

    // ── List pill — bottom-left, frosted. Also in both branches (same review
    // finding: an empty layer must not strand you on the map).
    const renderListPill = (visible: boolean) =>
        visible && onSwitchToList ? (
            <Pressable
                onPress={onSwitchToList}
                style={[
                    styles.listToggle,
                    { backgroundColor: frostBg, bottom: insets.bottom + NAV_CLEARANCE },
                    Shadow.ambient,
                ]}
                accessibilityRole="button"
                accessibilityLabel="list view"
            >
                <Ionicons name="list" size={15} color={palette.primary} />
                <Text style={[styles.listToggleText, { color: palette.primary }]}>List</Text>
            </Pressable>
        ) : null;

    // ── Empty (per-layer copy; pills/chip/List stay so you can always leave) ──
    if (items.length === 0) {
        const emptyCopy =
            sources?.value === 'network'
                ? 'no spots from people you follow yet.'
                : sources?.value === 'been'
                  ? 'no logged spots with a map location yet.'
                  : 'none of your saved spots have a map location yet.';
        return (
            <View style={styles.fill}>
                <View style={[styles.fill, styles.emptyWrap]}>
                    <Ionicons name="map-outline" size={28} color={palette.textMuted} />
                    <Text style={[styles.emptyText, { color: palette.textMuted }]}>{emptyCopy}</Text>
                </View>
                {renderSourcePills(true)}
                {renderFilterChip()}
                {renderListPill(true)}
            </View>
        );
    }

    return (
        <View style={styles.fill}>
            {/* Full-bleed map — edge-to-edge under the screen's header chrome
                (TICKET-131 removed the framed-plate inset). The hairline warm rule
                at the top edge stays. */}
            <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                provider={googleTiles ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                // Google tiles (Android always; iOS when key-gated in) honor
                // customMapStyle → heirloom skin. Keyless iOS = Apple Maps, which
                // ignores customMapStyle → mutedStandard desaturates toward paper
                // and the vellum wash below warms it.
                mapType={googleTiles ? 'standard' : 'mutedStandard'}
                customMapStyle={googleTiles ? heirloomMapStyle : undefined}
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
                        // Layer-qualified key: the same restaurant can appear in
                        // several layers — remounting per layer re-arms each
                        // marker's tracksViewChanges window for the new pin shape.
                        key={`${item.entryId != null ? 'n' : item.been ? 'b' : 's'}:${item.id}`}
                        item={item}
                        selected={selectedId === item.id}
                        palette={palette}
                        onPress={() => setSelectedId(item.id)}
                    />
                ))}
            </MapView>

            {/* Vellum wash — warm the Apple raster toward the paper palette
                (TICKET-057 idiom). Light scheme + keyless iOS only. */}
            {showVellumWash ? (
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            backgroundColor: palette.placesOverlayTint,
                            opacity: palette.placesOverlayOpacity,
                        },
                    ]}
                    pointerEvents="none"
                />
            ) : null}

            {/* Hairline warm rule at the top edge (ghosted, not a 1px border). */}
            <View
                style={[styles.topRule, { backgroundColor: palette.ruleInkSoft }]}
                pointerEvents="none"
            />

            {/* Source pills — top-left, frosted. Hidden while a peek is up. */}
            {renderSourcePills(!selected)}

            {/* Filter chip — top-right, frosted (shared with the empty branch). */}
            {renderFilterChip()}

            {/* Unmappable murmur — saved layer only (parents pass 0 otherwise),
                frost family, tucked below the source pills. */}
            {unmappableCount > 0 ? (
                <View
                    style={[styles.murmurWrap, { top: sources ? chromeTop + 46 : chromeTop }]}
                    pointerEvents="none"
                >
                    <View style={[styles.murmurPill, { backgroundColor: frostBg }, Shadow.ambient]}>
                        <Text style={[styles.murmurText, { color: palette.textMuted }]}>
                            {`${unmappableCount} saved ${unmappableCount === 1 ? 'spot has' : 'spots have'} no map location`}
                        </Text>
                    </View>
                </View>
            ) : null}

            {/* Locate FAB — bottom-RIGHT frosted circle, clear of the floating
                nav pill. Hidden once a peek card is up (card owns the bottom). */}
            {!selected ? (
                <Pressable
                    onPress={handleRecenter}
                    style={[
                        styles.fab,
                        { backgroundColor: frostBg, bottom: insets.bottom + NAV_CLEARANCE },
                        Shadow.ambient,
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

            {/* List pill — bottom-LEFT, frosted, same elevation as the FAB.
                Hidden while a peek card is up (shared with the empty branch). */}
            {renderListPill(!selected)}

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
                    onOpenReview={onOpenReview}
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
    /** TICKET-124: network pins tap through to a followee's review, not directions. */
    onOpenReview?: (entryId: string) => void;
}

function PeekCard({ item, userCoords, palette, bottomInset, onClose, onOpen, onOpenReview }: PeekCardProps) {
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

    const shell = (children: React.ReactNode) => (
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
            {children}
        </Animated.View>
    );

    // ── Network variant — a followee's LOG (TICKET-124) ─────────────────────────
    // Gated on entryId (presence = network pin). ONE body affordance, routed by
    // data: a review-eligible primary entry (hasReview) taps through to their
    // review (entry-detail, viewAs public); a thin/rating-only log — which the
    // looser network predicate deliberately includes — taps to the restaurant page
    // instead, since entry-detail's public view can't render it (it fails the
    // is_entry_publicly_eligible pre-check). Degrades gracefully — no note →
    // rating-only meta → name-only (no empty pull-quote).
    if (item.entryId != null) {
        const authorName = item.author?.name ?? 'Someone';
        const others = item.othersCount ?? 0;
        const attribution =
            others > 0
                ? `${authorName} +${others} ${others === 1 ? 'other' : 'others'}`
                : authorName;
        const meta = [attribution, distanceLabel, item.city].filter(Boolean).join(' · ');
        const note = item.note?.trim() || null;
        const opensReview = !!item.hasReview && !!onOpenReview;
        const onPressBody = opensReview ? () => onOpenReview!(item.entryId!) : onOpen;
        return shell(
            <>
                <Pressable
                    style={styles.peekBody}
                    onPress={onPressBody}
                    accessibilityLabel={
                        opensReview
                            ? `Open ${authorName}'s review of ${item.name}`
                            : `Open ${item.name}`
                    }
                >
                    <View style={styles.peekNameRow}>
                        <Text style={[styles.peekName, styles.peekNameFlex, { color: palette.text }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        {item.rating != null ? (
                            <Text style={[styles.peekRating, { color: palette.primary }]}>
                                {item.rating.toFixed(1)}
                            </Text>
                        ) : null}
                    </View>
                    {meta ? (
                        <Text style={[styles.peekMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {meta}
                        </Text>
                    ) : null}
                    {note ? (
                        <Text style={[styles.peekNote, { color: palette.textSecondary }]} numberOfLines={2}>
                            {`— ${note}`}
                        </Text>
                    ) : null}
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
            </>,
        );
    }

    // ── Mine variant — a saved/been spot (existing, directions-first) ───────────
    const meta = [distanceLabel, item.city, item.cuisine].filter(Boolean).join(' · ');
    return shell(
        <>
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
        </>,
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    fill: { flex: 1 },
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
    // Source pills — frosted segmented control, top-left on the glass.
    sourcePills: {
        position: 'absolute',
        left: 16,
        flexDirection: 'row',
        borderRadius: 999,
        padding: 3,
        gap: 2,
    },
    sourcePillBtn: {
        paddingHorizontal: 13,
        paddingVertical: 7,
        borderRadius: 999,
    },
    sourcePillText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    // Filter chip — frosted, top-right on the glass.
    filterChip: {
        position: 'absolute',
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    filterChipText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    filterChipDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    // Unmappable murmur — frost family, below the source pills.
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
    },
    murmurText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    // Locate FAB — bottom-RIGHT frosted circle, clear of the floating nav pill.
    fab: {
        position: 'absolute',
        right: 16,
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // List pill (map → list) — bottom-LEFT, same frost family + elevation.
    listToggle: {
        position: 'absolute',
        left: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 11,
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
    // Network variant: name shares its row with the rating numeral.
    peekNameRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
    },
    peekNameFlex: {
        flex: 1,
    },
    // Rating numeral — the brand's italic-serif rating moment, terracotta.
    peekRating: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 19,
        lineHeight: 23,
    },
    // Followee's note snippet — em-dash pull-quote, italic serif.
    peekNote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        lineHeight: 18,
        marginTop: 3,
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
