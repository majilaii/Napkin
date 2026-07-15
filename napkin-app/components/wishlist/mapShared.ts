/**
 * mapShared — the NEUTRAL map primitives shared by `WishlistMapView` (the full
 * wishlist/dining map) and `ScopedListMap` (TICKET-186's lean single-list map).
 *
 * Deliberately free of any React / react-native / react-native-maps import so
 * both maps can consume one algorithm with no type cycle (Codex #6): the pin
 * shape, the location status, the framing deltas, and the PURE
 * `chooseCollectionCamera` helper — the collection-framing logic that used to
 * live inline in `WishlistMapView:700-768`. `WishlistMapView` and
 * `ScopedListMap` each own their own MapView, refs, and lifecycle.
 */
import { haversineMiles, type LatLng as GeoLatLng } from '@/lib/geo';

export type { GeoLatLng };

// ── Pin shape ─────────────────────────────────────────────────────────────────

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
    /** Selected-List context. Presence keeps the authored carousel order and
     * lets the shared peek surface show rank + curator note. */
    listContext?: {
        listId: string;
        rank: number | null;
    };
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
    /**
     * TICKET-138: a restaurant saved by 2+ members of one of the viewer's tables
     * (table-inclusive count). Presence ranks ABOVE network in BubblePin: amber
     * count bubble, no avatar chip, no loved heart. `members` is the ≤5 stack the
     * peek renders. `count===1` (TICKET-139 saved layer) renders as a plain
     * terracotta save bubble; `count>=2` is the amber count face.
     */
    overlap?: {
        count: number;
        tableId: string;
        tableName: string;
        members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
    } | null;
    /**
     * TICKET-139 been-together: a group meal (supper / legacy round) at this
     * restaurant. Set with `been: true` (olive glyph pin — no new BubblePin
     * variant); only the peek branches on `gathered`.
     */
    gathered?: {
        /** Exact enclosing Table used to authorize the gathered media context. */
        tableId: string;
        on: string; // ISO — "gathered 12 jun"
        participants: { user_id: string; display_name: string; avatar_url: string | null }[];
        suppersCount: number;
    } | null;
}

/** Lazy-location lifecycle (mirrors `useNearbyLocation`). */
export type LocationStatus = 'idle' | 'pending' | 'granted' | 'denied';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fixed paper ground for every map surface — the map reads as a paper object
 * even in system dark mode (`userInterfaceStyle="light"`, TICKET-134 ⑧). */
export const CREAM = '#fdf6ec';

// ── Framing deltas ──────────────────────────────────────────────────────────────
// ONE region API for all camera moves: Camera.zoom is GOOGLE-ONLY — Apple Maps
// keys on altitude and silently ignores zoom. animateToRegion behaves
// identically on both providers. latitudeDelta ≈ 360 / 2^zoom.
/** Locate — zoom IN to a walkable radius (≈ zoom 15); pins stay legible. */
export const NEAR_ME_DELTA = 0.013;
/** First frame on open — the "near me" city view (≈ zoom 13). */
export const CITY_DELTA = 0.045;
/** Landing on a single spot (≈ zoom 14). */
export const SPOT_DELTA = 0.022;

// ── Collection scale ─────────────────────────────────────────────────────────────

const COLLECTION_FIT_MAX_LAT_SPAN = 0.45;
const COLLECTION_FIT_MAX_LNG_SPAN = 0.65;

/** Whether all points still form a useful city/regional overview. */
export function isCityScaleCollection(
    items: readonly Pick<WishlistMapItem, 'lat' | 'lng'>[],
): boolean {
    if (items.length < 2) return true;
    const latitudes = items.map((item) => item.lat);
    const longitudes = items.map((item) => item.lng);
    return (
        Math.max(...latitudes) - Math.min(...latitudes) <= COLLECTION_FIT_MAX_LAT_SPAN
        && Math.max(...longitudes) - Math.min(...longitudes) <= COLLECTION_FIT_MAX_LNG_SPAN
    );
}

// ── chooseCollectionCamera (the WishlistMapView:700-768 algorithm, extracted) ────

export interface MapRegion {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
}

/**
 * Discriminated camera command:
 *   - `region`: animateToRegion to a single framed point at the given deltas.
 *   - `fit`:    fitToCoordinates over the whole collection (caller supplies the
 *               visual edge margin; occlusion padding rides on `mapPadding`).
 *   - `defer`:  a cross-city collection needs user location to pick the nearest
 *               anchor, and location has not resolved yet — the caller should
 *               wait for `LocationStatus` to settle, then re-run.
 */
export type CameraAction =
    | { kind: 'region'; region: MapRegion }
    | { kind: 'fit'; coords: { latitude: number; longitude: number }[] }
    | { kind: 'defer' };

function regionAt(item: Pick<WishlistMapItem, 'lat' | 'lng'>, delta: number): MapRegion {
    return {
        latitude: item.lat,
        longitude: item.lng,
        latitudeDelta: delta,
        longitudeDelta: delta,
    };
}

/**
 * The one collection-framing algorithm (Codex #5/#6). Ported verbatim from
 * `WishlistMapView:727-765`:
 *   1 pin        → region at SPOT_DELTA.
 *   city-scale   → fit the whole footprint.
 *   cross-city   → the pin nearest the user at CITY_DELTA (never a fit-all
 *                  world zoom); when coords are not yet known but location is
 *                  still resolving, `defer` so the frame can wait for them
 *                  rather than snapping to `items[0]` first.
 */
export function chooseCollectionCamera(
    items: readonly WishlistMapItem[],
    userCoords: GeoLatLng | null,
    status: LocationStatus,
): CameraAction {
    if (items.length === 0) return { kind: 'defer' };
    if (items.length === 1) return { kind: 'region', region: regionAt(items[0], SPOT_DELTA) };
    if (isCityScaleCollection(items)) {
        return { kind: 'fit', coords: items.map((item) => ({ latitude: item.lat, longitude: item.lng })) };
    }

    // Cross-city spread — anchor on the nearest pin.
    if (userCoords) {
        const nearest = [...items].sort(
            (a, b) =>
                haversineMiles(userCoords, { latitude: a.lat, longitude: a.lng })
                - haversineMiles(userCoords, { latitude: b.lat, longitude: b.lng }),
        )[0];
        return { kind: 'region', region: regionAt(nearest, CITY_DELTA) };
    }
    // No coords yet: wait if location may still resolve, else fall to the first.
    if (status === 'idle' || status === 'pending') return { kind: 'defer' };
    return { kind: 'region', region: regionAt(items[0], CITY_DELTA) };
}
