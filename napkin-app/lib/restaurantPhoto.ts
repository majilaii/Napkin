/**
 * Restaurant photo resolver — shared helper for rendering restaurant tile photos.
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
