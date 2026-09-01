/**
 * useRestaurantPage — aggregated hook for the restaurant detail page (v3).
 *
 * Calls restaurant-history?action=page, which returns the full page data
 * in one round-trip: restaurant row, personal avg, Table chip, Who's-been,
 * visits feed, distributions, photos, place_details, footnote fields.
 *
 * Also exports `restaurantFromPlace` — synthesises the restaurant shape
 * from a Places search payload, used for ghost restaurants until the server
 * returns real data.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';
import { halfDistFromLegacy } from '@/lib/ratingBins';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RestaurantPageRestaurant = {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    cuisine: string | null;
    price_level: number | null;
    photo_url: string | null;
    google_rating: number | null;
    google_rating_count: number | null;
    external_id: string | null;
    // TICKET-057: photo provenance and Places attribution.
    // photo_source drives the warm-paper overlay and source-aware image gate.
    // 'none' = we tried Places, got no usable attribution — skip lazy backfill on re-visit.
    photo_source: 'user' | 'table' | 'places' | 'none' | null;
    places_photo_attribution_html: string | null;
    // TICKET-081: restaurant-page metadata (phone · directions · website · hours).
    // All nullable; each MetaActions affordance / the hours line renders only when
    // its datum is present. hours: { weekdayDescriptions[] }. No openNow — it's a
    // point-in-time flag and stale once cached (the page derives "today" by matching
    // the weekday name, never by array position; see lib/restaurantHours.ts).
    phone: string | null;
    website: string | null;
    google_maps_uri: string | null;
    hours: { weekdayDescriptions: string[] } | null;
    /** Google place types stored at upsert — tag-chip source ("fine dining"). */
    place_types?: string[] | null;
    // TICKET-081 fix-pass: durable Places-sync sentinel — gates the lazy backfill so
    // a place with no phone/hours stops re-hitting Place Details after one sync.
    places_synced_at: string | null;
    // TICKET-149: direct booking-page URL resolved server-side from the venue's
    // website (Reserve pill). checked_at gates the lazy resolve the same way
    // places_synced_at gates the metadata backfill.
    reserve_url: string | null;
    reserve_url_checked_at: string | null;
};

export type PageVisit = {
    kind: 'round' | 'solo';
    id: string;
    entry_id?: string;
    table_night_id?: string;
    user_id?: string;
    avatar_url?: string | null;
    rating: number | null;
    date: string;
    user_display_names: string[];
    note?: string | null;
    is_self?: boolean;
    is_tablemate?: boolean;
};

export type WhosBeenEntry = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    personal_average: number;
    visit_count: number;
};

export type Calibration = {
    match_pct: number;    // 0–100, integer
    mae: number;          // mean absolute error, 0–5 scale
    overlap_n: number;    // count of shared rated restaurants
    fallback: boolean;    // true iff MAE-fallback fired (Pearson was NULL)
};

export type PublicReviewCard = {
    entry_id: string;
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    rating: number;
    note_excerpt: string;
    photo_url: string | null;
    created_at: string;
    public_reaction_count: number;
    public_reply_count: number;
    calibration: Calibration | null;
    /** Letterboxd "from people you follow" — viewer follows this author. */
    is_followee?: boolean;
};

export type SelfLogRow = {
    id: string;
    entry_id: string | null;
    table_night_id: string | null;
    source: 'solo' | 'supper';
    rating: number | null;
    note: string | null;
    visited_at: string;
    companions: string[];
    photos: { id: string; url: string }[];
};

export type TableNoteRow = {
    entry_id: string;
    table_id: string;
    table_name: string;
    author: {
        user_id: string;
        display_name: string;
        avatar_url: string | null;
    };
    rating: number | null;
    note: string;
    visited_at: string;
};

export type PhotoItem = {
    url: string;
    author_display_name: string;
    author_handle: string;
    is_tablemate: boolean;
    is_self: boolean;
    entry_id: string;
};

export type PlaceDetails = {
    hours_today: string | null;
    open_now: boolean | null;
    hours_week: { day_range: string; range: string }[] | null;
    website: string | null;
    phone: string | null;
    menu_url: string | null;
    lat: number | null;
    lng: number | null;
};

// TICKET-026: Professional critic review type
export type ProfessionalCritic = {
    id: string;
    publication: 'nyt' | 'infatuation' | 'eater' | string;  // enum-loose
    kind: 'stars' | 'score' | 'essential' | 'feature';
    score: string | null;
    score_out_of: string | null;
    author: string | null;
    published_date: string | null;  // 'YYYY-MM-DD' ISO
    excerpt: string | null;          // server-blanked when scrape_confidence < 70
    source_url: string | null;
};

export type RestaurantPageData = {
    restaurant: RestaurantPageRestaurant | null;
    personal: {
        average: number | null;
        visit_count: number;
        last_visit?: { date: string; rating: number | null } | null;
    };
    table_chip: {
        table_id: string;
        table_name: string;
        average: number;
        visit_count: number;
        member_count?: number;
    } | null;
    whos_been: WhosBeenEntry[];
    visits: PageVisit[];
    visit_count: number;
    public_reviews: PublicReviewCard[];
    public_reviews_total: number;
    self_log: SelfLogRow[];
    table_notes: TableNoteRow[];
    /** Reserved for TICKET-221; absent today, so the regular row stays hidden. */
    regular?: string | null;
    // v3 additions
    distributions: {
        you: number[];          // [1★ count, 2★, 3★, 4★, 5★] — LEGACY, frozen
        your_table: number[] | null;
        napkin: number[];
    };
    // TICKET-154: 10 half-star bins [0.5, 1.0, …, 5.0] — the histogram truth.
    // Synthesized from the legacy buckets when the server predates the field.
    distributions_half: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    napkin_aggregate: {
        average: number | null;
        count: number;
    };
    photos: {
        from_your_table: PhotoItem[];
        from_others: PhotoItem[];
    };
    place_details: PlaceDetails;
    tables_count_with_logs: number;
    first_logged_at_by_your_table: string | null;
    // TICKET-026: professional critics
    professional_critics: ProfessionalCritic[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function fetchRestaurantPage(
    restaurantId: string,
    tableId?: string,
): Promise<RestaurantPageData> {
    const data = await callEdgeFn<RestaurantPageData>('restaurant-history', {
        method: 'GET',
        action: 'page',
        params: {
            restaurant_id: restaurantId,
            table_id: tableId,
        },
    });

    // Back-fill additive fields for older edge function responses (graceful degradation)
    // TICKET-057: back-fill attribution fields for responses before migration.
    if (data.restaurant && data.restaurant.photo_source === undefined) {
        (data.restaurant as any).photo_source = null;
    }
    if (data.restaurant && data.restaurant.places_photo_attribution_html === undefined) {
        (data.restaurant as any).places_photo_attribution_html = null;
    }
    // TICKET-081: back-fill metadata fields for responses predating the column add.
    if (data.restaurant) {
        const r = data.restaurant as any;
        if (r.phone === undefined) r.phone = null;
        if (r.website === undefined) r.website = null;
        if (r.google_maps_uri === undefined) r.google_maps_uri = null;
        if (r.hours === undefined) r.hours = null;
        if (r.places_synced_at === undefined) r.places_synced_at = null;
        // TICKET-149: back-fill reserve fields for responses predating the column add.
        if (r.reserve_url === undefined) r.reserve_url = null;
        if (r.reserve_url_checked_at === undefined) r.reserve_url_checked_at = null;
    }
    if (!data.distributions) {
        data.distributions = { you: [0,0,0,0,0], your_table: null, napkin: [0,0,0,0,0] };
    }
    // TICKET-154: synthesize half-star bins from legacy whole-star buckets for
    // responses predating distributions_half (counts land on whole-star bins).
    if (!data.distributions_half) {
        data.distributions_half = {
            you: halfDistFromLegacy(data.distributions.you),
            your_table: data.distributions.your_table
                ? halfDistFromLegacy(data.distributions.your_table)
                : null,
            napkin: halfDistFromLegacy(data.distributions.napkin),
        };
    }
    if (!data.napkin_aggregate) {
        data.napkin_aggregate = { average: null, count: 0 };
    }
    if (!data.photos) {
        data.photos = { from_your_table: [], from_others: [] };
    }
    if (!data.place_details) {
        data.place_details = { hours_today: null, open_now: null, hours_week: null, website: null, phone: null, menu_url: null, lat: null, lng: null };
    }
    if (data.tables_count_with_logs == null) data.tables_count_with_logs = 0;
    if (data.first_logged_at_by_your_table == null) data.first_logged_at_by_your_table = null;
    // TICKET-026: graceful degradation for older edge function responses
    if (!data.professional_critics) data.professional_critics = [];
    if (!data.self_log) data.self_log = [];
    if (!data.table_notes) data.table_notes = [];

    return data;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches full restaurant page data (v3).
 *
 * @param restaurantId  Napkin UUID or Google Place ID (external_id). Required.
 * @param tableId       Optional — biases the Table chip to this table.
 */
export function useRestaurantPage(
    restaurantId: string | null | undefined,
    tableId?: string | null,
) {
    return useQuery({
        queryKey: queryKeys.restaurants.page(restaurantId ?? '', tableId ?? undefined),
        queryFn: () => fetchRestaurantPage(restaurantId!, tableId ?? undefined),
        enabled: !!restaurantId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Ghost synthesis helper ────────────────────────────────────────────────────

/**
 * Synthesises a RestaurantPageRestaurant from a Places search payload.
 * Used to render the hero immediately for ghost restaurants before the
 * server fetch returns (or when the restaurant isn't yet in the DB).
 *
 * TICKET-057: accepts photoAttributionHtml from the search result to populate
 * photo_source and places_photo_attribution_html on the ghost render so
 * RestaurantHero can show the warm-paper overlay and source-gate the image
 * immediately — before the lazy server upsert resolves.
 */
export function restaurantFromPlace(
    place: RestaurantPayload & {
        formattedAddress?: string;
        city?: string;
        country?: string;
        googleRating?: number;
        googleRatingCount?: number;
        priceLevel?: number;
        cuisine?: string;
        photoReference?: string;
        photoAttributionHtml?: string | null;
        // TICKET-081: metadata may ride along on a Places lookup payload.
        phone?: string | null;
        website?: string | null;
        google_maps_uri?: string | null;
        link?: string | null;
        hours?: { weekdayDescriptions: string[] } | null;
        name: string;
        external_id: string;
    },
): RestaurantPageRestaurant {
    // TICKET-057 ghost-path synthesis (§2 ghost-render path trace, step 3):
    // - photoReference + non-empty attribution → photo_source 'places', proxy URL, attribution.
    // - photoReference but no attribution → photo_source 'none', no photo (AC 12: no Places
    //   photo without credit, even on ghost render). Falls through to invitation hero.
    // - neither → all null (no photo at all).
    const hasAttribution = !!(place.photoAttributionHtml && place.photoAttributionHtml.trim());
    const hasPhotoRef = !!place.photoReference;

    let photoUrl: string | null = null;
    let photoSource: RestaurantPageRestaurant['photo_source'] = null;
    let attributionHtml: string | null = null;

    if (hasPhotoRef && hasAttribution) {
        photoUrl = placesPhotoProxyUrl(place.photoReference) ?? null;
        photoSource = 'places';
        attributionHtml = place.photoAttributionHtml!;
    } else if (hasPhotoRef && !hasAttribution) {
        // No attribution → sentinel. Hero falls to invitation state.
        photoUrl = null;
        photoSource = 'none';
        attributionHtml = null;
    }
    // else: neither → all null.

    return {
        id: '', // not yet persisted
        name: place.name,
        address: place.formattedAddress ?? place.location?.address ?? null,
        city: place.city ?? place.location?.locality ?? null,
        country: place.country ?? place.location?.country ?? null,
        cuisine: place.cuisine ?? null,
        price_level: place.priceLevel ?? null,
        photo_url: photoUrl,
        google_rating: place.googleRating ?? null,
        google_rating_count: place.googleRatingCount ?? null,
        external_id: place.external_id,
        photo_source: photoSource,
        places_photo_attribution_html: attributionHtml,
        // TICKET-081: surface metadata on the ghost render when the payload carries it.
        phone: place.phone ?? null,
        website: place.website ?? null,
        google_maps_uri: place.google_maps_uri ?? place.link ?? null,
        hours: place.hours ?? null,
        place_types: (place as any).categories ?? place.types ?? null,
        // A ghost is not yet persisted/synced — null sentinel (no backfill gating uses
        // this on the ghost path; the page only backfills persisted rows).
        places_synced_at: null,
        // TICKET-149: never resolved for ghosts — the page falls back to the
        // client-side tier-0 check (website itself being a booking page).
        reserve_url: null,
        reserve_url_checked_at: null,
    };
}
