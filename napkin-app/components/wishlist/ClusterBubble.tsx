/**
 * ClusterBubble / ClusterMarker — the map cluster count face (TICKET-153).
 *
 * Kin to WishlistMapView's amber overlap count bubble, terracotta instead of
 * amber: a cream plate, a terracotta ring, the count in italic Newsreader (the
 * brand's rating-numeral treatment), an ambient shadow, and the same triangle
 * tail so the plate anchors its coordinate identically. A cluster is a COUNT,
 * nothing else — no cuisine glyph, no avatar chip, no loved heart.
 *
 * Tapping a cluster zooms the camera to its expansion zoom (the parent owns that
 * via `entry.expansionZoom()`); this component just draws the face and owns its
 * own `tracksViewChanges` window. Split out of the ~1900-line WishlistMapView
 * for testability + file hygiene, mirroring the BubblePin / WishlistMarker split.
 *
 * Tokens only (no hardcoded colors / radii / shadows, no 1px borders): the whole
 * face is `palette.primary` / `palette.background` / `palette.surfaceContainerHigh`
 * / `Shadow.ambient` / the Newsreader-italic numeral — all already resolved from
 * the passed palette, so dark mode (terracotta `#ffb4a3`, deep-cream fill) is
 * automatic.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, type LatLng } from 'react-native-maps';

import { Colors, Shadow } from '@/constants/theme';
import type { ClusterEntry } from './useClusteredPins';

type ClusterData = Extract<ClusterEntry, { type: 'cluster' }>;

/** Plate diameter grows in gentle bands so a big cluster reads heavier without a
 * second component: <10 · <50 · ≥50. */
function plateSize(count: number): number {
    return count < 10 ? 40 : count < 50 ? 44 : 48;
}

/** Display label — capped at "50+" so a 3-digit count never cramps the plate. */
function countLabel(count: number): string {
    return count >= 50 ? '50+' : String(count);
}

/** Numeral point size per band — the "50+" case shrinks to fit three glyphs. */
function numeralSize(count: number): number {
    return count >= 50 ? 15 : count < 10 ? 18 : 16;
}

export function ClusterBubble({ count, palette }: { count: number; palette: typeof Colors.light }) {
    const isDark = palette !== Colors.light;
    const size = plateSize(count);
    // The same fill the pins use: warm cream page (light) / deeper cream (dark).
    const fill = isDark ? palette.surfaceContainerHigh : palette.background;

    return (
        <View style={styles.wrap}>
            <View
                style={[
                    styles.plate,
                    Shadow.ambient,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: fill,
                        borderColor: palette.primary,
                    },
                ]}
            >
                <Text
                    style={[styles.count, { fontSize: numeralSize(count), color: palette.primary }]}
                    numberOfLines={1}
                >
                    {countLabel(count)}
                </Text>
            </View>
            {/* Tail — the same terracotta triangle as BubblePin; tip = coordinate. */}
            <View style={[styles.tail, { borderTopColor: palette.primary }]} />
        </View>
    );
}

interface ClusterMarkerProps {
    entry: ClusterData;
    palette: typeof Colors.light;
    onPress: () => void;
}

/**
 * The `<Marker>` wrapper. Owns a timed `tracksViewChanges` window — armed on
 * mount and whenever the count changes, then dropped to false after ~400ms (the
 * numeral renders synchronously; there's no avatar bitmap to await). Leaving it
 * true is exactly the "500 custom-view markers jank" this ticket exists to
 * prevent; mirrors WishlistMarker / AtlasMapView's PinMarker.
 *
 * `stopPropagation` is essential: without it the tap bubbles to the MapView's
 * onPress (which clears the selection) — a cluster tap must ONLY zoom, never
 * touch the peek/selection.
 */
export function ClusterMarker({ entry, palette, onPress }: ClusterMarkerProps) {
    const coordinate: LatLng = { latitude: entry.lat, longitude: entry.lng };
    const [tracking, setTracking] = useState(true);
    useEffect(() => {
        setTracking(true);
        const t = setTimeout(() => setTracking(false), 400);
        return () => clearTimeout(t);
    }, [entry.count]);

    return (
        <Marker
            coordinate={coordinate}
            // Bottom-center anchor (tail tip = coordinate), same as BubblePin.
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracking}
            stopPropagation
            onPress={onPress}
        >
            <ClusterBubble count={entry.count} palette={palette} />
        </Marker>
    );
}

const styles = StyleSheet.create({
    // Headroom so the tail + ambient shadow stay inside the snapshot bounds
    // (react-native-maps rasterizes the marker view). Anchor {0.5, 1} = tail tip.
    wrap: { width: 72, alignItems: 'center', paddingTop: 8 },
    plate: {
        alignItems: 'center',
        justifyContent: 'center',
        // Terracotta ring, saved-pin weight — no 1px hard border anywhere.
        borderWidth: 2.5,
    },
    // Brand rating-numeral treatment — Newsreader italic, terracotta.
    count: {
        fontFamily: 'Newsreader_500Medium_Italic',
        includeFontPadding: false,
        textAlign: 'center',
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
