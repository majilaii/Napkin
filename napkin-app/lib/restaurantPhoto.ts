/**
 * Restaurant photo resolver — shared helper for rendering restaurant tile photos.
 *
 * Priority chain (highest to lowest):
 *   1. custom_photo_url     — explicitly set per-slot (e.g. future custom-photo picker)
 *   2. primary_photo_url    — stored in `restaurants.photo_url` (mirrored from Places)
 *   3. ghost                — cream tile + serif initial fallback
 *
 * Note: the edge function returns a resolved `photo_url` (not a Places photo reference),
 * so there is no need for a places_photo_ref → proxy step here. If a direct proxy URL
 * path is needed in future, add it back then.
 *
 * Used by TableTopFourGrid and any future restaurant-tile surfaces.
 */

export type TilePhotoResult =
    | { kind: 'url'; url: string }
    | { kind: 'ghost'; initial: string };

interface ResolveTilePhotoInput {
    custom_photo_url?: string | null;
    primary_photo_url?: string | null;
    restaurant_name?: string | null;
}

export function resolveTilePhoto(input: ResolveTilePhotoInput): TilePhotoResult {
    if (input.custom_photo_url) {
        return { kind: 'url', url: input.custom_photo_url };
    }
    if (input.primary_photo_url) {
        return { kind: 'url', url: input.primary_photo_url };
    }
    // Ghost fallback: first letter of restaurant name, or '?'
    const initial = (input.restaurant_name ?? '?').trim().charAt(0).toUpperCase() || '?';
    return { kind: 'ghost', initial };
}
