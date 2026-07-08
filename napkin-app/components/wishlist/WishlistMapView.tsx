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
 *   - pins (map-card-pin pass, 2026-07-08): ONE bubble grammar for every layer —
 *     the bubble carries the WHAT (cuisine glyph, or the owning list's emoji),
 *     the ring carries YOUR RELATIONSHIP (terracotta = saved, olive = been,
 *     warm ink = network), an avatar chip carries the WHO (network pins), and
 *     a terracotta heart badge = loved (rating ≥ LOVED_MIN). No more
 *     initials-as-pins: discovery reads from the pin itself.
 *   - peek = a swipeable CAROUSEL of cards (nearest-first), synced with pin
 *     selection both ways; each card: glyph/emoji plate (typographic — NO
 *     restaurant photos: restaurants.photo_url is always a Places hero, banned
 *     on our surfaces), name + rating, cuisine · $$ · distance meta, saved-by
 *     row (network), note pull-quote, explicit CTAs (view venue / directions /
 *     save).
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Platform,
    Linking,
    Animated,
    Dimensions,
    FlatList,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
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
import { cuisineGlyph, tintIndex } from '@/lib/cuisineGlyph';
import { priceTierLabel } from '@/lib/priceLevel';

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
     * "Mine") — renders the bubble ring in olive (`palette.secondary`) instead
     * of terracotta. Set by the shared mappers in mapItems.ts; absent on saves.
     */
    been?: boolean;
    /** Google Places price tier (0–4) → "$$" token on the peek card meta. */
    priceLevel?: number | null;
    /** Viewer's own avg rating at this spot (been/mine layers) — the card's
     * rating numeral + the loved (≥ LOVED_MIN) heart badge on the pin. */
    myRating?: number | null;
    /** Viewer's visit count (been/mine layers) — quiet card meta when > 1. */
    visitCount?: number;
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
     * Save-from-the-map (map-card-pin pass): network cards render a Save pill
     * so a followee's spot can be pinned without leaving the map (the rec'd
     * card's core affordance). `savedIds` = restaurants already on the viewer's
     * wishlist (partial is fine — the add action is idempotent server-side);
     * `onSave` fires the screen-owned useWishlistAdd mutation. Absent → no
     * Save pill (nothing breaks).
     */
    save?: {
        savedIds: ReadonlySet<string>;
        onSave: (item: WishlistMapItem) => void;
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
/** A rating at/above this = "loved" → terracotta heart badge on the pin. */
const LOVED_MIN = 4.5;

// ── Framing deltas ──────────────────────────────────────────────────────────────
// ONE region API for all camera moves: Camera.zoom is GOOGLE-ONLY — Apple Maps
// keys on altitude and silently ignores zoom, which is why the locate FAB
// centered without ever zooming (founder, 2026-07-08). animateToRegion behaves
// identically on both providers. latitudeDelta ≈ 360 / 2^zoom.
/** Locate FAB — zoom IN to a walkable radius (≈ zoom 15); pins stay legible. */
const NEAR_ME_DELTA = 0.013;
/** First frame on open — the "near me" city view (≈ zoom 13, the original
 * framing intent that the zoom param never actually applied on Apple). */
const CITY_DELTA = 0.045;
/** Layer switch landing on a single spot (≈ zoom 14). */
const SPOT_DELTA = 0.022;
/** Network pin ring — warm ink, deliberately NOT a third accent color
 * (terracotta + olive are this screen's two; network stays neutral). */
const INK_RING_LIGHT = 'rgba(28,28,25,0.32)';
const INK_RING_DARK = 'rgba(253,246,236,0.5)';

// ── Peek carousel geometry ──────────────────────────────────────────────────────
// Near-full-width card with the next card peeking at the right edge (the rec'd
// swipe-for-more grammar). Snap math depends on these being fixed: getItemLayout
// offsets are i*PEEK_SNAP (the 18px left pad is deliberately excluded — snap
// offsets stay exact multiples, and the pad shows the neighbor's edge).
const SCREEN_W = Dimensions.get('window').width;
const PEEK_PAD_L = 18;
const PEEK_CARD_W = SCREEN_W - 56;
const PEEK_GAP = 10;
const PEEK_SNAP = PEEK_CARD_W + PEEK_GAP;

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

// ── BubblePin (map-card-pin pass, 2026-07-08) ───────────────────────────────────
// ONE pin grammar for every layer, so discovery reads from the pin itself
// (founder: "the name J as a pin is not suitable for discovery"):
//   bubble  = WHAT   — cuisine glyph (lib/cuisineGlyph, same mapping as the
//             feed ledger's GlyphChip) or the owning list's emoji (TICKET-108
//             precedence unchanged: emoji is more specific, it wins)
//   ring    = YOURS  — terracotta saved · olive been · warm-ink network
//   chip    = WHO    — followee avatar, network pins only (top-left, rec'd
//             anatomy; initial-on-tint fallback, same seeded triple as Avatar)
//   badge   = LOVED  — terracotta heart when the rating ≥ LOVED_MIN; network
//             pins without a loved rating keep the review dot (routing hint)
// Cream paper fill (not solid color blocks — 40 solid terracotta bubbles would
// rash the vellum); a small tail in the ring color anchors the coordinate
// (marker anchors {0.5, 1} = tail tip).

function avatarTintFor(seed: string, palette: typeof Colors.light): string {
    const tints = [
        palette.tertiaryFixed, // amber-cream
        palette.secondaryContainer, // olive-cream
        palette.primaryMuted, // terracotta-muted
    ];
    return tints[(seed.charCodeAt(0) || 0) % tints.length];
}

function BubblePin({
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
    const isDark = palette !== Colors.light;
    const isNetwork = item.entryId != null;
    const ringColor = isNetwork
        ? isDark
            ? INK_RING_DARK
            : INK_RING_LIGHT
        : item.been
          ? palette.secondary
          : palette.primary;
    const rating = isNetwork ? item.rating : item.myRating;
    const loved = rating != null && rating >= LOVED_MIN && (isNetwork || !!item.been);
    const size = selected ? 38 : 32;
    const ring = selected ? 3 : 2.5;
    const fill = isDark ? palette.surfaceContainerHigh : CREAM;

    const avatar = item.author?.avatar ?? null;
    const authorName = item.author?.name ?? 'Someone';
    const chipTint = avatarTintFor(item.author?.id || authorName, palette);
    const CHIP = 18;

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
                        borderColor: ringColor,
                        backgroundColor: fill,
                        shadowOpacity: selected ? 0.3 : 0.22,
                    },
                ]}
            >
                {item.emoji ? (
                    <Text style={{ fontSize: selected ? 17 : 15, includeFontPadding: false }}>
                        {item.emoji}
                    </Text>
                ) : (
                    <Ionicons
                        name={cuisineGlyph(item.cuisine)}
                        size={selected ? 18 : 15}
                        color={palette.primary}
                        style={pinStyles.glyph}
                    />
                )}

                {/* WHO — followee avatar chip, network pins only. */}
                {isNetwork ? (
                    <View
                        style={[
                            pinStyles.chip,
                            {
                                width: CHIP,
                                height: CHIP,
                                borderRadius: CHIP / 2,
                                borderColor: fill,
                                backgroundColor: chipTint,
                            },
                        ]}
                    >
                        {avatar ? (
                            <ExpoImage
                                source={{ uri: avatar }}
                                style={{ width: CHIP - 3, height: CHIP - 3, borderRadius: (CHIP - 3) / 2 }}
                                contentFit="cover"
                                onLoad={onAvatarLoad}
                                // A 404ing avatar must still settle tracksViewChanges,
                                // or this marker re-snapshots every frame forever.
                                onError={onAvatarLoad}
                            />
                        ) : (
                            <Text style={[pinStyles.chipInitial, { color: palette.text }]}>
                                {(authorName.trim()[0] ?? '?').toUpperCase()}
                            </Text>
                        )}
                    </View>
                ) : null}

                {/* LOVED heart, else the network review dot (routing hint). */}
                {loved ? (
                    <View
                        style={[
                            pinStyles.lovedBadge,
                            { backgroundColor: palette.primary, borderColor: fill },
                        ]}
                    >
                        <Ionicons name="heart" size={8} color={CREAM} />
                    </View>
                ) : isNetwork && item.hasReview ? (
                    <View
                        style={[
                            pinStyles.reviewDot,
                            { backgroundColor: palette.primary, borderColor: fill },
                        ]}
                    />
                ) : null}
            </View>
            {/* Tail — border-trick triangle in the ring color; tip = coordinate. */}
            <View style={[pinStyles.tail, { borderTopColor: ringColor }]} />
        </View>
    );
}

const pinStyles = StyleSheet.create({
    // 56-wide hit area (≥ iOS HIG min target) with 6px headroom so the avatar
    // chip (left overhang) and loved/review badges (top overhang) stay INSIDE
    // the wrap — react-native-maps snapshots the marker view; content outside
    // its bounds risks getting clipped. Marker anchors {0.5, 1} = tail tip on
    // the coordinate.
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
    glyph: {
        opacity: 0.85,
    },
    chip: {
        position: 'absolute',
        top: -6,
        left: -8,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    chipInitial: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        includeFontPadding: false,
        textAlign: 'center',
    },
    lovedBadge: {
        position: 'absolute',
        top: -5,
        right: -6,
        width: 15,
        height: 15,
        borderRadius: 7.5,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    reviewDot: {
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
            // Every bubble has a tail now → anchor bottom-center (tail tip = coordinate).
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracking}
            stopPropagation
            onPress={onPress}
        >
            <BubblePin
                item={item}
                selected={selected}
                palette={palette}
                onAvatarLoad={() => setAvatarLoaded(true)}
            />
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
    save,
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
    // Vellum wash — Apple-Maps-only warm tint (TICKET-057 idiom). The tiles are
    // pinned light (userInterfaceStyle below), so the wash applies regardless
    // of the app scheme — there are no dark tiles to veil anymore.
    const showVellumWash = Platform.OS === 'ios' && !iosGoogleTiles;

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
                mapRef.current?.animateToRegion(
                    {
                        latitude: userCoords.latitude,
                        longitude: userCoords.longitude,
                        latitudeDelta: CITY_DELTA,
                        longitudeDelta: CITY_DELTA,
                    },
                    300,
                );
                framedRef.current = true;
            } else if (locationStatus !== 'pending') {
                mapRef.current?.animateToRegion(
                    {
                        latitude: items[0].lat,
                        longitude: items[0].lng,
                        latitudeDelta: CITY_DELTA,
                        longitudeDelta: CITY_DELTA,
                    },
                    300,
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
                mapRef.current?.animateToRegion(
                    {
                        latitude: items[0].lat,
                        longitude: items[0].lng,
                        latitudeDelta: SPOT_DELTA,
                        longitudeDelta: SPOT_DELTA,
                    },
                    350,
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

    // Locate FAB: center on the user AND zoom in to a walkable radius — the
    // founder's explicit ask (centering alone left the map at city zoom).
    const handleRecenter = () => {
        if (locationStatus === 'granted' && userCoords) {
            mapRef.current?.animateToRegion(
                {
                    latitude: userCoords.latitude,
                    longitude: userCoords.longitude,
                    latitudeDelta: NEAR_ME_DELTA,
                    longitudeDelta: NEAR_ME_DELTA,
                },
                350,
            );
        } else {
            onRequestLocation();
        }
    };

    const selected = useMemo(
        () => items.find((i) => i.id === selectedId) ?? null,
        [items, selectedId],
    );

    // Carousel order — nearest-first when we know where the user is, so a swipe
    // right reads "more spots around here" (the rec'd grammar). Without location
    // the source order stands. useNearbyLocation resolves once (no live stream),
    // so the order can't reshuffle mid-swipe.
    const orderedItems = useMemo(() => {
        if (!userCoords) return items;
        return [...items]
            .map((item) => ({
                item,
                d: haversineMiles(userCoords, { latitude: item.lat, longitude: item.lng }),
            }))
            .sort((a, b) => a.d - b.d)
            .map((x) => x.item);
    }, [items, userCoords]);

    // Swiping the carousel selects the pin AND pans the camera to it (center
    // only — the current zoom is the user's, don't fight it).
    const handleCarouselSelect = useCallback((item: WishlistMapItem) => {
        setSelectedId(item.id);
        mapRef.current?.animateCamera(
            { center: { latitude: item.lat, longitude: item.lng } },
            { duration: 260 },
        );
    }, []);

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
                : sources?.value === 'been' || sources?.value === 'mine'
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
                // The map NEVER goes dark (founder, 2026-07-08; TICKET-134 ⑧:
                // the map reads as a paper object). Apple tiles follow the
                // SYSTEM appearance — not our light-forced palette — so system
                // dark mode was swapping grey tiles under the cream chrome.
                userInterfaceStyle="light"
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

            {/* Peek carousel — rises when a pin is tapped; swipe for what's
                nearby. No key: it must NOT remount (re-animate) per pin change,
                only on closed → open. */}
            {selected ? (
                <PeekCarousel
                    items={orderedItems}
                    selectedId={selected.id}
                    userCoords={userCoords}
                    palette={palette}
                    bottomInset={insets.bottom + NAV_CLEARANCE}
                    onSelect={handleCarouselSelect}
                    onClose={() => setSelectedId(null)}
                    onOpenRestaurant={onOpenRestaurant}
                    onOpenReview={onOpenReview}
                    save={save}
                />
            ) : null}
        </View>
    );
}

// ── PeekCarousel (map-card-pin pass, 2026-07-08) ─────────────────────────────────
// The peek is a swipeable rail of cards, nearest-first — swipe right for more
// spots in the vicinity (rec'd grammar). Selection syncs both ways: pin tap →
// the carousel scrolls to that card; card swipe → that pin selects + the camera
// pans. One frosted ✕ floats above the rail (map-tap also closes, as before).

interface PeekCarouselProps {
    items: WishlistMapItem[];
    selectedId: string;
    userCoords: GeoLatLng | null;
    palette: typeof Colors.light;
    bottomInset: number;
    onSelect: (item: WishlistMapItem) => void;
    onClose: () => void;
    onOpenRestaurant: (restaurantId: string) => void;
    /** TICKET-124: review-eligible network cards tap through to the review. */
    onOpenReview?: (entryId: string) => void;
    save?: Props['save'];
}

function PeekCarousel({
    items,
    selectedId,
    userCoords,
    palette,
    bottomInset,
    onSelect,
    onClose,
    onOpenRestaurant,
    onOpenReview,
    save,
}: PeekCarouselProps) {
    const listRef = useRef<FlatList<WishlistMapItem>>(null);
    const slide = useRef(new Animated.Value(48)).current;
    const fade = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.parallel([
            Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240 }),
            Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]).start();
    }, [slide, fade]);

    // Layers never mix in one items array, so the card height is uniform per
    // open: network cards carry a saved-by row + note line, mine cards don't.
    const isNetworkLayer = items.some((i) => i.entryId != null);
    const cardH = isNetworkLayer ? 178 : 136;

    // Mount at the tapped pin's card (getItemLayout makes initialScrollIndex
    // cheap). Captured once — later selection changes scroll, not remount.
    const initialIndexRef = useRef(Math.max(0, items.findIndex((i) => i.id === selectedId)));
    // A swipe-driven selection must NOT trigger the programmatic scroll-back
    // (it would fight the momentum the user just spent).
    const swipeIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (swipeIdRef.current === selectedId) {
            swipeIdRef.current = null;
            return;
        }
        const idx = items.findIndex((i) => i.id === selectedId);
        if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true });
    }, [selectedId, items]);

    const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const idx = Math.min(items.length - 1, Math.max(0, Math.round(x / PEEK_SNAP)));
        const item = items[idx];
        if (item && item.id !== selectedId) {
            swipeIdRef.current = item.id;
            onSelect(item);
        }
    };

    const isDark = palette !== Colors.light;

    return (
        <Animated.View
            style={[
                styles.peekWrap,
                {
                    bottom: bottomInset,
                    // 16px headroom so the ✕ (overlapping the card's top-right
                    // corner) stays fully INSIDE the wrap — iOS hit-testing
                    // ignores touches outside a parent's bounds.
                    height: cardH + 16,
                    opacity: fade,
                    transform: [{ translateY: slide }],
                },
            ]}
            pointerEvents="box-none"
        >
            {/* One frosted ✕ above the rail — stays put while cards swipe. */}
            <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="close"
                style={[
                    styles.peekCloseFab,
                    { backgroundColor: isDark ? FROST_DARK : palette.scrimFrost },
                    Shadow.ambient,
                ]}
            >
                <Ionicons name="close" size={16} color={palette.textSecondary} />
            </Pressable>

            <FlatList
                ref={listRef}
                data={items}
                keyExtractor={(i) => i.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={initialIndexRef.current}
                getItemLayout={(_, index) => ({ length: PEEK_SNAP, offset: PEEK_SNAP * index, index })}
                onScrollToIndexFailed={({ index }) =>
                    listRef.current?.scrollToOffset({ offset: PEEK_SNAP * index, animated: false })
                }
                snapToInterval={PEEK_SNAP}
                snapToAlignment="start"
                decelerationRate="fast"
                disableIntervalMomentum
                onMomentumScrollEnd={handleMomentumEnd}
                contentContainerStyle={{
                    paddingLeft: PEEK_PAD_L,
                    paddingRight: Math.max(0, SCREEN_W - PEEK_CARD_W - PEEK_PAD_L),
                    paddingTop: 16,
                }}
                // Shadows bleed past cell bounds — don't clip them away.
                removeClippedSubviews={false}
                initialNumToRender={3}
                windowSize={5}
                renderItem={({ item }) => (
                    <PeekCardBody
                        item={item}
                        userCoords={userCoords}
                        palette={palette}
                        height={cardH}
                        onOpenRestaurant={onOpenRestaurant}
                        onOpenReview={onOpenReview}
                        save={save}
                    />
                )}
            />
        </Animated.View>
    );
}

// ── PeekCardBody — one card in the rail ─────────────────────────────────────────
// Anatomy (rec'd parity, Heirloom voice): leading GLYPH PLATE (cuisine glyph /
// list emoji on a seeded tint — typographic identity; restaurants.photo_url is
// always a Places hero photo, banned on our surfaces, and lists already killed
// thumbnails in TICKET-084), name + rating numeral, cuisine · $$ · distance
// meta, saved-by row (network), — note pull-quote (network), then explicit
// CTAs: view venue everywhere; directions (mine) / save (network).

interface PeekCardBodyProps {
    item: WishlistMapItem;
    userCoords: GeoLatLng | null;
    palette: typeof Colors.light;
    height: number;
    onOpenRestaurant: (restaurantId: string) => void;
    onOpenReview?: (entryId: string) => void;
    save?: Props['save'];
}

function PeekCardBody({
    item,
    userCoords,
    palette,
    height,
    onOpenRestaurant,
    onOpenReview,
    save,
}: PeekCardBodyProps) {
    const isNetwork = item.entryId != null;
    // Optimistic local flip — the add is idempotent server-side, and the
    // screen's wishlist caches catch up via the mutation's own patches.
    const [savedNow, setSavedNow] = useState(false);
    const alreadySaved = savedNow || !!save?.savedIds.has(item.id);

    const distanceLabel = userCoords
        ? formatDistance(haversineMiles(userCoords, { latitude: item.lat, longitude: item.lng }))
        : null;
    const price = priceTierLabel(item.priceLevel);
    const visits =
        !isNetwork && item.been && (item.visitCount ?? 0) > 1 ? `${item.visitCount} visits` : null;
    const meta = (
        isNetwork
            ? [item.cuisine, distanceLabel ?? item.city]
            : [item.cuisine, price, distanceLabel ?? item.city, visits]
    )
        .filter(Boolean)
        .join(' · ');

    const rating = isNetwork ? item.rating : item.been ? item.myRating : null;

    // Body tap keeps the TICKET-124 routing: review-eligible network log → the
    // followee's review; everything else → the restaurant page.
    const opensReview = isNetwork && !!item.hasReview && !!onOpenReview;
    const onPressBody = opensReview
        ? () => onOpenReview!(item.entryId!)
        : () => onOpenRestaurant(item.id);

    const authorName = item.author?.name ?? 'Someone';
    const others = item.othersCount ?? 0;
    const attribution = others > 0 ? `${authorName} +${others} ${others === 1 ? 'other' : 'others'}` : authorName;
    const note = isNetwork ? item.note?.trim() || null : null;

    // Plate tint — GlyphChip's seeded triple (feed ledger ↔ map speak the same).
    const plateTints = [palette.surfaceJournal, palette.oliveCream, palette.tertiaryFixed] as const;
    const plateTint = plateTints[tintIndex(item.id)];

    return (
        <View style={[styles.peekCard, { backgroundColor: palette.surfaceContainerLow, height }]}>
            <Pressable
                style={styles.peekBody}
                onPress={onPressBody}
                accessibilityLabel={
                    opensReview ? `Open ${authorName}'s review of ${item.name}` : `Open ${item.name}`
                }
            >
                <View style={styles.peekTopRow}>
                    <View style={[styles.peekPlate, { backgroundColor: plateTint }]}>
                        <View style={styles.peekPlateInset} />
                        {item.emoji ? (
                            <Text style={styles.peekPlateEmoji}>{item.emoji}</Text>
                        ) : (
                            <Ionicons
                                name={cuisineGlyph(item.cuisine)}
                                size={22}
                                color={palette.primary}
                                style={styles.peekPlateGlyph}
                            />
                        )}
                    </View>
                    <View style={styles.peekTitleCol}>
                        <Text style={[styles.peekName, { color: palette.text }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        {meta ? (
                            <Text style={[styles.peekMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                {meta}
                            </Text>
                        ) : null}
                    </View>
                    {rating != null ? (
                        <Text style={[styles.peekRating, { color: palette.primary }]}>
                            {rating.toFixed(1)}
                        </Text>
                    ) : null}
                </View>

                {/* Saved-by row + pull-quote — network cards only. */}
                {isNetwork ? (
                    <View style={styles.peekWhoRow}>
                        <PeekWhoAvatar author={item.author} palette={palette} />
                        <Text
                            style={[styles.peekWhoText, { color: palette.textSecondary }]}
                            numberOfLines={1}
                        >
                            {attribution}
                        </Text>
                    </View>
                ) : null}
                {note ? (
                    <Text style={[styles.peekNote, { color: palette.textSecondary }]} numberOfLines={1}>
                        {`— ${note}`}
                    </Text>
                ) : null}
            </Pressable>

            <View style={styles.peekActions}>
                <Pressable
                    onPress={() => onOpenRestaurant(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${item.name}`}
                    style={({ pressed }) => [
                        styles.viewVenueBtn,
                        { backgroundColor: palette.surfaceContainerHigh, opacity: pressed ? 0.7 : 1 },
                    ]}
                >
                    <Text style={[styles.viewVenueLabel, { color: palette.text }]}>view venue</Text>
                    <Ionicons name="arrow-forward" size={13} color={palette.text} />
                </Pressable>

                {isNetwork && save ? (
                    <Pressable
                        onPress={() => {
                            if (alreadySaved) return;
                            setSavedNow(true);
                            save.onSave(item);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: alreadySaved }}
                        accessibilityLabel={alreadySaved ? 'saved to wishlist' : 'save to wishlist'}
                        style={({ pressed }) => [
                            styles.sidePill,
                            alreadySaved
                                ? { backgroundColor: palette.primaryMuted }
                                : { borderWidth: 1.5, borderColor: 'rgba(160,63,40,0.35)' },
                            { opacity: pressed && !alreadySaved ? 0.7 : 1 },
                        ]}
                    >
                        <Ionicons
                            name={alreadySaved ? 'heart' : 'heart-outline'}
                            size={15}
                            color={palette.primary}
                        />
                        <Text style={[styles.sidePillLabel, { color: palette.primary }]}>
                            {alreadySaved ? 'saved' : 'save'}
                        </Text>
                    </Pressable>
                ) : null}

                {!isNetwork ? (
                    <Pressable
                        onPress={() => openDirections(item)}
                        accessibilityRole="button"
                        accessibilityLabel="directions"
                        style={({ pressed }) => [
                            styles.sidePill,
                            {
                                borderWidth: 1.5,
                                borderColor: 'rgba(160,63,40,0.35)',
                                opacity: pressed ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Ionicons name="navigate-outline" size={15} color={palette.primary} />
                        <Text style={[styles.sidePillLabel, { color: palette.primary }]}>directions</Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

/** 16px saved-by avatar — image, or initial on the seeded tint (matches the pin chip). */
function PeekWhoAvatar({
    author,
    palette,
}: {
    author: WishlistMapItem['author'];
    palette: typeof Colors.light;
}) {
    const name = author?.name ?? 'Someone';
    const tint = avatarTintFor(author?.id || name, palette);
    return author?.avatar ? (
        <ExpoImage source={{ uri: author.avatar }} style={styles.peekWhoAvatar} contentFit="cover" />
    ) : (
        <View style={[styles.peekWhoAvatar, { backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={[styles.peekWhoInitial, { color: palette.text }]}>
                {(name.trim()[0] ?? '?').toUpperCase()}
            </Text>
        </View>
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
    // ── Peek carousel ──────────────────────────────────────────────────────────
    peekWrap: {
        position: 'absolute',
        left: 0,
        right: 0,
    },
    // Frosted ✕ overlapping the rail's top-right corner — one, not per-card.
    peekCloseFab: {
        position: 'absolute',
        top: 0,
        right: 16,
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    peekCard: {
        width: PEEK_CARD_W,
        marginRight: PEEK_GAP,
        borderRadius: 16,
        paddingVertical: 13,
        paddingHorizontal: 15,
        justifyContent: 'space-between',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
        elevation: 10,
    },
    peekBody: {
        flex: 1,
        gap: 5,
    },
    peekTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
    },
    // Leading plate — glyph/emoji on a seeded tint (GlyphChip idiom: engraved
    // inset rule). Typographic by doctrine — never a restaurant photo.
    peekPlate: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    peekPlateInset: {
        position: 'absolute',
        top: 3.5,
        left: 3.5,
        right: 3.5,
        bottom: 3.5,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: 'rgba(160,63,40,0.22)',
    },
    peekPlateGlyph: {
        opacity: 0.8,
    },
    peekPlateEmoji: {
        fontSize: 24,
        includeFontPadding: false,
    },
    peekTitleCol: {
        flex: 1,
        gap: 2,
    },
    peekName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 22,
    },
    // Rating numeral — the brand's italic-serif rating moment, terracotta.
    peekRating: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 19,
        lineHeight: 23,
    },
    peekMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Saved-by row — avatar + "{name} +N others" (network cards).
    peekWhoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
    },
    peekWhoAvatar: {
        width: 16,
        height: 16,
        borderRadius: 8,
        overflow: 'hidden',
    },
    peekWhoInitial: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 8,
        includeFontPadding: false,
    },
    peekWhoText: {
        flex: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    // Followee's note snippet — em-dash pull-quote, italic serif.
    peekNote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        lineHeight: 18,
    },
    peekActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 10,
    },
    viewVenueBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 36,
        borderRadius: 12,
    },
    viewVenueLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12.5,
        letterSpacing: 0.2,
    },
    // Side pill — directions (mine) / Save (network), same footprint.
    sidePill: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        height: 36,
        borderRadius: 12,
        paddingHorizontal: 13,
    },
    sidePillLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
});

export default WishlistMapView;
