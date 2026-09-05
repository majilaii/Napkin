import { compareVisitRecords } from '@/lib/visitDates';
/**
 * Restaurant photo resolvers — shared owners for tile and detail-masthead photos.
 *
 * Priority chain (highest to lowest):
 *   1. custom_photo_url     — chosen-memory / custom per-slot photo (the owner's OWN
 *                             shot). ALWAYS wins; never carries the Places wash.
 *   2. primary_photo_url    — stored in `restaurants.photo_url` (mirrored from Places).
 *                             See the two-path contract below.
 *   3. ghost                — cream tile + serif initial fallback (typographic plate).
 *
 * ── TICKET-157: the gated Places tier + backward-compatible contract ─────────────
 * `primary_photo_url` resolves down ONE of two paths, discriminated by whether the
 * caller supplied `places_hero_enabled` (NOT `photo_source` — see [ARCH-REVIEW B1]):
 *
 *   • LEGACY path — `places_hero_enabled === undefined`: return `primary_photo_url`
 *     UNCONDITIONALLY (`isPlaces: false`, never washed). This preserves pre-157
 *     behaviour byte-for-byte for the caller that passes neither new input.
 *   • GATED path — `places_hero_enabled` is a boolean (render surfaces always pass
 *     the build-time flag constant): return the photo (`isPlaces: true`) ONLY when
 *     `places_hero_enabled === true && photo_source === 'places'`. Anything else on
 *     the gated path (flag off, or `photo_source` missing/non-'places') falls through
 *     to the ghost/typographic tier. Gating on `photo_source === 'places'` (never on
 *     `photo_url != null`) mirrors RestaurantHero's invariant, so a future non-Places
 *     writer of `photo_url` can't leak an un-washed, un-attributed photo onto a plate.
 *     It also means a payload cached before the edge redeploy (no `photo_source`) is
 *     `!== 'places'` → falls to typographic rather than leaking an un-washed photo.
 *
 * The three callers:
 *   • TableTopFourGrid (`FilledTile`)  — RENDER surface: passes `photo_source` +
 *     `places_hero_enabled` → gated path, wash when `isPlaces`.
 *   • TopFour (`MarqueePlate`)         — RENDER surface: same, gated path.
 *   • EditTop4Sheet (`DraftTile`)      — DRAFT surface: passes NEITHER new input →
 *     legacy path, byte-preserved. Any change to that behaviour is a review-fail.
 *
 * Note: the edge function returns a resolved `photo_url` (not a Places photo
 * reference), so there is no proxy step here — persisted rows are never fetched
 * through `places-photo` at render time.
 */

import type {
    PublicReviewCard,
    RestaurantPageData,
    RestaurantPageRestaurant,
    SelfLogRow,
} from '@/hooks/restaurants/useRestaurantPage';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

export type TilePhotoResult =
    | { kind: 'url'; url: string; isPlaces: boolean }
    | { kind: 'ghost'; initial: string };

interface ResolveTilePhotoInput {
    custom_photo_url?: string | null;
    primary_photo_url?: string | null;
    restaurant_name?: string | null;
    /**
     * TICKET-157: `restaurants.photo_source`. Only consulted on the gated path.
     * The Places tier fires only when this is exactly `'places'`.
     */
    photo_source?: string | null;
    /**
     * TICKET-157: the render caller's `FRIEND_TEST.topFourPlacesHero` value.
     * `undefined` (caller omitted it) ⇒ LEGACY path (unconditional photo, no wash).
     * A boolean ⇒ GATED path. This is the discriminator ([ARCH-REVIEW B1]).
     */
    places_hero_enabled?: boolean;
}

export function resolveTilePhoto(input: ResolveTilePhotoInput): TilePhotoResult {
    // Tier 1: chosen-memory / custom photo — the owner's own shot. Always wins,
    // on BOTH paths, and is never marked isPlaces (never washed).
    if (input.custom_photo_url) {
        return { kind: 'url', url: input.custom_photo_url, isPlaces: false };
    }

    // Tier 2: the mirrored primary photo (`restaurants.photo_url`).
    if (input.primary_photo_url) {
        if (input.places_hero_enabled === undefined) {
            // LEGACY path (EditTop4Sheet): unconditional photo, never washed.
            return { kind: 'url', url: input.primary_photo_url, isPlaces: false };
        }
        // GATED path (render surfaces): Places tier only when the flag is on AND
        // the photo is genuinely a Places hero. Otherwise fall through to ghost.
        if (input.places_hero_enabled && input.photo_source === 'places') {
            return { kind: 'url', url: input.primary_photo_url, isPlaces: true };
        }
    }

    // Ghost fallback: first letter of restaurant name, or '?'
    const initial = (input.restaurant_name ?? '?').trim().charAt(0).toUpperCase() || '?';
    return { kind: 'ghost', initial };
}

export const MAX_MASTHEAD_PHOTOS = 4;

export type MastheadPhoto = {
    kind: 'entry' | 'clip' | 'places';
    url: string;
    entryId: string | null;
    /** Compact provenance chip. Clip thumbnails intentionally add no new copy. */
    label: string | null;
    /** Plain text only; provider HTML is never returned to the view. */
    attribution: string | null;
};

type MastheadPageData = {
    restaurant?: RestaurantPageRestaurant | null;
    self_log?: SelfLogRow[];
    photos?: RestaurantPageData['photos'];
    public_reviews?: PublicReviewCard[];
};

type MastheadClipping = {
    thumb_url?: string | null;
};

export type MastheadClippingState = {
    clippings: readonly MastheadClipping[];
    settled: boolean;
};

function normalizeUrl(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

function possessivePhotoLabel(displayName: string | null | undefined): string {
    const firstName = displayName?.trim().split(/\s+/u)[0]?.toLocaleLowerCase();
    return firstName ? `${firstName}'s photo` : 'photo';
}

/**
 * Owns the restaurant-detail masthead chain:
 * entry photos -> stored clipping thumbnail -> attributed Places hero -> none.
 *
 * Clippings intentionally remain a second argument because their independent query
 * resolves after the core page. Calling this again with the landed rows upgrades a
 * Places/typographic masthead without allowing a clip to displace an entry photo.
 */
export function resolveMastheadPhotos(
    page: MastheadPageData | null | undefined,
    { clippings, settled }: MastheadClippingState,
): MastheadPhoto[] {
    const entryPhotos: MastheadPhoto[] = [];
    const seen = new Set<string>();
    const addEntry = (
        urlValue: string | null | undefined,
        label: string,
        entryIdValue: string | null | undefined,
    ) => {
        const url = normalizeUrl(urlValue);
        if (!url || seen.has(url) || entryPhotos.length >= MAX_MASTHEAD_PHOTOS) return;
        seen.add(url);
        entryPhotos.push({
            kind: 'entry',
            url,
            entryId: entryIdValue?.trim() || null,
            label,
            attribution: null,
        });
    };

    const selfLog = [...(page?.self_log ?? [])].sort(compareVisitRecords);
    for (const row of selfLog) {
        for (const photo of row.photos) addEntry(photo.url, 'your photo', row.entry_id);
    }
    for (const photo of page?.photos?.from_your_table ?? []) {
        addEntry(
            photo.url,
            photo.is_self ? 'your photo' : 'table photo',
            photo.entry_id,
        );
    }
    for (const photo of page?.photos?.from_others ?? []) {
        addEntry(photo.url, photo.is_self
            ? 'your photo'
            : possessivePhotoLabel(photo.author_display_name), photo.entry_id);
    }
    for (const review of page?.public_reviews ?? []) {
        addEntry(
            review.photo_url,
            possessivePhotoLabel(review.display_name),
            review.entry_id,
        );
    }

    if (entryPhotos.length > 0) return entryPhotos;

    if (settled) {
        for (const clipping of clippings) {
            const url = normalizeUrl(clipping.thumb_url);
            if (url) {
                return [{ kind: 'clip', url, entryId: null, label: null, attribution: null }];
            }
        }
    }

    const restaurant = page?.restaurant;
    const placesPhoto = resolveSourcedPhoto({
        url: restaurant?.photo_url,
        photoSource: restaurant?.photo_source,
        attributionHtml: restaurant?.places_photo_attribution_html,
        restaurantName: restaurant?.name,
    });
    if (placesPhoto.url && placesPhoto.isPlaces && placesPhoto.credit) {
        return [{
            kind: 'places',
            url: placesPhoto.url,
            entryId: null,
            label: 'via google',
            attribution: placesPhoto.credit.redundant ? null : placesPhoto.credit.label,
        }];
    }

    return [];
}
