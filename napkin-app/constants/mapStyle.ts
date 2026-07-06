/**
 * mapStyle — Heirloom Journal map skin for Google Maps (Android only).
 *
 * Apple Maps (iOS, PROVIDER_DEFAULT) ignores customMapStyle — it's Google-only —
 * so iOS uses `mapType="mutedStandard"` instead (see WishlistMapView). This JSON
 * warms the Google raster toward our warm-paper palette: cream ground, desaturated
 * water, POI labels off, muted roads.
 *
 * Every color is derived from `constants/theme.ts` (commented inline) so the map
 * stays aligned with the palette — do NOT hand-pick new hues here.
 */

import type { MapStyleElement } from 'react-native-maps';
import { Colors } from './theme';

const P = Colors.light;

// Google Maps style JSON. Each `color` traces back to a theme token; where Google
// needs a shade the palette doesn't name, we note the token it's derived from.
export const heirloomMapStyle: MapStyleElement[] = [
    // Base geometry — warm cream page (= theme `background` #fdf6ec).
    { elementType: 'geometry', stylers: [{ color: P.background }] },
    // Labels: warm taupe ink (= `textMuted` #8a726c) with a cream halo (`surface`).
    { elementType: 'labels.text.fill', stylers: [{ color: P.textMuted }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: P.surface }] },
    // Kill administrative borders — no 1px sectioning lines (brand rule).
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    // POI labels + icons OFF — matches showsPointsOfInterest={false} on iOS so the
    // map is our spots only, not Google's clutter.
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    // Parks read as a quiet olive-cream (= `secondaryContainer` #e0e5cc).
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: P.secondaryContainer }] },
    // Landscape = the amber-vellum layer (= `surfaceContainer` #f6ecdb) so it sits
    // just off the page ground.
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: P.surfaceContainer }] },
    // Roads: deeper cream fill (= `surfaceContainerHigh` #efe2ce) with a soft warm
    // rule (= `outlineVariant` #ddc0ba) — no hard road outlines, labels muted.
    { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: P.surfaceContainerHigh }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: P.outlineVariant }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
    { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    // Water — desaturated cool taupe (= `outlineVariant` #ddc0ba) so it reads as
    // water without the default saturated blue fighting the warm ground.
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: P.outlineVariant }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: P.textMuted }] },
];

export default heirloomMapStyle;
