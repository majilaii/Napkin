/** Missing coordinates stay missing; never substitute the viewer's city or 0,0. */
export function restaurantMapCoordinate(lat: unknown, lng: unknown) {
    if (
        typeof lat !== 'number' || typeof lng !== 'number'
        || !Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180
    ) return null;
    return { latitude: lat, longitude: lng };
}

/** Prefer the venue's own map link, then its precise pin, then its address. */
export function restaurantDirectionsUrl(restaurant: {
    google_maps_uri?: string | null;
    name: string;
    city?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
}): string {
    const supplied = restaurant.google_maps_uri?.trim();
    if (supplied) return supplied;
    const coordinate = restaurantMapCoordinate(restaurant.lat, restaurant.lng);
    const query = coordinate
        ? `${coordinate.latitude},${coordinate.longitude}`
        : [restaurant.name, restaurant.address, restaurant.city].filter(Boolean).join(' ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
