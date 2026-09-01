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
        }));

    return { visited, onNapkin, morePlaces };
}
