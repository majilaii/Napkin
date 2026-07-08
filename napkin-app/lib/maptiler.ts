/**
 * MapTiler raster tiles — the warm "paper object" map skin (TICKET-134).
 *
 * The `landscape` raster style renders cream land · butter roads · warm-brown
 * labels with no POI clutter on BOTH iOS and Android via a react-native-maps
 * `UrlTile` overlay — replacing the vellum-wash + heirloomMapStyle path on the
 * Map tab. Dark mode keeps these same cream tiles (the map reads as paper).
 *
 * The key below is a CLIENT-class MapTiler key: it is intentionally committed
 * (it ships in the app binary either way and is domain/referrer-scoped in the
 * MapTiler dashboard). This is NOT a secret leak.
 *
 * Later upgrade: a custom "Heirloom Cream" style in the MapTiler dashboard is a
 * one-line MAPTILER_STYLE swap here.
 */
export const MAPTILER_KEY = 'aPEg35JhkM1BCFcqQkR7';

/** Raster style id — verified live central-London z12–z15 with the founder's key. */
export const MAPTILER_STYLE = 'landscape';

/**
 * `UrlTile` template. The `@2x` endpoint returns 512px bitmaps for the 256
 * web-mercator grid — pair with `tileSize={512}` on the overlay for crisp
 * labels. `{z}/{x}/{y}` are filled by react-native-maps at render time.
 */
export function tileUrlTemplate(): string {
    return `https://api.maptiler.com/maps/${MAPTILER_STYLE}/256/{z}/{x}/{y}@2x.png?key=${MAPTILER_KEY}`;
}

/** ToS-required attribution — ghosted caption on the map. */
export const MAPTILER_ATTRIBUTION = '© MapTiler © OpenStreetMap';
