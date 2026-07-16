import { JUNK_VENUE_TYPES } from '@/components/profile/tasteUtils';
import {
    resolveSourcedPhoto,
    type PlacesPhotoCredit,
} from '@/components/ui/PlacesCredit';
import type { PeekCardMediaCandidate } from '@/hooks/restaurants/usePeekCard';

export interface MapPeekThumbnail {
    url: string;
    isPlaces: boolean;
}

export interface ResolvedMapPeekMedia {
    thumbnail: MapPeekThumbnail;
    credit: PlacesPhotoCredit | null;
}

/** Humanized Places primary types are stored in `cuisine`; suppress structural junk. */
export function mapPeekCuisine(cuisine: string | null | undefined): string | null {
    const trimmed = cuisine?.trim() ?? '';
    if (!trimmed || JUNK_VENUE_TYPES.has(trimmed.toLowerCase())) return null;
    return trimmed;
}

/** Compact caption grammar: cuisine · price · neighbourhood/city. */
export function buildMapPeekMeta({
    cuisine,
    price,
    area,
}: {
    cuisine: string | null | undefined;
    price: string | null | undefined;
    area: string | null | undefined;
}): string {
    return [mapPeekCuisine(cuisine), price?.trim(), area?.trim()]
        .filter((value): value is string => !!value)
        .join(' · ');
}

/**
 * Resolve one server-ordered candidate at the render boundary. Entry and clip
 * thumbnails need no credit. Places fails closed unless its attribution parses.
 */
export function resolveMapPeekMedia(
    candidate: PeekCardMediaCandidate,
    restaurantName: string,
): ResolvedMapPeekMedia | null {
    const url = candidate.url?.trim();
    if (!url) return null;

    if (candidate.kind !== 'places') {
        return { thumbnail: { url, isPlaces: false }, credit: null };
    }

    const resolved = resolveSourcedPhoto({
        url,
        photoSource: candidate.photo_source,
        attributionHtml: candidate.attribution,
        restaurantName,
    });
    return resolved.url && resolved.credit
        ? {
            thumbnail: { url: resolved.url, isPlaces: true },
            credit: resolved.credit,
        }
        : null;
}
