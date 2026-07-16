/**
 * WishlistMapView — full-bleed warm map of spots, "what's near me right now."
 *
 * TICKET-131 (rec'd-shaped chrome): one map surface grammar shared by the
 * wishlist tab's map mode and the table-map gathered surface:
 *   - source pills float top-LEFT on the glass (frosted segmented)
 *   - optional Filter chip top-RIGHT (opens the screen-owned FilterTabsSheet)
 *   - locate FAB stacked above the List pill, both bottom-RIGHT (corner law v2,
 *     TICKET-137); people chip bottom-LEFT (Discover) — all frosted, all clear
 *     of the floating bottom nav (TICKET-130)
 *   - pins (map-card-pin pass, 2026-07-08): ONE bubble grammar for every layer —
 *     the bubble carries the WHAT (cuisine glyph, or the owning list's emoji),
 *     the ring carries YOUR RELATIONSHIP (terracotta = saved, olive = been,
 *     warm ink = network), an avatar chip carries the WHO (network pins), and
 *     a terracotta heart badge = loved (rating ≥ LOVED_MIN). No more
 *     initials-as-pins: discovery reads from the pin itself.
 *   - peek = a swipeable CAROUSEL of uniform cards (nearest-first), synced with
 *     pin selection both ways; v2 lazily fills an authorized media tile, honest
 *     rating/hours/context slots, and three literal actions without reflow.
 *   - tiles (TICKET-134): MapTiler `landscape` raster via UrlTile on BOTH
 *     platforms — cream land, butter roads, warm-brown labels. iOS replaces the
 *     Apple base (shouldReplaceMapContent — kills the grey dark tiles ⑧);
 *     Android draws over the Google base with heirloomMapStyle beneath as the
 *     load-window fallback. An always-on cream tint (~15%) warms residual blue
 *     water; dark mode keeps the cream tiles (the map reads as a paper object).
 *     userInterfaceStyle='light' (#169) pins the NATIVE base light too, so the
 *     tile-load window never flashes grey in system dark mode.
 *     Replaces the old vellum-wash + key-gated Google-on-iOS path.
 *
 * Provider:
 *   iOS     → PROVIDER_DEFAULT (Apple) + UrlTile shouldReplaceMapContent
 *   Android → PROVIDER_GOOGLE + UrlTile draw-over (heirloom fallback beneath)
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
    ActivityIndicator,
    Alert,
    StyleSheet,
    Platform,
    Linking,
    Animated,
    Dimensions,
    FlatList,
    useWindowDimensions,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import MapView, {
    Marker,
    UrlTile,
    PROVIDER_GOOGLE,
    PROVIDER_DEFAULT,
    type LatLng,
    type Region,
} from 'react-native-maps';
import type MapViewType from 'react-native-maps';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { heirloomMapStyle } from '@/constants/mapStyle';
import { tileUrlTemplate, MAPTILER_ATTRIBUTION, MAP_TILE_MODE } from '@/lib/maptiler';
import { haversineMiles, formatDistance, type LatLng as GeoLatLng } from '@/lib/geo';
import { cuisineGlyph, tintIndex } from '@/lib/engraving';
import { priceTierLabel } from '@/lib/priceLevel';
import { describePeekWho } from './peekWho';
import { peekActionsForPresentation, type PeekActionId } from './peekActions';
import { PEEK_MAX_FONT_SCALE, peekRailCardHeight } from './peekLayout';
import { listCollectionFrameKey } from './listMapScope';
import { useAuth } from '@/providers/AuthProvider';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import {
    peekCardContextForItem,
    peekCardContextToken,
    usePeekCard,
    type PeekCardData,
    type PeekCardMediaCandidate,
} from '@/hooks/restaurants/usePeekCard';
import { queryKeys } from '@/lib/queryKeys';
import { todaysHoursLine } from '@/lib/restaurantHours';
import { AddToListSheet } from '@/components/lists/AddToListSheet';
import {
    PlacesCredit,
    resolveSourcedPhoto,
    type PlacesPhotoCredit,
} from '@/components/ui/PlacesCredit';
import {
    chooseCollectionCamera,
    CITY_DELTA,
    CREAM,
    NEAR_ME_DELTA,
    SPOT_DELTA,
    type LocationStatus,
    type WishlistMapItem,
} from './mapShared';

// ── Types ─────────────────────────────────────────────────────────────────────

// The pin shape + LocationStatus now live in the neutral `mapShared` module
// (shared with ScopedListMap, no type cycle). Re-exported so existing importers
// (`@/components/wishlist/WishlistMapView`) keep resolving unchanged.
export type { WishlistMapItem };

/**
 * The layer discriminant qualifying each marker key: `o` overlap · `n` network ·
 * `b` been · `s` saved. A layer swap that reshapes a pin changes the key, so the
 * native marker view legitimately remounts.
 */
function pinVariant(item: WishlistMapItem): 'o' | 'n' | 'b' | 's' {
    return item.overlap != null ? 'o' : item.entryId != null ? 'n' : item.been ? 'b' : 's';
}

interface Props {
    /** Spots WITH valid coordinates (parent filters these). */
    items: WishlistMapItem[];
    /** Count of saved spots that lack coordinates — surfaced as a quiet murmur.
     * Saved layer only: parents pass 0 for the been/network layers. */
    unmappableCount: number;
    /** Tap-through on the unmappable murmur (lists which spots + fix flow).
     * Optional — without it the murmur stays informational (dining-map). */
    onUnmappablePress?: () => void;
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
    /** Switch back to the list view — frosted List pill, bottom-RIGHT (below the
     * locate FAB; corner law v2, TICKET-137). Optional — screens with their own
     * chrome (dining map, TICKET-092) omit it: the pill hides AND the FAB drops
     * to the corner position (no stack offset over a pill that isn't there). */
    onSwitchToList?: () => void;
    /** Optional bottom-left Lists scope control on Your map. */
    listChip?: {
        label: string;
        onPress: () => void;
        selected?: boolean;
    };
    /** A selected List keeps its authored entry order instead of nearest-first. */
    preserveItemOrder?: boolean;
    /** Stable identity for a selected List. Frames that collection once. */
    collectionScopeKey?: string | null;
    /** Deep-linked place to select, frame, and reveal exactly once. */
    focusItemId?: string | null;
    /** Scope-aware empty copy for selected collections. */
    emptyMessage?: string;
    emptyAction?: {
        label: string;
        onPress: () => void;
    };
    /** Scope-aware copy for places without usable coordinates. */
    unmappableLabel?: string;
    /** Import entry point — frosted chip top-RIGHT under the filter chip
     * (chrome diet, TICKET-163: replaces the workspace header's Import button).
     * Optional — dining-map / table-map omit it. */
    onImport?: () => void;
    /** Pending-import state, shrunk to a corner chip (the old full-width inbox
     * card no longer squats over the pins). `count` renders next to the icon
     * (review state); working/failed states pass icon-only. */
    importStatus?: {
        icon: keyof typeof Ionicons.glyphMap;
        count?: number | null;
        accessibilityLabel: string;
        onPress: () => void;
    };
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
     * TICKET-138: "gather here" on an overlap peek card. Fired only by overlap
     * cards (the peek gates the pill on `item.overlap`); the screen mounts the
     * existing GatherSheet prefilled with the restaurant + the overlap's table.
     * Absent → no gather pill (network / been / mine cards never call it).
     */
    onGather?: (item: WishlistMapItem) => void;
    /**
     * TICKET-131: renders the top-right Filter chip when present; opens the
     * screen-owned FilterTabsSheet (wishlist). Absent (dining-map) → chip hidden.
     */
    onOpenFilters?: () => void;
    /** Active-filter dot on the Filter chip. */
    filtersActive?: boolean;
    /**
     * TICKET-137: Discover-only people chip — a frosted bottom-LEFT chip
     * (people-outline + a state label: `Everyone` · one name · `N people`) that
     * opens the screen-owned picker sheet. Replaces the old inline friend rail
     * ("very bugged"). The screen owns the EXCLUSIVE-include filter state and the
     * sheet; this just draws the chip. Absent → no chip (Your map, dining-map).
     * Hidden while a peek is up (shares the bottom-chrome hide set).
     */
    peopleChip?: {
        label: string;
        onPress: () => void;
    };
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
// CREAM + the framing deltas (NEAR_ME_DELTA / CITY_DELTA / SPOT_DELTA) now live
// in the neutral `mapShared` module, shared with ScopedListMap.

/** Clearance so bottom chrome + peek sit above the floating nav pill (TICKET-130). */
const NAV_CLEARANCE = 92;
/** Corner law v2 (TICKET-137): the locate FAB stacks directly ABOVE the List
 * pill in the bottom-RIGHT corner. Offset = List-pill height (~42) + gap (~10),
 * so the FAB's bottom edge clears the pill's top edge by the gap. */
const RIGHT_STACK_OFFSET = 52;
/** Vertical rhythm of the top-RIGHT chip stack (filter → import → status). */
const TOP_STACK_OFFSET = 46;
/** Dark-scheme frost pair for the floating chrome (light uses palette.scrimFrost).
 * Inline by design — no new theme tokens (TICKET-131). */
const FROST_DARK = 'rgba(42,39,36,0.92)';
/** A rating at/above this = "loved" → terracotta heart badge on the pin. */
const LOVED_MIN = 4.5;

// ── Framing deltas ──────────────────────────────────────────────────────────────
// NEAR_ME_DELTA / CITY_DELTA / SPOT_DELTA are imported from `mapShared` (one
// region API for all camera moves; latitudeDelta ≈ 360 / 2^zoom).
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
    // TICKET-138: overlap ranks ABOVE network. `count>=2` is the amber count
    // face; a single (count 1, TICKET-139 saved layer) renders as a plain
    // terracotta save bubble (cuisine glyph / list emoji, terracotta ring).
    const isOverlap = item.overlap != null;
    const overlapCount = item.overlap?.count ?? 0;
    const isCountBubble = isOverlap && overlapCount >= 2;
    const ringColor = isCountBubble
        ? palette.tertiary // amber count ring (138 overlap)
        : isOverlap
          ? palette.primary // single (count 1) = terracotta save ring
          : isNetwork
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
                {isCountBubble ? (
                    // Brand numerals — Newsreader italic, amber (138 overlap count).
                    <Text
                        style={{
                            fontFamily: 'Newsreader_500Medium_Italic',
                            fontSize: selected ? 18 : 15,
                            color: palette.tertiary,
                            includeFontPadding: false,
                        }}
                    >
                        {overlapCount}
                    </Text>
                ) : item.emoji ? (
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
    onUnmappablePress,
    userCoords,
    locationStatus,
    onRequestLocation,
    onOpenRestaurant,
    onOpenReview,
    onSwitchToList,
    listChip,
    preserveItemOrder = false,
    collectionScopeKey,
    focusItemId,
    emptyMessage,
    emptyAction,
    unmappableLabel,
    onImport,
    importStatus,
    sources,
    onGather,
    onOpenFilters,
    filtersActive,
    peopleChip,
    chromeTopOffset,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    const mapRef = useRef<MapViewType>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { user } = useAuth();
    const { data: wishlistPages } = useMyWishlist(user?.id);
    // One screen-level seed replaces per-card checks. The selected card alone
    // refines this deliberately partial (loaded-pages) view against the server.
    const savedRestaurantIds = useMemo<ReadonlySet<string> | undefined>(() => {
        if (!wishlistPages) return undefined;
        return new Set(
            wishlistPages.pages
                .flatMap((page) => page.data ?? [])
                .map((row) => row.restaurant?.id)
                .filter((id): id is string => !!id),
        );
    }, [wishlistPages]);

    // Scheme follows the palette the parent passed (the app's use-color-scheme
    // hook is hard-forced to 'light', so a hook call here can't see dark; the
    // palette reference is the render-truth either way).
    const isDark = palette !== Colors.light;

    // TICKET-137: tile skin is flag-gated. `MAP_TILE_MODE==='maptiler'` draws the
    // cream `landscape` raster via UrlTile + cream tint + attribution (the 134
    // path); `'apple'` (shipping) leaves plain Apple `mutedStandard` (light-pinned)
    // on iOS and Google + heirloomMapStyle on Android — no UrlTile, no tint, no
    // caption. #169's userInterfaceStyle='light' (on the MapView) pins the base
    // light in BOTH modes so the map never flashes grey in system dark mode.
    const isAndroid = Platform.OS === 'android';
    const tilesOn = MAP_TILE_MODE === 'maptiler';

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

    // Collection framing is intentionally separate from global layer framing.
    // A List is a bounded authored object, so showing its whole footprint is
    // useful; the global wishlist remains near-me and never fit-all zooms.
    const framedCollectionRef = useRef<string | null>(null);
    const handledFocusRef = useRef<string | null>(null);
    const collectionFrameKey = listCollectionFrameKey(collectionScopeKey, items);
    useEffect(() => {
        if (!collectionScopeKey || !collectionFrameKey || items.length === 0) return;

        const focusKey = focusItemId ? `${collectionScopeKey}:${focusItemId}` : null;
        const focused = focusItemId ? items.find((item) => item.id === focusItemId) : null;
        if (focused && focusKey && handledFocusRef.current !== focusKey) {
            handledFocusRef.current = focusKey;
            framedCollectionRef.current = collectionFrameKey;
            const timer = setTimeout(() => {
                setSelectedId(focused.id);
                mapRef.current?.animateToRegion(
                    {
                        latitude: focused.lat,
                        longitude: focused.lng,
                        latitudeDelta: SPOT_DELTA,
                        longitudeDelta: SPOT_DELTA,
                    },
                    320,
                );
            }, 260);
            return () => clearTimeout(timer);
        }

        if (framedCollectionRef.current === collectionFrameKey) return;
        framedCollectionRef.current = collectionFrameKey;
        setSelectedId(null);
        const timer = setTimeout(() => {
            // The shared collection-framing algorithm (mapShared). This map has
            // never deferred, so `defer` collapses to its historical fallback —
            // items[0] at CITY_DELTA — keeping behavior byte-identical.
            const action = chooseCollectionCamera(items, userCoords, locationStatus);
            if (action.kind === 'fit') {
                mapRef.current?.fitToCoordinates(action.coords, {
                    edgePadding: { top: 150, right: 56, bottom: 250, left: 56 },
                    animated: true,
                });
                return;
            }
            const region = action.kind === 'region'
                ? action.region
                : {
                    latitude: items[0].lat,
                    longitude: items[0].lng,
                    latitudeDelta: CITY_DELTA,
                    longitudeDelta: CITY_DELTA,
                };
            mapRef.current?.animateToRegion(region, 320);
        }, 260);
        return () => clearTimeout(timer);
        // locationStatus feeds chooseCollectionCamera; the framedCollectionRef
        // guard keeps re-runs a no-op, so adding it never re-frames.
    }, [collectionFrameKey, collectionScopeKey, focusItemId, items, userCoords, locationStatus]);

    // Frame the map ONCE per open. This is a "near me" map, so prefer centering on
    // the user at city zoom — fitting ALL pins zooms way out for a globally-spread
    // wishlist ("why is it so zoomed out every time I switch to map"). Falls back to
    // the first saved spot when there's no location. Re-frames only on the next OPEN
    // (the component remounts when you toggle back to map), never on the live location
    // updates you get while walking — so the camera doesn't yank around under you.
    const framedRef = useRef(false);
    useEffect(() => {
        if (collectionScopeKey || items.length === 0 || framedRef.current) return;
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
    }, [collectionScopeKey, items, locationStatus, userCoords]);

    // Layer SWITCH framing (Your map ↔ Discover). The founder's "it zooms out
    // incessantly when I toggle" was this effect fitToCoordinates-ing over the
    // WHOLE new layer on every switch — for a globally-spread wishlist / follow
    // graph that's a near-world-scale zoom-out, and it's pointless when the spots
    // you're looking at are already on screen. Rule (2026-07-09): PRESERVE the
    // current viewport across a switch; only MOVE the camera when the new layer
    // would render ENTIRELY off-screen (traveling, or a layer whose spots live in
    // another city). Even then, PAN to the nearest pin at a calm city zoom — never
    // fit-all. Fires once per real sources.value change, and only once the (lazy)
    // layer's pins have arrived. Item churn on the same layer never moves.
    //
    // The ref is committed INSIDE the timer, never in the effect body: `sources`
    // is a fresh inline object each parent render and this component isn't
    // memoized, so the effect re-runs on every render, and the Discover layer in
    // particular settles across two async queries (network + table overlap).
    // Advancing the ref synchronously let those churny re-renders clearTimeout the
    // pending camera move and then bail the reschedule (guard already matched) — so
    // the off-screen rescue silently never fired on first open. Scheduling-only,
    // with the commit deferred into the timer, makes each re-render reschedule a
    // fresh 350ms window; the decision runs exactly once, after the layer settles.
    const framedSourceRef = useRef(sources?.value);
    useEffect(() => {
        if (!sources || sources.value === framedSourceRef.current) return;
        if (items.length === 0) return; // layer still loading — wait for pins
        const targetSource = sources.value;
        const layerItems = items;
        const timer = setTimeout(async () => {
            const map = mapRef.current;
            if (!map) return; // not attached yet — a later render reschedules
            framedSourceRef.current = targetSource; // commit: this switch is handled
            // What's on screen right now? If any pin of the new layer falls inside
            // the visible bounds, leave the camera exactly where the user put it.
            let bounds: { northEast: LatLng; southWest: LatLng } | null = null;
            try {
                bounds = await map.getMapBoundaries();
            } catch {
                bounds = null;
            }
            const visible = (i: WishlistMapItem) =>
                !!bounds &&
                i.lat <= bounds.northEast.latitude &&
                i.lat >= bounds.southWest.latitude &&
                i.lng <= bounds.northEast.longitude &&
                i.lng >= bounds.southWest.longitude;
            if (bounds && layerItems.some(visible)) return; // overlap — keep viewport

            // Off-screen rescue: pan to the pin nearest the current center (or the
            // user, or just the first pin) at a city zoom — NOT a world-scale fit.
            const center =
                bounds != null
                    ? {
                          latitude: (bounds.northEast.latitude + bounds.southWest.latitude) / 2,
                          longitude: (bounds.northEast.longitude + bounds.southWest.longitude) / 2,
                      }
                    : userCoords;
            const target = center
                ? [...layerItems].sort(
                      (a, b) =>
                          haversineMiles(center, { latitude: a.lat, longitude: a.lng }) -
                          haversineMiles(center, { latitude: b.lat, longitude: b.lng }),
                  )[0]
                : layerItems[0];
            const delta = layerItems.length === 1 ? SPOT_DELTA : CITY_DELTA;
            map.animateToRegion(
                {
                    latitude: target.lat,
                    longitude: target.lng,
                    latitudeDelta: delta,
                    longitudeDelta: delta,
                },
                350,
            );
        }, 350); // let a remounting MapView (empty→loaded flip) attach first
        return () => clearTimeout(timer);
    }, [sources, items, userCoords]);

    const initialRegion: Region | undefined = useMemo(() => {
        if (items.length === 0) {
            // TICKET-179: an empty layer still shows a REAL map ("the map simply
            // refuses to show" — founder, 2026-07-12). Centre on the user when we
            // have them; else undefined = the platform's default region. The
            // empty murmur rides as an overlay below.
            if (userCoords) {
                return {
                    latitude: userCoords.latitude,
                    longitude: userCoords.longitude,
                    latitudeDelta: 0.08,
                    longitudeDelta: 0.08,
                };
            }
            return undefined;
        }
        const first = items[0];
        return {
            latitude: first.lat,
            longitude: first.lng,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
        };
    }, [items, userCoords]);

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
        if (preserveItemOrder || !userCoords) return items;
        return [...items]
            .map((item) => ({
                item,
                d: haversineMiles(userCoords, { latitude: item.lat, longitude: item.lng }),
            }))
            .sort((a, b) => a.d - b.d)
            .map((x) => x.item);
    }, [items, preserveItemOrder, userCoords]);

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

    // ── Places pill — bottom-right, frosted (corner law v2). Also in both branches
    // (same review finding: an empty layer must not strand you on the map).
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
                accessibilityLabel="Places view"
            >
                <Ionicons name="list" size={15} color={palette.primary} />
                <Text style={[styles.listToggleText, { color: palette.primary }]}>Places</Text>
            </Pressable>
        ) : null;

    // ── Import chip — top-right under the filter chip; the map's import entry
    // point now that the workspace header is gone (chrome diet, TICKET-163).
    // Below it, an optional status chip carries the pending-review count
    // (sparkles + n) or a working/failed glyph — the old full-width inbox card
    // squatting over the pins, shrunk to a corner chip.
    const renderImportChips = () => (
        <>
            {onImport ? (
                <Pressable
                    onPress={onImport}
                    style={[
                        styles.importChip,
                        { backgroundColor: frostBg, top: chromeTop + TOP_STACK_OFFSET },
                        Shadow.ambient,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="import spots"
                >
                    <Ionicons name="download-outline" size={14} color={palette.textSecondary} />
                    <Text style={[styles.importChipText, { color: palette.textSecondary }]}>Import</Text>
                </Pressable>
            ) : null}
            {importStatus ? (
                <Pressable
                    onPress={importStatus.onPress}
                    style={[
                        styles.importChip,
                        {
                            backgroundColor: frostBg,
                            top: chromeTop + TOP_STACK_OFFSET * (onImport ? 2 : 1),
                        },
                        Shadow.ambient,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={importStatus.accessibilityLabel}
                >
                    <Ionicons name={importStatus.icon} size={14} color={palette.primary} />
                    {importStatus.count != null ? (
                        <Text style={[styles.importChipText, { color: palette.primary }]}>
                            {importStatus.count}
                        </Text>
                    ) : null}
                </Pressable>
            ) : null}
        </>
    );

    // ── Empty copy (per-source; TICKET-134 grammar kept). TICKET-179: an empty
    // layer NO LONGER replaces the map with a flat card — the real map renders
    // (user-centred / platform default) and the murmur floats over it, so an
    // empty Table's territory map still reads as a map, not a refusal. Pills /
    // chip / import chips / List keep rendering via the main branch.
    const emptyCopy =
        items.length > 0
            ? null
            : emptyMessage
              ? emptyMessage
            : sources?.value === 'discover' || sources?.value === 'network'
              ? 'no spots from people you follow yet.'
              : sources?.value === 'mine'
                ? 'no logged spots with a map location yet.'
                : sources?.value === 'been'
                  ? 'no group meals with a map location yet.'
                  : sources?.value === 'saved'
                    ? "the table hasn't saved a mappable spot yet."
                    : 'none of your spots have a map location yet.';

    return (
        <View style={[styles.fill, { backgroundColor: CREAM }]}>
            {/* Full-bleed map — edge-to-edge under the screen's header chrome
                (TICKET-131 removed the framed-plate inset). The hairline warm rule
                at the top edge stays. CREAM background so a tile-load / 404 gap
                reads as paper, not a grey/void patch (iOS replaced base). */}
            <MapView
                ref={mapRef}
                style={[StyleSheet.absoluteFillObject, { backgroundColor: CREAM }]}
                provider={isAndroid ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                // Android always keeps the heirloom skin (the base in apple mode,
                // the load-window fallback beneath the tiles in maptiler mode).
                customMapStyle={isAndroid ? heirloomMapStyle : undefined}
                // Apple mode (TICKET-137): plain, de-saturated `mutedStandard` on
                // iOS — a calm paper-adjacent base with POIs already suppressed.
                // In maptiler mode the base is replaced anyway (shouldReplaceMapContent).
                mapType={!tilesOn && Platform.OS === 'ios' ? 'mutedStandard' : undefined}
                // The map NEVER goes dark (founder, 2026-07-08; TICKET-134 ⑧:
                // the map reads as a paper object). Apple tiles follow the
                // SYSTEM appearance — not our light-forced palette — so system
                // dark mode was swapping grey tiles under the cream chrome.
                // (#169; still load-bearing with MapTiler: it pins the NATIVE
                // base light during the pre-tile load window + Android's Google
                // base under our draw-over.)
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
                {/* MapTiler cream raster — first child, beneath the markers. iOS
                    replaces the base (kills grey dark tiles ⑧); Android draws over
                    Google. @2x endpoint + tileSize 512 → crisp labels. Rendered
                    only in maptiler mode (TICKET-137); apple mode shows plain Apple. */}
                {tilesOn ? (
                    <UrlTile
                        urlTemplate={tileUrlTemplate()}
                        shouldReplaceMapContent={Platform.OS === 'ios'}
                        tileSize={512}
                        maximumZ={20}
                    />
                ) : null}
                {/* Every pin renders individually — zoom-out count clustering was
                    removed at founder order 2026-07-12 (the number bubbles read
                    terribly). If a giant import ever janks the map, redesign with
                    the founder — do NOT quietly re-add count bubbles. */}
                {items.map((item) => (
                    <WishlistMarker
                        key={`${pinVariant(item)}:${item.id}`}
                        item={item}
                        selected={selectedId === item.id}
                        palette={palette}
                        onPress={() => setSelectedId(item.id)}
                    />
                ))}
            </MapView>

            {/* Cream tint — maptiler mode only (TICKET-137). It warms the residual
                blue water over the MapTiler cream land and unifies the surface;
                apple mode shows plain Apple with no tint (founder ask). CREAM (not
                the dark placesOverlayTint, which would darken the tiles); ~15% is
                in the 12–18% target. */}
            {tilesOn ? (
                <View
                    style={[StyleSheet.absoluteFill, { backgroundColor: CREAM, opacity: 0.15 }]}
                    pointerEvents="none"
                />
            ) : null}

            {/* Hairline warm rule at the top edge (ghosted, not a 1px border). */}
            <View
                style={[styles.topRule, { backgroundColor: palette.ruleInkSoft }]}
                pointerEvents="none"
            />

            {/* TICKET-179: empty-layer murmur floats over the LIVE map — the map
                itself never disappears. pointerEvents none: pan/zoom stay free. */}
            {emptyCopy ? (
                <View pointerEvents={emptyAction ? 'box-none' : 'none'} style={[styles.fill, styles.emptyWrap]}>
                    {/* [review NIT-2] frosted pill behind the murmur — muted text
                        straight on Android's busier tiles reads thin; mirrors the
                        sibling unmappable murmur's treatment. */}
                    <View style={[styles.emptyPill, { backgroundColor: frostBg }, Shadow.ambient]}>
                        <Ionicons name="map-outline" size={28} color={palette.textMuted} />
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            {emptyCopy}
                        </Text>
                        {emptyAction ? (
                            <Pressable
                                onPress={emptyAction.onPress}
                                style={({ pressed }) => [
                                    styles.emptyAction,
                                    {
                                        backgroundColor: palette.primaryMuted,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={emptyAction.label}
                            >
                                <Text style={[styles.emptyActionLabel, { color: palette.primary }]}>
                                    {emptyAction.label}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            ) : null}

            {/* Source pills — top-left, frosted. Hidden while a peek is up. */}
            {renderSourcePills(!selected)}

            {/* Filter chip — top-right, frosted (shared with the empty branch). */}
            {renderFilterChip()}

            {/* Import + review-status chips — top-right stack under the filter chip. */}
            {renderImportChips()}

            {/* Unmappable murmur — saved layer only (parents pass 0 otherwise),
                frost family, tucked below the source pills. With a handler the
                pill taps through to the which-spots + fix sheet (chevron cue);
                without one it stays informational. */}
            {unmappableCount > 0 ? (
                <View
                    style={[styles.murmurWrap, { top: sources ? chromeTop + 46 : chromeTop }]}
                    pointerEvents={onUnmappablePress ? 'box-none' : 'none'}
                >
                    <Pressable
                        onPress={onUnmappablePress}
                        disabled={!onUnmappablePress}
                        style={[styles.murmurPill, { backgroundColor: frostBg }, Shadow.ambient]}
                        accessibilityRole={onUnmappablePress ? 'button' : undefined}
                        accessibilityLabel={
                            onUnmappablePress ? 'show spots with no map location' : undefined
                        }
                    >
                        <Text style={[styles.murmurText, { color: palette.textMuted }]}>
                            {unmappableLabel
                                ?? `${unmappableCount} saved ${unmappableCount === 1 ? 'spot has' : 'spots have'} no map location`}
                        </Text>
                        {onUnmappablePress ? (
                            <Ionicons name="chevron-forward" size={12} color={palette.textMuted} />
                        ) : null}
                    </Pressable>
                </View>
            ) : null}

            {/* Locate FAB — bottom-RIGHT, stacked directly ABOVE the List pill
                (corner law v2, TICKET-137). The stack offset applies only when the
                pill actually renders (onSwitchToList) — dining-map omits it, so
                its FAB sits at the corner, not 52px above an empty gap. Clear of
                the floating nav pill; hidden once a peek card is up. */}
            {!selected ? (
                <Pressable
                    onPress={handleRecenter}
                    style={[
                        styles.fab,
                        {
                            backgroundColor: frostBg,
                            bottom:
                                insets.bottom +
                                NAV_CLEARANCE +
                                (onSwitchToList ? RIGHT_STACK_OFFSET : 0),
                        },
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

            {/* List pill — bottom-RIGHT below the locate FAB, frosted (corner law
                v2). Hidden while a peek card is up (shared with the empty branch). */}
            {renderListPill(!selected)}

            {/* Lists chip — Your map only, bottom-LEFT. It scopes the same map
                instead of opening a second map implementation. */}
            {listChip && !selected ? (
                <Pressable
                    onPress={listChip.onPress}
                    style={[
                        styles.peopleChip,
                        { backgroundColor: frostBg, bottom: insets.bottom + NAV_CLEARANCE },
                        Shadow.ambient,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={listChip.selected ? `Change List, ${listChip.label} selected` : 'Choose a List'}
                    accessibilityState={{ selected: !!listChip.selected }}
                >
                    <Ionicons name="albums-outline" size={15} color={palette.primary} />
                    <Text style={[styles.peopleChipText, { color: palette.primary }]} numberOfLines={1}>
                        {listChip.label}
                    </Text>
                </Pressable>
            ) : null}

            {/* People chip — Discover only, bottom-LEFT (corner law v2, TICKET-137).
                Frosted people-outline + state label; opens the screen-owned picker
                sheet. Hidden while a peek is up (shares the bottom-chrome hide set). */}
            {peopleChip && !listChip && !selected ? (
                <Pressable
                    onPress={peopleChip.onPress}
                    style={[
                        styles.peopleChip,
                        { backgroundColor: frostBg, bottom: insets.bottom + NAV_CLEARANCE },
                        Shadow.ambient,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`filter people · ${peopleChip.label}`}
                >
                    <Ionicons name="people-outline" size={15} color={palette.primary} />
                    <Text style={[styles.peopleChipText, { color: palette.primary }]} numberOfLines={1}>
                        {peopleChip.label}
                    </Text>
                </Pressable>
            ) : null}

            {/* Attribution — ToS-required ghosted caption, maptiler mode only
                (TICKET-137: ToS needs it solely when their tiles render). Hidden
                while a peek is up (the carousel owns the bottom). */}
            {tilesOn && !selected ? (
                <Text
                    style={[
                        styles.attribution,
                        { color: palette.textMuted, bottom: insets.bottom + NAV_CLEARANCE - 18 },
                    ]}
                    pointerEvents="none"
                >
                    {MAPTILER_ATTRIBUTION}
                </Text>
            ) : null}

            {/* Peek carousel — rises when a pin is tapped; swipe for what's
                nearby. No key: it must NOT remount (re-animate) per pin change,
                only on closed → open. */}
            {selected ? (
                <PeekCarousel
                    items={orderedItems}
                    selectedId={selected.id}
                    viewerId={user?.id}
                    savedRestaurantIds={savedRestaurantIds}
                    userCoords={userCoords}
                    palette={palette}
                    bottomInset={insets.bottom + NAV_CLEARANCE}
                    onSelect={handleCarouselSelect}
                    onClose={() => setSelectedId(null)}
                    onOpenRestaurant={onOpenRestaurant}
                    onOpenReview={onOpenReview}
                    onGather={onGather}
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
    viewerId: string | null | undefined;
    savedRestaurantIds: ReadonlySet<string> | undefined;
    userCoords: GeoLatLng | null;
    palette: typeof Colors.light;
    bottomInset: number;
    onSelect: (item: WishlistMapItem) => void;
    onClose: () => void;
    onOpenRestaurant: (restaurantId: string) => void;
    /** TICKET-124: review-eligible network cards tap through to the review. */
    onOpenReview?: (entryId: string) => void;
    /** TICKET-138: overlap cards' "gather here". */
    onGather?: Props['onGather'];
}

function PeekCarousel({
    items,
    selectedId,
    viewerId,
    savedRestaurantIds,
    userCoords,
    palette,
    bottomInset,
    onSelect,
    onClose,
    onOpenRestaurant,
    onOpenReview,
    onGather,
}: PeekCarouselProps) {
    const { fontScale } = useWindowDimensions();
    const [listSheetItem, setListSheetItem] = useState<WishlistMapItem | null>(null);
    const listRef = useRef<FlatList<WishlistMapItem>>(null);
    const slide = useRef(new Animated.Value(48)).current;
    const fade = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.parallel([
            Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 240 }),
            Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        ]).start();
    }, [slide, fade]);

    // One explicit height for every card in every layer. Enrichment data is not
    // an input, so photos/hours/counts cannot reflow the rail or its snap math.
    const cardH = peekRailCardHeight(fontScale);

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
    const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));

    return (
        <>
            <Animated.View
                style={[
                    styles.peekWrap,
                    {
                        bottom: bottomInset,
                        height: cardH + 16,
                        opacity: fade,
                        transform: [{ translateY: slide }],
                    },
                ]}
                pointerEvents="box-none"
            >
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
                    extraData={selectedId}
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
                    removeClippedSubviews={false}
                    initialNumToRender={3}
                    windowSize={5}
                    renderItem={({ item, index }) => (
                        <PeekCardBody
                            item={item}
                            viewerId={viewerId}
                            seedSaved={savedRestaurantIds?.has(item.id)}
                            isSelected={index === selectedIndex}
                            userCoords={userCoords}
                            palette={palette}
                            height={cardH}
                            fontScale={fontScale}
                            onOpenRestaurant={onOpenRestaurant}
                            onOpenReview={onOpenReview}
                            onOpenListSheet={setListSheetItem}
                            onGather={onGather}
                        />
                    )}
                />
            </Animated.View>
            <AddToListSheet
                visible={listSheetItem !== null}
                onClose={() => setListSheetItem(null)}
                userId={viewerId}
                restaurantId={listSheetItem?.id}
                restaurantName={listSheetItem?.name}
            />
        </>
    );
}

// ── PeekCardBody v2 — fixed media + reserved context + literal action slots ─────

interface PeekCardBodyProps {
    item: WishlistMapItem;
    viewerId: string | null | undefined;
    seedSaved: boolean | undefined;
    isSelected: boolean;
    userCoords: GeoLatLng | null;
    palette: typeof Colors.light;
    height: number;
    fontScale: number;
    onOpenRestaurant: (restaurantId: string) => void;
    onOpenReview?: (entryId: string) => void;
    onOpenListSheet: (item: WishlistMapItem) => void;
    onGather?: Props['onGather'];
}

function formatGoogleCount(value: number | null): string | null {
    if (value == null) return null;
    if (value < 1000) return String(value);
    return `${(value / 1000).toFixed(1)}k`;
}

function PeekMediaTile({
    item,
    candidate,
    palette,
    onError,
}: {
    item: WishlistMapItem;
    candidate: PeekCardMediaCandidate | undefined;
    palette: typeof Colors.light;
    onError: () => void;
}) {
    const plateTints = [palette.surfaceJournal, palette.oliveCream, palette.tertiaryFixed] as const;
    const plateTint = plateTints[tintIndex(item.id)];

    return (
        <View style={[styles.peekMedia, { backgroundColor: plateTint }]}>
            {candidate ? (
                <>
                    <ExpoImage
                        source={{ uri: candidate.url }}
                        recyclingKey={candidate.url}
                        contentFit="cover"
                        transition={120}
                        style={StyleSheet.absoluteFill}
                        onError={onError}
                    />
                    <View
                        pointerEvents="none"
                        style={[styles.peekMediaOutline, { borderColor: palette.imageOutline }]}
                    />
                    {candidate.kind === 'places' ? (
                        <View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: palette.placesOverlayTint,
                                    opacity: palette.placesOverlayOpacity,
                                },
                            ]}
                        />
                    ) : null}
                </>
            ) : (
                <>
                    <View
                        pointerEvents="none"
                        style={[styles.peekPlateInset, { borderColor: palette.terracottaBorderStrong }]}
                    />
                    {item.emoji ? (
                        <Text maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE} style={styles.peekPlateEmoji}>
                            {item.emoji}
                        </Text>
                    ) : (
                        <Ionicons
                            name={cuisineGlyph(item.cuisine)}
                            size={25}
                            color={palette.primary}
                            style={styles.peekPlateGlyph}
                        />
                    )}
                </>
            )}
        </View>
    );
}

function resolvePeekMediaCandidate(
    candidate: PeekCardMediaCandidate,
    restaurantName: string,
): { candidate: PeekCardMediaCandidate; credit: PlacesPhotoCredit | null } | null {
    if (candidate.kind !== 'places') return { candidate, credit: null };
    const resolved = resolveSourcedPhoto({
        url: candidate.url,
        photoSource: candidate.photo_source,
        attributionHtml: candidate.attribution,
        restaurantName,
    });
    return resolved.url && resolved.credit
        ? { candidate: { ...candidate, url: resolved.url }, credit: resolved.credit }
        : null;
}

function actionLabel(action: PeekActionId, saved: boolean | undefined): string {
    switch (action) {
        case 'log_visit': return 'log a visit';
        case 'log_again': return 'log again';
        case 'directions': return 'directions';
        case 'wishlist': return saved === undefined ? 'wishlist' : saved ? 'saved' : 'save';
        case 'reserve': return 'reserve';
        case 'view_restaurant': return 'view restaurant';
        case 'gather_here': return 'gather here';
    }
}

function actionIcon(
    action: PeekActionId,
    saved: boolean | undefined,
): keyof typeof Ionicons.glyphMap {
    switch (action) {
        case 'log_visit': return 'create-outline';
        case 'log_again': return 'refresh-outline';
        case 'directions': return 'navigate-outline';
        case 'wishlist': return saved ? 'heart' : 'heart-outline';
        case 'reserve': return 'calendar-outline';
        case 'view_restaurant': return 'arrow-forward';
        case 'gather_here': return 'people-outline';
    }
}

function PeekActionButton({
    action,
    emphasized,
    saved,
    pending,
    disabled,
    height,
    palette,
    onPress,
    onLongPress,
    onPressIn,
}: {
    action: PeekActionId;
    emphasized: boolean;
    saved: boolean | undefined;
    pending: boolean;
    disabled: boolean;
    height: number;
    palette: typeof Colors.light;
    onPress: () => void;
    onLongPress?: () => void;
    onPressIn?: () => void;
}) {
    const label = actionLabel(action, saved);
    const isSelectedHeart = action === 'wishlist' && saved === true;
    const heartUnknown = action === 'wishlist' && saved === undefined;
    const foreground = emphasized
        ? disabled ? palette.textMuted : palette.textInverse
        : isSelectedHeart ? palette.primary : palette.textSecondary;

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            onPressIn={onPressIn}
            delayLongPress={350}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
                action === 'wishlist'
                    ? saved === undefined
                        ? 'Checking wishlist'
                        : saved
                          ? 'Remove from wishlist'
                          : 'Add to wishlist'
                    : label
            }
            accessibilityState={{
                disabled,
                busy: pending || heartUnknown,
                selected: action === 'wishlist' ? saved === true : undefined,
            }}
            style={({ pressed }) => [
                emphasized ? styles.peekPrimaryAction : styles.peekIconAction,
                {
                    height,
                    backgroundColor: emphasized
                        ? disabled ? palette.surfaceContainerHigh : palette.primary
                        : isSelectedHeart ? palette.primaryMuted : palette.surfaceContainerHigh,
                    opacity: disabled && !pending ? 0.72 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                },
            ]}
        >
            {pending || heartUnknown ? (
                <ActivityIndicator size="small" color={foreground} />
            ) : (
                <Ionicons name={actionIcon(action, saved)} size={18} color={foreground} />
            )}
            {emphasized ? (
                <Text
                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                    numberOfLines={1}
                    style={[styles.peekPrimaryActionLabel, { color: foreground }]}
                >
                    {label}
                </Text>
            ) : null}
        </Pressable>
    );
}

function PeekCardBody({
    item,
    viewerId,
    seedSaved,
    isSelected,
    userCoords,
    palette,
    height,
    fontScale,
    onOpenRestaurant,
    onOpenReview,
    onOpenListSheet,
    onGather,
}: PeekCardBodyProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const context = useMemo(() => peekCardContextForItem(item), [item]);
    const contextToken = useMemo(() => peekCardContextToken(context), [context]);
    const peekKey = useMemo(
        () => queryKeys.restaurants.peekCard(viewerId ?? '', item.id, contextToken),
        [contextToken, item.id, viewerId],
    );
    const presentationIdentity = `${viewerId ?? ''}:${item.id}:${contextToken}`;
    // The selector only reads the layer discriminant. Pin that input to the
    // context token so unrelated parent object churn cannot resnapshot a live
    // presentation when enrichment lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const actionContextItem = useMemo(() => item, [contextToken]);
    const presentationBoundary = `${presentationIdentity}:${isSelected ? 'selected' : 'neighbor'}`;
    const presentation = useMemo(() => {
        // Reading the boundary inside the memo makes the false→true transition
        // explicit while keeping async enrichment out of the dependency set.
        void presentationBoundary;
        const reserveUrl = queryClient.getQueryData<PeekCardData>(peekKey)?.reserve_url ?? null;
        return {
            actions: peekActionsForPresentation(actionContextItem, {
                reserveResolved: reserveUrl != null,
            }),
            reserveUrl,
        };
        // isSelected is deliberately a dependency: false→true is the exact
        // synchronous presentation boundary. Async query data is not.
    }, [actionContextItem, peekKey, presentationBoundary, queryClient]);

    const { data: enrichment } = usePeekCard({
        viewerId,
        restaurantId: item.id,
        context,
        isSelected,
    });
    const media = useMemo(
        () => (enrichment?.media ?? [])
            .map((candidate) => resolvePeekMediaCandidate(candidate, item.name))
            .filter((value): value is NonNullable<typeof value> => value != null),
        [enrichment?.media, item.name],
    );
    const mediaIdentity = `${contextToken}:${media.map(({ candidate }) => `${candidate.kind}:${candidate.url}`).join('|')}`;
    const [mediaIndex, setMediaIndex] = useState(0);
    useEffect(() => setMediaIndex(0), [mediaIdentity]);
    const selectedMedia = media[mediaIndex];
    const mediaCandidate = selectedMedia?.candidate;

    // Neighbor cards render from the already-loaded personal wishlist and never
    // issue a check. Selection enables one precise freshness request; cache and
    // optimistic mutation values take precedence over the screen-level seed.
    const checkedSaved = useIsWishlisted(item.id, viewerId, { enabled: isSelected });
    const saved = checkedSaved ?? seedSaved;
    const wishlistAdd = useWishlistAdd(viewerId);
    const wishlistRemove = useWishlistRemove(viewerId);
    const wishlistPending = wishlistAdd.isPending || wishlistRemove.isPending;
    const longPressHandledRef = useRef(false);

    // TICKET-140: tapping a single-author who-row opens that person's profile.
    // /u/[identifier] takes a raw user id (see app/follows.tsx) — works off any
    // layer without a table context (Discover isn't table-scoped).
    const openProfile = useCallback(
        (userId: string | null | undefined) => {
            if (!userId) return;
            router.push({ pathname: '/u/[identifier]', params: { identifier: userId } });
        },
        [router],
    );
    const isNetwork = context.layer === 'network';
    // TICKET-138 overlap card ("N of you saved this" + gather here) / TICKET-139
    // been-together card ("gathered <date>"). Additive variants — 135's card
    // architecture + 137's density stay.
    const isOverlap = context.layer === 'overlap';
    const isGathered = context.layer === 'gathered';
    const isListSpot = context.layer === 'list';

    const distanceLabel = userCoords
        ? formatDistance(haversineMiles(userCoords, { latitude: item.lat, longitude: item.lng }))
        : null;
    const price = priceTierLabel(item.priceLevel ?? enrichment?.price_level);
    const hasPersonalRatingLayer = isNetwork || context.layer === 'been';
    const googleCount = formatGoogleCount(enrichment?.google_rating_count ?? null);
    const googleRating = !hasPersonalRatingLayer && enrichment?.google_rating != null
        ? `${enrichment.google_rating.toFixed(1)}${googleCount ? ` (${googleCount})` : ''}`
        : null;
    const googleSignal = googleRating ? `${googleRating} · Google` : null;
    const meta = [item.cuisine, price, distanceLabel ?? item.city, googleSignal]
        .filter(Boolean)
        .join(' · ');

    // No numeral on overlap (no rating) or gathered (group meal, no personal avg).
    const rating = isNetwork ? item.rating : context.layer === 'been' ? item.myRating : null;

    // Body tap keeps the TICKET-124 routing: review-eligible network log → the
    // followee's review; everything else → the restaurant page.
    const opensReview = isNetwork && !!item.hasReview && !!onOpenReview;
    const onPressBody = opensReview
        ? () => onOpenReview!(item.entryId!)
        : () => onOpenRestaurant(item.id);

    const authorName = item.author?.name ?? 'Someone';
    // TICKET-140: who-row contract (words + tap target) — see peekWho.ts.
    const who = describePeekWho(item);
    const note = item.note?.trim() || null;
    const todayLine = todaysHoursLine(enrichment?.hours, new Date());
    const contextLine = isNetwork && note ? `— ${note}` : enrichment?.address_short;
    const savesLine = !isOverlap
        && enrichment?.visible_saves_count != null
        && enrichment.visible_saves_count >= 3
        ? `saved by ${enrichment.visible_saves_count}`
        : null;
    const effectiveScale = Math.max(1, Math.min(fontScale, PEEK_MAX_FONT_SCALE));
    const nameLineHeight = Math.round(24 * effectiveScale);
    const metaLineHeight = Math.round(18 * effectiveScale);
    const auxiliaryLineHeight = Math.round(19 * effectiveScale);
    const actionHeight = Math.round(44 + (effectiveScale - 1) * 14);

    const toggleWishlist = useCallback(() => {
        if (!viewerId || saved === undefined || wishlistPending) return;
        if (longPressHandledRef.current) {
            longPressHandledRef.current = false;
            return;
        }
        // The screen seed is intentionally not cached. Prime the canonical key
        // before mutation so its optimistic snapshot can restore this exact
        // value on rollback even when no selected-card check has resolved yet.
        const checkKey = queryKeys.wishlist.check(viewerId, item.id);
        if (queryClient.getQueryData<boolean>(checkKey) === undefined) {
            queryClient.setQueryData(checkKey, saved);
        }
        if (saved) {
            wishlistRemove.mutate(item.id, {
                onError: () => Alert.alert("Couldn't remove", 'Try again'),
            });
        } else {
            wishlistAdd.mutate(
                { restaurant_id: item.id },
                { onError: () => Alert.alert("Couldn't save", 'Try again') },
            );
        }
    }, [item.id, queryClient, saved, viewerId, wishlistAdd, wishlistPending, wishlistRemove]);

    const handleAction = useCallback((action: PeekActionId) => {
        switch (action) {
            case 'wishlist':
                toggleWishlist();
                return;
            case 'log_visit':
            case 'log_again':
                // /log-meal (the current LogSheet) — NOT the legacy /create-entry
                // composer. Same param contract as restaurant/[id]'s handleLogPress;
                // map pins are always persisted restaurants, so the row fields
                // suffice and log-meal re-derives the rest (placePayload optional).
                router.push({
                    pathname: '/log-meal',
                    params: {
                        restaurant: JSON.stringify({
                            id: item.id,
                            name: item.name,
                            city: item.city,
                            cuisine: item.cuisine,
                        }),
                    },
                });
                return;
            case 'directions':
                openDirections(item);
                return;
            case 'reserve':
                if (presentation.reserveUrl) Linking.openURL(presentation.reserveUrl).catch(() => {});
                return;
            case 'view_restaurant':
                onOpenRestaurant(item.id);
                return;
            case 'gather_here':
                onGather?.(item);
                return;
        }
    }, [item, onGather, onOpenRestaurant, presentation.reserveUrl, router, toggleWishlist]);

    const actionDisabled = useCallback((action: PeekActionId) => {
        if (action === 'wishlist') {
            return !viewerId || saved === undefined || wishlistPending;
        }
        if (action === 'reserve') return presentation.reserveUrl == null;
        if (action === 'gather_here') return onGather == null;
        return false;
    }, [onGather, presentation.reserveUrl, saved, viewerId, wishlistPending]);

    const renderAction = (action: PeekActionId, emphasized: boolean) => (
        <PeekActionButton
            key={action}
            action={action}
            emphasized={emphasized}
            saved={saved}
            pending={action === 'wishlist' && wishlistPending}
            disabled={actionDisabled(action)}
            height={actionHeight}
            palette={palette}
            onPress={() => handleAction(action)}
            onPressIn={action === 'wishlist' ? () => { longPressHandledRef.current = false; } : undefined}
            onLongPress={
                action === 'wishlist' && viewerId
                    ? () => {
                        longPressHandledRef.current = true;
                        onOpenListSheet(item);
                    }
                    : undefined
            }
        />
    );

    return (
        <View style={[styles.peekCard, { backgroundColor: palette.card, height }]}>
            <Pressable
                style={styles.peekMain}
                onPress={onPressBody}
                accessibilityLabel={
                    opensReview ? `Open ${authorName}'s review of ${item.name}` : `Open ${item.name}`
                }
            >
                <View style={styles.peekMediaColumn}>
                    <PeekMediaTile
                        item={item}
                        candidate={mediaCandidate}
                        palette={palette}
                        onError={() => setMediaIndex((index) => Math.min(index + 1, media.length))}
                    />
                    <View style={[styles.peekMediaCreditSlot, { height: auxiliaryLineHeight }]}>
                        {selectedMedia?.credit ? (
                            <PlacesCredit
                                credits={[selectedMedia.credit]}
                                photoCount={1}
                                testID="map-peek-places-credit"
                                interactive={false}
                            />
                        ) : null}
                    </View>
                </View>

                <View style={styles.peekContent}>
                    <View style={[styles.peekNameRow, { height: nameLineHeight }]}>
                        <Text
                            maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                            style={[styles.peekName, { color: palette.text, lineHeight: nameLineHeight }]}
                            numberOfLines={1}
                        >
                            {item.name}
                        </Text>
                        {rating != null ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekRating, { color: palette.primary, lineHeight: nameLineHeight }]}
                                numberOfLines={1}
                            >
                                {rating.toFixed(1)}
                            </Text>
                        ) : null}
                    </View>
                    <View style={{ height: metaLineHeight, justifyContent: 'center' }}>
                        {meta ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekMeta, { color: palette.textMuted, lineHeight: metaLineHeight }]}
                                numberOfLines={1}
                            >
                                {meta}
                            </Text>
                        ) : null}
                    </View>

                    <View style={[styles.peekReservedSlot, { height: auxiliaryLineHeight }]}>
                        {who.variant === 'network' ? (
                            <Pressable
                                style={({ pressed }) => [styles.peekWhoRow, { opacity: pressed ? 0.6 : 1 }]}
                                onPress={() => openProfile(who.tapUserId)}
                                disabled={!who.tapUserId}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${who.name}'s profile`}
                            >
                                <PeekWhoAvatar author={item.author} palette={palette} />
                                <Text
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[styles.peekWhoText, { color: palette.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    <Text style={[styles.peekWhoName, { color: palette.text }]}>{who.name}</Text>
                                    {who.othersSuffix}
                                </Text>
                            </Pressable>
                        ) : who.variant === 'saved-by' ? (
                            <Pressable
                                style={({ pressed }) => [styles.peekWhoRow, { opacity: pressed ? 0.6 : 1 }]}
                                onPress={() => openProfile(who.tapUserId)}
                                disabled={!who.tapUserId}
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${who.name}'s profile`}
                            >
                                <PeekAvatarStack members={item.overlap!.members} palette={palette} />
                                <Text
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[styles.peekWhoText, { color: palette.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    {'saved by '}
                                    <Text style={[styles.peekWhoName, { color: palette.text }]}>{who.name}</Text>
                                </Text>
                            </Pressable>
                        ) : who.variant === 'overlap-many' ? (
                            <View style={styles.peekWhoRow}>
                                <PeekAvatarStack members={item.overlap!.members} palette={palette} />
                                <Text
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[styles.peekWhoText, { color: palette.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    {who.label}
                                </Text>
                            </View>
                        ) : isGathered ? (
                            <View style={styles.peekWhoRow}>
                                <PeekAvatarStack members={item.gathered!.participants} palette={palette} />
                                <Text
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[styles.peekWhoText, { color: palette.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    {`gathered ${fmtShortDate(item.gathered!.on)}`}
                                </Text>
                            </View>
                        ) : isListSpot && note ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekNote, { color: palette.textSecondary }]}
                                numberOfLines={1}
                            >
                                {`— ${note}`}
                            </Text>
                        ) : null}
                    </View>
                    <View style={[styles.peekReservedSlot, { height: auxiliaryLineHeight }]}>
                        {todayLine ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekAuxText, { color: palette.textSecondary }]}
                                numberOfLines={1}
                            >
                                {`today ${todayLine}`}
                            </Text>
                        ) : null}
                    </View>
                    <View style={[styles.peekReservedSlot, { height: auxiliaryLineHeight }]}>
                        {contextLine ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekNote, { color: palette.textSecondary }]}
                                numberOfLines={1}
                            >
                                {contextLine}
                            </Text>
                        ) : null}
                    </View>
                    <View style={[styles.peekReservedSlot, { height: auxiliaryLineHeight }]}>
                        {savesLine ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[styles.peekSaves, { color: palette.textMuted }]}
                                numberOfLines={1}
                            >
                                {savesLine}
                            </Text>
                        ) : null}
                    </View>
                </View>
            </Pressable>

            <View style={styles.peekActions}>
                {renderAction(presentation.actions.slot1, true)}
                {presentation.actions.slot2 ? renderAction(presentation.actions.slot2, false) : null}
                {presentation.actions.slot3 ? renderAction(presentation.actions.slot3, false) : null}
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

/**
 * ≤5 overlapping 16px avatars — the overlap "N of you saved this" (TICKET-138)
 * and been-together participant (TICKET-139) stack. Image, or initial on the
 * seeded tint (matches the pin chip / PeekWhoAvatar). The data already caps at 5.
 */
function PeekAvatarStack({
    members,
    palette,
}: {
    members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
    palette: typeof Colors.light;
}) {
    const shown = members.slice(0, 5);
    if (shown.length === 0) return null;
    const STEP = 11;
    return (
        <View style={[styles.peekStack, { width: 16 + (shown.length - 1) * STEP }]}>
            {shown.map((m, i) => {
                const name = m.display_name ?? 'Member';
                const tint = avatarTintFor(m.user_id || name, palette);
                return (
                    <View
                        key={m.user_id || i}
                        style={[
                            styles.peekStackCell,
                            { left: i * STEP, zIndex: shown.length - i, borderColor: palette.surfaceContainerLow },
                        ]}
                    >
                        {m.avatar_url ? (
                            <ExpoImage
                                source={{ uri: m.avatar_url }}
                                style={styles.peekStackImg}
                                contentFit="cover"
                            />
                        ) : (
                            <View
                                style={[
                                    styles.peekStackImg,
                                    { backgroundColor: tint, alignItems: 'center', justifyContent: 'center' },
                                ]}
                            >
                                <Text style={[styles.peekWhoInitial, { color: palette.text }]}>
                                    {(name.trim()[0] ?? '?').toUpperCase()}
                                </Text>
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

/** "12 jun" — the been-together peek date label (lowercase per voice). */
function fmtShortDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return `${d.getDate()} ${mo}`;
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
    // TICKET-179: frost behind the floating empty murmur (legibility over tiles).
    emptyPill: {
        alignItems: 'center',
        gap: 10,
        paddingVertical: 18,
        paddingHorizontal: 22,
        borderRadius: 18,
        maxWidth: 300,
    },
    emptyAction: {
        minHeight: 44,
        borderRadius: 14,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyActionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    // Source pills — frosted segmented control, top-left on the glass (⑨ h38·13/700).
    sourcePills: {
        position: 'absolute',
        left: 12,
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
        fontSize: 13,
        letterSpacing: 0.3,
    },
    // Filter chip — frosted, top-right on the glass (⑨ h38·13/700).
    filterChip: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 10,
    },
    filterChipText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
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
        left: 12,
        right: 12,
        alignItems: 'flex-start',
    },
    murmurPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
    },
    murmurText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    // Locate FAB — bottom-RIGHT frosted circle, clear of the floating nav pill (⑨ 46Ø).
    fab: {
        position: 'absolute',
        right: 12,
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // List pill (map → list) — bottom-RIGHT, stacked below the locate FAB (corner
    // law v2, TICKET-137). Same frost family + elevation (⑨ h42·13/800).
    listToggle: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    listToggleText: {
        fontFamily: 'Manrope_800ExtraBold',
        fontSize: 13,
        letterSpacing: 0.4,
    },
    // People chip — Discover only, bottom-LEFT (corner law v2, TICKET-137).
    // Frosted people-outline + state label; opens the picker sheet.
    peopleChip: {
        position: 'absolute',
        left: 12,
        maxWidth: SCREEN_W * 0.5,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 15,
        paddingVertical: 11,
    },
    peopleChipText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    // Primary import/review workflow — above the lower map controls and nav.
    // Import + status chips — frosted, top-right stack under the filter chip.
    importChip: {
        position: 'absolute',
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 10,
    },
    importChipText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    // Ghosted ToS attribution caption — bottom-center, above the nav clearance.
    attribution: {
        position: 'absolute',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.2,
    },
    // ── Peek carousel ──────────────────────────────────────────────────────────
    peekWrap: {
        position: 'absolute',
        left: 0,
        right: 0,
    },
    peekCloseFab: {
        position: 'absolute',
        top: 0,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    peekCard: {
        width: PEEK_CARD_W,
        marginRight: PEEK_GAP,
        borderRadius: Radius.lg,
        padding: 12,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 24,
        elevation: 8,
    },
    peekMain: {
        flex: 1,
        minHeight: 0,
        flexDirection: 'row',
        gap: 10,
    },
    peekMediaColumn: {
        width: 108,
        alignSelf: 'stretch',
    },
    peekMedia: {
        flex: 1,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    peekMediaOutline: {
        ...StyleSheet.absoluteFillObject,
        borderWidth: 1,
        borderRadius: Radius.md,
    },
    peekMediaCreditSlot: {
        justifyContent: 'flex-end',
        paddingHorizontal: 2,
    },
    peekPlateInset: {
        position: 'absolute',
        top: 4,
        left: 4,
        right: 4,
        bottom: 4,
        borderRadius: 9,
        borderWidth: 1,
    },
    peekPlateGlyph: {
        opacity: 0.82,
    },
    peekPlateEmoji: {
        fontSize: 25,
        includeFontPadding: false,
    },
    peekContent: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
    },
    peekNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    peekName: {
        flex: 1,
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 19,
    },
    peekRating: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 19,
    },
    peekMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    peekReservedSlot: {
        minWidth: 0,
        justifyContent: 'center',
        overflow: 'hidden',
    },
    peekWhoRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    peekWhoAvatar: {
        width: 16,
        height: 16,
        borderRadius: 8,
        overflow: 'hidden',
    },
    peekStack: {
        height: 16,
        position: 'relative',
    },
    peekStackCell: {
        position: 'absolute',
        top: 0,
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1.5,
        overflow: 'hidden',
    },
    peekStackImg: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
    },
    peekWhoInitial: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 8,
        includeFontPadding: false,
    },
    peekWhoText: {
        flex: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    peekWhoName: {
        fontFamily: 'Manrope_700Bold',
    },
    peekNote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
    },
    peekAuxText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    peekSaves: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    peekActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    peekPrimaryAction: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderRadius: Radius.md,
        paddingHorizontal: 12,
    },
    peekPrimaryActionLabel: {
        flexShrink: 1,
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.1,
    },
    peekIconAction: {
        width: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Radius.md,
    },
});

export default WishlistMapView;
