/**
 * useClusteredPins unit tests — TICKET-153 map pin clustering.
 *
 * Rendering-independent: the hook's math is extracted into pure helpers
 * (itemsToPoints · regionToBboxZoom · pinSetHash · buildClusterIndex ·
 * queryClusterEntries), so these tests exercise the EXACT logic the hook wires
 * into useMemo without pulling in react-native-maps / a renderer.
 *
 * Pins the load-bearing rules from the Test Plan:
 *  - sub-threshold bypass boundary (30 → untouched, 31 → clustered)
 *  - neighborhood zoom (above maxZoom) stays individual
 *  - point pass-through preserves object identity (marker keys don't churn)
 *  - pin-set hash stability (benign re-render vs real reshaping)
 *  - zoom derivation clamped to the 1/20 rails
 *  - expansionZoom delegates to the live index
 *  - degenerate inputs: empty, single pin, all-same-coordinate
 */
import type { Region } from 'react-native-maps';

import {
    CLUSTER_MIN,
    CLUSTER_MAX_ZOOM,
    buildClusterIndex,
    itemsToPoints,
    pinSetHash,
    pinVariant,
    queryClusterEntries,
    regionQueryKey,
    regionToBboxZoom,
    zoomForDelta,
} from '../useClusteredPins';
import type { WishlistMapItem } from '../WishlistMapView';

// ── Fixtures ────────────────────────────────────────────────────────────────────

function item(over: Partial<WishlistMapItem> & { id: string }): WishlistMapItem {
    return {
        name: `Spot ${over.id}`,
        city: 'Tokyo',
        cuisine: 'Japanese',
        lat: 35,
        lng: 139,
        ...over,
    };
}

/** N pins at exactly the same coordinate (the large-import worst case). */
const coLocated = (n: number): WishlistMapItem[] =>
    Array.from({ length: n }, (_, i) => item({ id: `r${i}` }));

const regionAt = (lat: number, lng: number, delta: number): Region => ({
    latitude: lat,
    longitude: lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
});

// Centered on the co-located coordinate so the pins fall inside the bbox.
const LOW_ZOOM = regionAt(35, 139, 20); // zoom ≈ 4 — clustering engaged
const HIGH_ZOOM = regionAt(35, 139, 0.001373); // zoom ≈ 18 — above maxZoom (leaves)

const totalPins = (entries: ReturnType<typeof queryClusterEntries>): number =>
    entries.reduce((sum, e) => sum + (e.type === 'cluster' ? e.count : 1), 0);

// ── Bypass boundary ───────────────────────────────────────────────────────────

describe('sub-threshold bypass', () => {
    it('CLUSTER_MIN is 30 (the "≤~30 identical to today" bar)', () => {
        expect(CLUSTER_MIN).toBe(30);
    });

    it('30 items → index bypassed (null), all 30 pass through as points', () => {
        const items = coLocated(30);
        const index = buildClusterIndex(items);
        expect(index).toBeNull(); // supercluster never touched

        const entries = queryClusterEntries(index, LOW_ZOOM, items);
        expect(entries).toHaveLength(30);
        expect(entries.every((e) => e.type === 'point')).toBe(true);
    });

    it('31 co-located items at low zoom → clustered, count sums to 31', () => {
        const items = coLocated(31);
        const index = buildClusterIndex(items);
        expect(index).not.toBeNull(); // clustering engaged at 31

        const entries = queryClusterEntries(index, LOW_ZOOM, items);
        expect(entries.some((e) => e.type === 'cluster')).toBe(true);
        expect(totalPins(entries)).toBe(31);
    });

    it('respects a custom minCount', () => {
        const items = coLocated(10);
        expect(buildClusterIndex(items, { minCount: 5 })).not.toBeNull(); // 10 > 5
        expect(buildClusterIndex(items, { minCount: 10 })).toBeNull(); // 10 <= 10
    });
});

// ── Neighborhood zoom stays individual ────────────────────────────────────────

describe('maxZoom / neighborhood zoom', () => {
    it('the same dense set queried above maxZoom → all points, zero clusters', () => {
        const items = coLocated(31);
        const index = buildClusterIndex(items)!;
        // maxZoom 16 → getClusters returns only leaves at maxZoom + 1; a query
        // above it (zoom ≈ 18) never clusters, so each pin stays individual.
        expect(zoomForDelta(HIGH_ZOOM.longitudeDelta)).toBeGreaterThan(CLUSTER_MAX_ZOOM);

        const entries = queryClusterEntries(index, HIGH_ZOOM, items);
        expect(entries.every((e) => e.type === 'point')).toBe(true);
        expect(entries).toHaveLength(31);
    });
});

// ── Point pass-through fidelity ────────────────────────────────────────────────

describe('point identity is preserved', () => {
    it('itemsToPoints keeps the SAME item object reference in properties', () => {
        const items = coLocated(3);
        const points = itemsToPoints(items);
        points.forEach((p, i) => {
            expect(p.properties.item).toBe(items[i]); // ===, not a copy
            expect(p.geometry.coordinates).toEqual([items[i].lng, items[i].lat]); // [lng, lat]
        });
    });

    it('bypass point entries are === the original items, in order', () => {
        const items = coLocated(5);
        const entries = queryClusterEntries(null, LOW_ZOOM, items);
        entries.forEach((e, i) => {
            expect(e.type).toBe('point');
            if (e.type === 'point') expect(e.item).toBe(items[i]);
        });
    });

    it('clustered leaf entries are === the original items too', () => {
        const items = coLocated(31);
        const index = buildClusterIndex(items)!;
        // At the leaves level every entry is an individual pin carrying its
        // original object — so an unclustered marker never churns its key.
        const entries = queryClusterEntries(index, HIGH_ZOOM, items);
        const leafItems = entries.flatMap((e) => (e.type === 'point' ? [e.item] : []));
        leafItems.forEach((it) => expect(items).toContain(it));
        expect(leafItems).toHaveLength(31);
    });
});

// ── Pin-set hash stability ────────────────────────────────────────────────────

describe('pinSetHash', () => {
    it('identical contents in a fresh array hash the same (no rebuild)', () => {
        const a = coLocated(4);
        const b = coLocated(4); // new array, same ids + variants
        expect(pinSetHash(a)).toBe(pinSetHash(b));
        expect(a).not.toBe(b);
    });

    it('changing an id changes the hash', () => {
        const a = coLocated(4);
        const b = [...coLocated(3), item({ id: 'DIFFERENT' })];
        expect(pinSetHash(a)).not.toBe(pinSetHash(b));
    });

    it('changing a variant (same id) changes the hash', () => {
        const saved = [item({ id: 'r0' })]; // → 's'
        const been = [item({ id: 'r0', been: true })]; // → 'b'
        expect(pinSetHash(saved)).not.toBe(pinSetHash(been));
    });

    it('marker-face changes under a stable variant:id change the hash (review P2-1/P2-4)', () => {
        const base = () => item({ id: 'r0' });
        const baseline = pinSetHash([base()]);
        // In-place refetch mutations a marker renders: each must invalidate.
        expect(pinSetHash([{ ...base(), emoji: '🍜' }])).not.toBe(baseline);
        expect(pinSetHash([{ ...base(), myRating: 9.5 }])).not.toBe(baseline);
        expect(pinSetHash([{ ...base(), lat: 51.6 }])).not.toBe(baseline);
        const over = (count: number) =>
            pinSetHash([
                { ...base(), overlap: { count, tableId: 't', tableName: 'T', members: [] } },
            ]);
        expect(over(3)).not.toBe(over(4)); // overlap COUNT, not object identity
        const net = (avatar: string | null) =>
            pinSetHash([
                { ...base(), entryId: 'e1', author: { id: 'u1', name: 'Clara', avatar } },
            ]);
        expect(net('a.jpg')).not.toBe(net('b.jpg'));
        expect(pinSetHash([{ ...base(), entryId: 'e1', hasReview: true }])).not.toBe(
            pinSetHash([{ ...base(), entryId: 'e1' }]),
        );
        // Peek-card-only fields stay out: no gratuitous rebuilds.
        expect(pinSetHash([{ ...base(), note: 'lovely', priceLevel: 2 }])).toBe(baseline);
    });

    it('pinVariant matches the marker-key discriminant o|n|b|s precedence', () => {
        expect(pinVariant(item({ id: 'x' }))).toBe('s');
        expect(pinVariant(item({ id: 'x', been: true }))).toBe('b');
        expect(pinVariant(item({ id: 'x', entryId: 'e1' }))).toBe('n');
        expect(
            pinVariant(
                item({
                    id: 'x',
                    entryId: 'e1',
                    overlap: { count: 3, tableId: 't', tableName: 'T', members: [] },
                }),
            ),
        ).toBe('o'); // overlap outranks network
    });
});

// ── Zoom derivation ───────────────────────────────────────────────────────────

describe('zoomForDelta / regionToBboxZoom', () => {
    it('maps longitude deltas to the expected integer zooms', () => {
        expect(zoomForDelta(0.08)).toBe(12); // initialRegion delta
        expect(zoomForDelta(0.045)).toBe(13); // CITY_DELTA
        expect(zoomForDelta(0.013)).toBe(15); // NEAR_ME_DELTA
    });

    it('clamps to the 1 / 20 rails', () => {
        expect(zoomForDelta(360)).toBe(1); // whole world → low rail (raw 0, clamped)
        expect(zoomForDelta(1e-7)).toBe(20); // absurd zoom-in → high rail
        expect(zoomForDelta(0)).toBe(20); // degenerate delta → clamped, not NaN
    });

    it('derives a [west, south, east, north] bbox from center ± delta/2', () => {
        const { bbox, zoom } = regionToBboxZoom(regionAt(35, 139, 0.08));
        expect(bbox).toEqual([139 - 0.04, 35 - 0.04, 139 + 0.04, 35 + 0.04]);
        expect(zoom).toBe(12);
    });
});

// ── Region query key (rounding) ────────────────────────────────────────────────

describe('regionQueryKey', () => {
    it('collapses sub-milli pan jitter to the same key', () => {
        const a = regionAt(35, 139, 0.08);
        const b = regionAt(35.00001, 139.00001, 0.08); // < 0.001 drift
        expect(regionQueryKey(a)).toBe(regionQueryKey(b));
    });

    it('changes when the viewport moves meaningfully', () => {
        expect(regionQueryKey(regionAt(35, 139, 0.08))).not.toBe(
            regionQueryKey(regionAt(36, 139, 0.08)),
        );
    });

    it('returns a stable constant for a null region', () => {
        expect(regionQueryKey(null)).toBe(regionQueryKey(null));
        expect(typeof regionQueryKey(null)).toBe('string');
    });
});

// ── expansionZoom wiring ──────────────────────────────────────────────────────

describe('cluster expansionZoom', () => {
    it('returns a finite zoom ≥ the current query zoom (delegates to the index)', () => {
        const items = coLocated(31);
        const index = buildClusterIndex(items)!;
        const queryZoom = zoomForDelta(LOW_ZOOM.longitudeDelta);

        const entries = queryClusterEntries(index, LOW_ZOOM, items);
        const cluster = entries.find((e) => e.type === 'cluster');
        expect(cluster).toBeDefined();
        if (cluster && cluster.type === 'cluster') {
            const z = cluster.expansionZoom();
            expect(Number.isFinite(z)).toBe(true);
            expect(z).toBeGreaterThanOrEqual(queryZoom);
        }
    });
});

// ── Degenerate inputs ─────────────────────────────────────────────────────────

describe('degenerate inputs', () => {
    it('empty set → null index and no entries', () => {
        expect(buildClusterIndex([])).toBeNull();
        expect(queryClusterEntries(null, LOW_ZOOM, [])).toEqual([]);
    });

    it('single pin → bypass, one point entry', () => {
        const items = [item({ id: 'solo' })];
        const index = buildClusterIndex(items);
        expect(index).toBeNull();
        const entries = queryClusterEntries(index, LOW_ZOOM, items);
        expect(entries).toEqual([{ type: 'point', item: items[0] }]);
    });

    it('a null region falls back to pass-through even with a live index', () => {
        const items = coLocated(31);
        const index = buildClusterIndex(items)!;
        const entries = queryClusterEntries(index, null, items);
        expect(entries).toHaveLength(31);
        expect(entries.every((e) => e.type === 'point')).toBe(true);
    });

    it('all-same-coordinate at scale does not throw and conserves the count', () => {
        const items = coLocated(120);
        const index = buildClusterIndex(items)!;
        expect(() => queryClusterEntries(index, LOW_ZOOM, items)).not.toThrow();
        expect(totalPins(queryClusterEntries(index, LOW_ZOOM, items))).toBe(120);
    });
});
