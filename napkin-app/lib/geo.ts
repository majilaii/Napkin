/**
 * geo — tiny distance helpers for "near me" sorting (wishlist, etc.).
 * No deps; pure functions so they're unit-testable.
 */

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_MI = 3958.8;

function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two coordinates (haversine). */
export function haversineMiles(a: LatLng, b: LatLng): number {
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.3 mi" under 10 miles (one decimal), "12 mi" at/above (integer). */
export function formatDistance(mi: number): string {
    if (!Number.isFinite(mi)) return '';
    if (mi < 0.1) return '< 0.1 mi';
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
}
