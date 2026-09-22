/**
 * Guest-safe projections for public-browse (TICKET-247).
 *
 * Kept out of index.ts (which calls serve() at import) so the rules are unit
 * tested in isolation.
 */

type PhotoFields = {
    photo_url?: unknown;
    photo_source?: unknown;
    places_photo_attribution_html?: unknown;
};

/**
 * Only a Places photo leaves this function. restaurants.photo_url is typed to
 * also carry a member's own meal photo (photo_source 'user' or 'table'), and a
 * Table photo must never reach a signed-out reader. The guest client renders
 * credited Places photos only, so dropping the rest changes nothing it shows.
 */
export function guestSafePhoto<T extends PhotoFields>(restaurant: T): T {
    if (restaurant.photo_source === 'places') return restaurant;
    return { ...restaurant, photo_url: null, places_photo_attribution_html: null };
}

export type GuestRestaurantRow = {
    id: string;
    name: string;
    city: string | null;
    country: string | null;
    address: string | null;
    cuisine: string | null;
    price_level: number | null;
    photo_url: string | null;
    photo_source: string | null;
    places_photo_attribution_html: string | null;
    google_rating: number | null;
    google_rating_count: number | null;
    review_count: number;
};

/** The list-row shape for search / recent. Explicit fields: nothing rides along. */
// deno-lint-ignore no-explicit-any
export function toGuestRow(r: any, reviewCount: number): GuestRestaurantRow {
    const safe = guestSafePhoto(r);
    return {
        id: r.id,
        name: r.name,
        city: r.city ?? null,
        country: r.country ?? null,
        address: r.address ?? null,
        cuisine: r.cuisine ?? null,
        price_level: r.price_level ?? null,
        photo_url: (safe.photo_url as string | null) ?? null,
        photo_source: r.photo_source ?? null,
        places_photo_attribution_html: (safe.places_photo_attribution_html as string | null) ?? null,
        google_rating: r.google_rating ?? null,
        google_rating_count: r.google_rating_count ?? null,
        review_count: reviewCount,
    };
}
