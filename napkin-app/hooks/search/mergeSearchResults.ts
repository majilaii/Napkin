import type {
    PersistedSearchResult,
    PlacesResult,
} from './searchCache';
import type {
    SearchResultRow,
    SearchResults,
} from './useRestaurantSearch';

/**
 * Pure payload-to-row adapter. Keeping this outside the React hook makes the
 * provenance boundary regression-testable without importing native modules.
 */
export function mergeSearchResults(
    places: PlacesResult[],
    persisted: PersistedSearchResult,
): SearchResults {
    const placesById = new Map(places.map((place) => [place.id, place]));
    // Build the set of Google Place IDs already represented by persisted rows.
    const persistedExternalIds = new Set<string>();
    for (const row of persisted.visitedByMyTables) {
        if (row.external_id) persistedExternalIds.add(row.external_id);
    }
    for (const row of persisted.onNapkin) {
        if (row.external_id) persistedExternalIds.add(row.external_id);
    }

    const visited: SearchResultRow[] = persisted.visitedByMyTables.map((row) => ({
        id: row.id,
        placeId: row.external_id ?? undefined,
        name: row.name,
        city: row.city,
        cuisine: row.cuisine,
        address: row.address ?? null,
        photoUrl: row.photo_url,
        photoSource: row.photo_source ?? null,
        photoReference: null,
        photoAttributionHtml: row.places_photo_attribution_html ?? null,
        tier: 'visited',
        socialTag: `visited by ${row.table_name}`,
        mostRecentActivityAt: row.most_recent_activity_at,
        lat: row.lat ?? (row.external_id ? placesById.get(row.external_id)?.latitude : null) ?? null,
        lng: row.lng ?? (row.external_id ? placesById.get(row.external_id)?.longitude : null) ?? null,
        isPinned: row.is_pinned ?? false,
        friendsBeenCount: row.friends_been_count ?? 0,
        rating: row.rating ?? null,
        googleRating: row.external_id
            ? placesById.get(row.external_id)?.googleRating ?? row.google_rating ?? null
            : row.google_rating ?? null,
        priceLevel: row.external_id ? placesById.get(row.external_id)?.priceLevel ?? null : null,
    }));

    const onNapkin: SearchResultRow[] = persisted.onNapkin.map((row) => ({
        id: row.id,
        placeId: row.external_id ?? undefined,
        name: row.name,
        city: row.city,
        cuisine: row.cuisine,
        address: row.address ?? null,
        photoUrl: row.photo_url,
        photoSource: row.photo_source ?? null,
        photoReference: null,
        photoAttributionHtml: row.places_photo_attribution_html ?? null,
        tier: 'onNapkin',
        lat: row.lat ?? (row.external_id ? placesById.get(row.external_id)?.latitude : null) ?? null,
        lng: row.lng ?? (row.external_id ? placesById.get(row.external_id)?.longitude : null) ?? null,
        isPinned: row.is_pinned ?? false,
        friendsBeenCount: row.friends_been_count ?? 0,
        rating: row.rating ?? null,
        googleRating: row.external_id
            ? placesById.get(row.external_id)?.googleRating ?? row.google_rating ?? null
            : row.google_rating ?? null,
        priceLevel: row.external_id ? placesById.get(row.external_id)?.priceLevel ?? null : null,
    }));

    // Places-only rows intentionally remain text-only until persistence.
    const morePlaces: SearchResultRow[] = places
        .filter((place) => !persistedExternalIds.has(place.id))
        .map((place) => ({
            placeId: place.id,
            name: place.name ?? 'Unknown',
            city: place.city,
            cuisine: place.cuisine,
            address: place.formattedAddress,
            photoUrl: null,
            photoSource: null,
            photoReference: place.photoReference,
            photoAttributionHtml: place.photoAttributionHtml,
            tier: 'morePlaces',
            fartherAfield: place.fartherAfield === true,
            place,
            lat: place.latitude,
            lng: place.longitude,
            isPinned: false,
            friendsBeenCount: 0,
            rating: typeof place.googleRating === 'number'
                ? { tier: 'google', value: place.googleRating, scale: 5 }
                : null,
            googleRating: place.googleRating ?? null,
            priceLevel: place.priceLevel ?? null,
        }));

    return { visited, onNapkin, morePlaces };
}
