/**
 * useTableAtlasCity — paginated city-page query for the Atlas city deep-dive.
 * TICKET-035: converted to cursor pagination via useCursorPagedQuery.
 *
 * Returns restaurant tiles for a specific city in the Table's Atlas,
 * including tile_type (solo/round/mixed), rating, wished_by_viewer, and visits.
 * Sorted by last_visit_date DESC, restaurant_id DESC.
 *
 * Consumers read city_stats from pages[0] and flatten tiles with flattenPages.
 *
 * Calls: POST table-atlas { action: 'city-page', table_id, city, cursor? }
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AtlasRoundParticipant = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
};

export type AtlasVisitRow =
    | {
          kind: 'round';
          id: string;
          user_id: string;
          display_name: string;
          avatar_url: string | null;
          rating: number | null;
          date: string;
          table_night_id: string;
          round_participants: AtlasRoundParticipant[];
      }
    | {
          kind: 'solo';
          id: string;
          user_id: string;
          display_name: string;
          avatar_url: string | null;
          rating: number | null;
          date: string;
          entry_id: string;
      };

export type AtlasRestaurantTile = {
    id: string;
    name: string;
    cuisine: string | null;
    photo_url: string | null;
    /** Optional for stale pages; unknown provenance suppresses the image. */
    photo_source?: 'places' | 'user' | 'table' | 'none' | null;
    places_photo_attribution_html?: string | null;
    lat: number | null;
    lng: number | null;
    rating: number | null;
    tile_type: 'solo' | 'round' | 'mixed';
    wished_by_viewer: boolean;
    companion_ids: string[];
    visits: AtlasVisitRow[];
    round_count: number;
    solo_count: number;
    member_ids: string[];
    member_names: string[];
    member_avatar_urls: (string | null)[];
};

export type AtlasCityStats = {
    city: string;
    spot_count: number;
    member_count: number;
};

/**
 * Wire shape from the edge function. Extends Page<AtlasRestaurantTile> with
 * city-level metadata (city, city_stats) that lives on every page but is most
 * useful from pages[0].
 */
export type AtlasCityPage = Page<AtlasRestaurantTile> & {
    city: string;
    city_stats: AtlasCityStats;
};

/**
 * Legacy flat shape used by AtlasCityPage component.
 * Built from the paginated data in the screen — not returned from the server directly.
 * Kept for component compatibility; `restaurants` = all flattened tiles.
 */
export type TableAtlasCityData = {
    city: string;
    city_stats: AtlasCityStats;
    restaurants: AtlasRestaurantTile[];
};

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchAtlasCityPage(
    tableId: string,
    city: string,
    cursor: string | null,
    _token: string | null,
): Promise<AtlasCityPage> {
    return callEdgeFn<AtlasCityPage>('table-atlas', {
        action: 'city-page',
        body: { table_id: tableId, city, cursor },
    });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTableAtlasCity(
    tableId: string | null | undefined,
    city: string | null | undefined,
) {
    return useCursorPagedQuery<AtlasRestaurantTile>({
        queryKey: queryKeys.atlas.city(tableId ?? '', city ?? ''),
        fetchPage: (cursor, token) => fetchAtlasCityPage(tableId!, city!, cursor, token) as Promise<Page<AtlasRestaurantTile>>,
        enabled: !!tableId && !!city,
        staleTime: 1000 * 60 * 5,
    });
}

/** Flatten all pages of tiles. */
export function flattenAtlasTiles(data: ReturnType<typeof useTableAtlasCity>['data']) {
    return flattenPages(data);
}
