import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';
import {
    dedupePlacesCredits,
    resolveSourcedPhoto,
    type PlacesPhotoCredit,
    type ResolvedSourcedPhoto,
} from '@/components/ui/PlacesCredit';

/**
 * Search ghosts remain text-only. Persisted rows cross the same provenance
 * boundary as every other restaurant-photo surface: ambiguous and unattributed
 * Places URLs fail closed, while user/Table photos render without credit chrome.
 */
export function resolveSearchResultPhoto(row: SearchResultRow): ResolvedSourcedPhoto {
    if (!row.id) return { url: null, credit: null, isPlaces: false };
    return resolveSourcedPhoto({
        url: row.photoUrl,
        photoSource: row.photoSource,
        attributionHtml: row.photoAttributionHtml,
        restaurantName: row.name,
    });
}

/** URI-bound key so a late failure cannot suppress a replacement thumbnail. */
export function searchPhotoFailureKey(
    row: SearchResultRow,
    photoUrl: string | null | undefined = resolveSearchResultPhoto(row).url,
): string | null {
    if (!photoUrl) return null;
    return `${row.id ?? row.placeId ?? row.name}:${photoUrl}`;
}

/** Resolve the exact image/credit pair still eligible to render on a surface. */
export function resolveVisibleSearchResultPhoto(
    row: SearchResultRow,
    failedPhotoKeys: ReadonlySet<string>,
): ResolvedSourcedPhoto {
    const photo = resolveSearchResultPhoto(row);
    const failureKey = searchPhotoFailureKey(row, photo.url);
    return failureKey && failedPhotoKeys.has(failureKey)
        ? { ...photo, url: null, credit: null }
        : photo;
}

export interface SearchPlacesCreditSummary {
    credits: PlacesPhotoCredit[];
    /** Safely rendered Places thumbnails before author dedupe. */
    photoCount: number;
}

/** One stable, deduped credit payload for the owning search/picker surface. */
export function deriveSearchPlacesCredits(
    rows: readonly SearchResultRow[],
    failedPhotoKeys: ReadonlySet<string> = new Set(),
): SearchPlacesCreditSummary {
    const renderedCredits = rows.flatMap((row) => {
        const photo = resolveVisibleSearchResultPhoto(row, failedPhotoKeys);
        return photo.url && photo.credit ? [photo.credit] : [];
    });
    return {
        credits: dedupePlacesCredits(renderedCredits),
        photoCount: renderedCredits.length,
    };
}
