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
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';
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
    hours_week: Array<{ day_range: string; range: string }> | null;
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
    // v3 additions
    distributions: {
        you: number[];          // [1★ count, 2★, 3★, 4★, 5★]
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

async function fetchRestaurantPage(
    restaurantId: string,
    tableId?: string,
): Promise<RestaurantPageData> {
    const params = new URLSearchParams({ action: 'page', restaurant_id: restaurantId });
    if (tableId) params.set('table_id', tableId);

    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const url = `${supabaseUrl}/functions/v1/restaurant-history?${params.toString()}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`restaurant-history failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    if (json.error) throw new Error(json.error);

    // Back-fill v3 fields for older edge function responses (graceful degradation)
    const data = json.data as RestaurantPageData;
    if (!data.distributions) {
        data.distributions = { you: [0,0,0,0,0], your_table: null, napkin: [0,0,0,0,0] };
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
        name: string;
        external_id: string;
    },
): RestaurantPageRestaurant {
    return {
        id: '', // not yet persisted
        name: place.name,
        address: place.formattedAddress ?? place.location?.address ?? null,
        city: place.city ?? place.location?.locality ?? null,
        country: place.country ?? place.location?.country ?? null,
        cuisine: place.cuisine ?? null,
        price_level: place.priceLevel ?? null,
        // Ghost photo: serve via places-photo edge proxy. Once the row is
        // upserted, _shared/restaurant.ts mirrors the bytes to Supabase
        // Storage and writes a permanent photo_url that supersedes this.
        photo_url: placesPhotoProxyUrl(place.photoReference) ?? null,
        google_rating: place.googleRating ?? null,
        google_rating_count: place.googleRatingCount ?? null,
        external_id: place.external_id,
    };
}
