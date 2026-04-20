/**
 * useRestaurantPage — aggregated hook for the restaurant detail page.
 *
 * Calls restaurant-history?action=page, which returns the full page data
 * in one round-trip: restaurant row, personal avg, Table chip, Who's-been,
 * and visits feed (scoped to the viewer's Tables).
 *
 * Also exports `restaurantFromPlace` — synthesises the restaurant shape
 * from a Places search payload, used for ghost restaurants until the server
 * returns real data.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
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
};

export type WhosBeenEntry = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    personal_average: number;
    visit_count: number;
};

export type RestaurantPageData = {
    restaurant: RestaurantPageRestaurant | null;
    personal: { average: number | null; visit_count: number };
    table_chip: {
        table_id: string;
        table_name: string;
        average: number;
        visit_count: number;
    } | null;
    whos_been: WhosBeenEntry[];
    visits: PageVisit[];
    visit_count: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string> | undefined> {
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : undefined;
}

async function unwrapInvokeError(error: unknown): Promise<Error> {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
        try {
            const body = await ctx.json();
            if (body?.error) return new Error(body.error);
        } catch {
            // ignore
        }
    }
    return error instanceof Error ? error : new Error(String(error));
}

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
    return json.data;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches full restaurant page data.
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
        photo_url: null, // ghost photo served via photoReference separately
        google_rating: place.googleRating ?? null,
        google_rating_count: place.googleRatingCount ?? null,
        external_id: place.external_id,
    };
}
