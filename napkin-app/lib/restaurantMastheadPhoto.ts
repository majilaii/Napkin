import {
    resolveSourcedPhoto,
    type PlacesPhotoCredit,
} from '@/components/ui/PlacesCredit';

export type RestaurantMastheadPhoto = {
    url: string;
    source: 'entry' | 'clip' | 'places';
    credit: PlacesPhotoCredit | null;
    placesWash: boolean;
};

type EntryPhotoCandidate = {
    url: string | null | undefined;
    is_self: boolean;
};

type ClipPhotoCandidate = {
    thumb_url: string | null | undefined;
    source?: { type?: string | null } | null;
};

type RestaurantPhotoCandidate = {
    name: string;
    photo_url: string | null | undefined;
    photo_source: string | null | undefined;
    places_photo_attribution_html: string | null | undefined;
};

type ResolveRestaurantMastheadPhotoInput = {
    entryPhotos?: readonly EntryPhotoCandidate[] | null;
    clips?: readonly ClipPhotoCandidate[] | null;
    restaurant: RestaurantPhotoCandidate;
    failedUrls?: ReadonlySet<string>;
};

function usableUrl(
    value: string | null | undefined,
    failedUrls: ReadonlySet<string>,
): string | null {
    const url = value?.trim() || null;
    return url && !failedUrls.has(url) ? url : null;
}

/**
 * Select the restaurant masthead's single restrained image plate.
 *
 * Photos follow the product's imagery doctrine: the viewer's own entry memory,
 * then a durable clipping thumbnail, then an attributed Places venue photo.
 * Other diners' entry photos are never promoted into this personal masthead,
 * and Places fails closed through the shared source/credit boundary.
 */
export function resolveRestaurantMastheadPhoto({
    entryPhotos,
    clips,
    restaurant,
    failedUrls = new Set<string>(),
}: ResolveRestaurantMastheadPhotoInput): RestaurantMastheadPhoto | null {
    const ownEntryUrl = entryPhotos
        ?.filter((photo) => photo.is_self)
        .map((photo) => usableUrl(photo.url, failedUrls))
        .find((url): url is string => !!url);
    if (ownEntryUrl) {
        return {
            url: ownEntryUrl,
            source: 'entry',
            credit: null,
            placesWash: false,
        };
    }

    const clipUrl = clips
        ?.filter((clip) => clip.source?.type !== 'video')
        .map((clip) => usableUrl(clip.thumb_url, failedUrls))
        .find((url): url is string => !!url);
    if (clipUrl) {
        return {
            url: clipUrl,
            source: 'clip',
            credit: null,
            placesWash: false,
        };
    }

    const placesPhoto = resolveSourcedPhoto({
        url: restaurant.photo_url,
        photoSource: restaurant.photo_source,
        attributionHtml: restaurant.places_photo_attribution_html,
        restaurantName: restaurant.name,
    });
    const placesUrl = usableUrl(placesPhoto.url, failedUrls);
    if (!placesUrl || !placesPhoto.isPlaces || !placesPhoto.credit) return null;

    return {
        url: placesUrl,
        source: 'places',
        credit: placesPhoto.credit,
        placesWash: true,
    };
}
