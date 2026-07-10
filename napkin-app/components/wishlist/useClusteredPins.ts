/**
 * useClusteredPins — supercluster wrapper around the wishlist map pin set
 * (TICKET-153).
 *
 * WishlistMapView renders one custom-view `<Marker>` per spot. At friend-test
 * densities that's fine, but TICKET-152 lets a user pin a 117–500-spot Google
 * Maps list in one import, and hundreds of custom-view markers jank hard on
 * react-native-maps / iOS. This hook clusters the pin set app-side with the
 * pure-JS `supercluster` index (the library react-native-maps itself
 * recommends — zero native footprint, so no version bump and no new
 * patch-package surface on our patched 1.20.1).
 *
 * Two memo layers keep pan/zoom off the expensive path:
 *   1. INDEX build (`buildClusterIndex`) — `new Supercluster().load(points)` is
 *      the costly step and depends ONLY on the pin set, so the hook memoizes it
 *      on a stable pin-set hash. Panning/zooming never rebuilds it.
 *   2. QUERY (`queryClusterEntries`) — `getClusters(bbox, zoom)` is cheap and
 *      runs off the index; the hook memoizes it on a ROUNDED region+zoom key so
 *      sub-pixel pan jitter doesn't recompute.
 *
 * Sub-threshold BYPASS: when `items.length <= minCount` (≈30) the hook returns
 * the items untouched as `point` entries and never touches supercluster —
 * "≤~30 pins identical to today" is the acceptance bar, and a hard bypass is a
 * stronger guarantee than trusting supercluster to leave sparse points alone.
 *
 * The math is extracted into exported pure helpers (`itemsToPoints`,
 * `regionToBboxZoom`, `pinSetHash`, `buildClusterIndex`, `queryClusterEntries`)
 * so it's unit-testable without rendering — the hook only wires them into
 * `useMemo`.
 */
import { useMemo } from 'react';
import Supercluster from 'supercluster';
import type { Region } from 'react-native-maps';

import type { WishlistMapItem } from './WishlistMapView';

// ── Tuning constants ────────────────────────────────────────────────────────────

/** Sub-threshold bypass: at/under this many pins the hook returns items
 * untouched (no clustering) — the direct expression of "≤~30 identical to
 * today." */
export const CLUSTER_MIN = 30;
/** Merge radius in screen px (supercluster default is 40). 48 is the founder
 * thumb-test starting value; tune here before reaching for a native manager. */
export const CLUSTER_RADIUS = 48;
/** Above this zoom nothing clusters — single pins stay individual at
 * neighborhood zoom (`getClusters` returns only leaves at maxZoom + 1). */
export const CLUSTER_MAX_ZOOM = 16;

// ── Types ───────────────────────────────────────────────────────────────────────

/** The GeoJSON point payload — carries the original item verbatim so an
 * unclustered pin renders with its exact identity/variant (a `type` alias, not
 * an interface, so it satisfies supercluster's `GeoJsonProperties` bound). */
type PinProps = { item: WishlistMapItem };
export type PinFeature = Supercluster.PointFeature<PinProps>;

/** One entry to render: either a cluster count-bubble or a pass-through pin. */
export type ClusterEntry =
    | {
          type: 'cluster';
          /** supercluster's cluster id — stable within an index + zoom. */
          id: number;
          lat: number;
          lng: number;
          count: number;
          /** Zoom at which this cluster expands into its children (click-to-zoom);
           * delegates to the live index. */
          expansionZoom: () => number;
      }
    | { type: 'point'; item: WishlistMapItem };

// ── Pure helpers (unit-tested directly) ──────────────────────────────────────────

/**
 * The layer discriminant used both by the marker key in WishlistMapView and by
 * the pin-set hash: `o` overlap · `n` network · `b` been · `s` saved. A layer
 * swap that reshapes a pin changes this tag, so the index rebuilds; a pure
 * re-render with the same set does not.
 */
export function pinVariant(item: WishlistMapItem): 'o' | 'n' | 'b' | 's' {
    return item.overlap != null ? 'o' : item.entryId != null ? 'n' : item.been ? 'b' : 's';
}

/**
 * A stable string identity for a pin set — joined per-pin face signatures. Two
 * different arrays with the same contents hash identically (so a benign
 * re-render never rebuilds the index); changing anything a MARKER renders —
 * variant, coords, list emoji, overlap count, loved-heart rating, avatar,
 * review badge — changes the hash, so an in-place refetch that preserves
 * `variant:id` still refreshes clustered leaf faces (review P2-1/P2-4).
 * Peek-card-only fields (name, note, priceLevel…) stay out on purpose.
 */
export function pinSetHash(items: WishlistMapItem[]): string {
    let h = '';
    for (const it of items) {
        h += `${pinVariant(it)}:${it.id}:${it.lat},${it.lng}:${it.emoji ?? ''}:` +
            `${it.overlap?.count ?? ''}:${it.myRating ?? ''}:${it.author?.avatar ?? ''}:` +
            `${it.hasReview ? 1 : ''}|`;
    }
    return h;
}

/** Map items → GeoJSON point features; `properties.item` is the SAME object
 * reference (identity preserved so pass-through markers don't churn). */
export function itemsToPoints(items: WishlistMapItem[]): PinFeature[] {
    return items.map(
        (item): PinFeature => ({
            type: 'Feature',
            properties: { item },
            geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        }),
    );
}

/** Integer zoom from a longitude delta, clamped to the 1..20 rails. Matches the
 * file's `latitudeDelta ≈ 360 / 2^zoom` convention. */
export function zoomForDelta(longitudeDelta: number): number {
    return Math.min(20, Math.max(1, Math.round(Math.log2(360 / longitudeDelta))));
}

/** Region → `[west, south, east, north]` bbox + integer zoom for
 * `getClusters`. */
export function regionToBboxZoom(region: Region): {
    bbox: [number, number, number, number];
    zoom: number;
} {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
    const west = longitude - longitudeDelta / 2;
    const east = longitude + longitudeDelta / 2;
    const south = latitude - latitudeDelta / 2;
    const north = latitude + latitudeDelta / 2;
    return { bbox: [west, south, east, north], zoom: zoomForDelta(longitudeDelta) };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The query memo key — rounded bbox + zoom, so sub-pixel pan jitter collapses
 * to the same string and doesn't recompute. `null` region → a constant. */
export function regionQueryKey(region: Region | null): string {
    if (!region) return '∅';
    const { bbox, zoom } = regionToBboxZoom(region);
    return `${zoom}|${round3(bbox[0])}|${round3(bbox[1])}|${round3(bbox[2])}|${round3(bbox[3])}`;
}

/**
 * Build the supercluster index for a pin set — or `null` when the set is at/under
 * `minCount` (the bypass: supercluster is never touched for sparse sets).
 */
export function buildClusterIndex(
    items: WishlistMapItem[],
    opts?: { minCount?: number; radius?: number; maxZoom?: number },
): Supercluster<PinProps> | null {
    const minCount = opts?.minCount ?? CLUSTER_MIN;
    if (items.length <= minCount) return null;
    const sc = new Supercluster<PinProps>({
        radius: opts?.radius ?? CLUSTER_RADIUS,
        maxZoom: opts?.maxZoom ?? CLUSTER_MAX_ZOOM,
        minPoints: 2, // a lone point never becomes a "cluster of 1"
    });
    sc.load(itemsToPoints(items));
    return sc;
}

/**
 * Query the index for the visible region and map to render entries. When the
 * index is `null` (bypass) or there's no region yet, returns every item as a
 * pass-through `point` (identity preserved).
 */
export function queryClusterEntries(
    index: Supercluster<PinProps> | null,
    region: Region | null,
    items: WishlistMapItem[],
): ClusterEntry[] {
    if (!index || !region) {
        return items.map((item) => ({ type: 'point', item }));
    }
    const { bbox, zoom } = regionToBboxZoom(region);
    return index.getClusters(bbox, zoom).map((feature): ClusterEntry => {
        const props = feature.properties as Supercluster.ClusterProperties | PinProps;
        if ((props as Supercluster.ClusterProperties).cluster) {
            const cp = props as Supercluster.ClusterProperties;
            const [lng, lat] = feature.geometry.coordinates;
            return {
                type: 'cluster',
                id: cp.cluster_id,
                lat,
                lng,
                count: cp.point_count,
                expansionZoom: () => index.getClusterExpansionZoom(cp.cluster_id),
            };
        }
        return { type: 'point', item: (props as PinProps).item };
    });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Clustered render entries for the pin set at the current region. Index rebuilds
 * only on pin-set change; region pan/zoom re-queries only. Below `minCount` the
 * items pass straight through untouched.
 */
export function useClusteredPins(
    items: WishlistMapItem[],
    region: Region | null,
    opts?: { minCount?: number; radius?: number; maxZoom?: number },
): ClusterEntry[] {
    const minCount = opts?.minCount ?? CLUSTER_MIN;
    const radius = opts?.radius ?? CLUSTER_RADIUS;
    const maxZoom = opts?.maxZoom ?? CLUSTER_MAX_ZOOM;

    // Derived pin-set identity — the index rebuild key. A fresh `items` array
    // with identical contents hashes the same → no rebuild.
    const hash = useMemo(() => pinSetHash(items), [items]);

    // INDEX — the expensive `.load(points)`, keyed on the pin set only. Null
    // when bypassing.
    const index = useMemo(
        () => buildClusterIndex(items, { minCount, radius, maxZoom }),
        // `hash` stands in for `items` (identical sets must not rebuild); opts
        // are primitives.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [hash, minCount, radius, maxZoom],
    );

    // Pass-through entries for the bypass / no-region path — keyed on the array
    // reference so item-object updates (rating, etc.) reach the markers.
    const passthrough = useMemo<ClusterEntry[]>(
        () => items.map((item) => ({ type: 'point', item })),
        [items],
    );

    // QUERY — cheap `getClusters`, keyed on the ROUNDED region string so a new
    // `region` object with the same rounded bounds doesn't recompute.
    const queryKey = regionQueryKey(region);
    const clustered = useMemo<ClusterEntry[] | null>(
        () => (index && region ? queryClusterEntries(index, region, items) : null),
        // region is read via `queryKey`; `items` is unused on this (clustering)
        // branch — the bypass identity path lives in `passthrough`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [index, queryKey],
    );

    return clustered ?? passthrough;
}
