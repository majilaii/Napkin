/**
 * useTableAtlasCity — city-page query for the Atlas city deep-dive.
 *
 * Returns restaurant tiles for a specific city in the Table's Atlas,
 * including tile_type (solo/round/mixed), rating, wished_by_viewer, and visits.
 *
 * Calls: POST table-atlas { action: 'city-page', table_id, city }
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AtlasVisitRow = {
    kind: 'round' | 'solo';
    id: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    rating: number | null;
    date: string;
    table_night_id?: string;
    entry_id?: string;
};

export type AtlasRestaurantTile = {
    id: string;
    name: string;
    cuisine: string | null;
    photo_url: string | null;
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

export type TableAtlasCityData = {
    city: string;
    city_stats: AtlasCityStats;
    restaurants: AtlasRestaurantTile[];
};

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchTableAtlasCity(
    tableId: string,
    city: string,
): Promise<TableAtlasCityData> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('table-atlas', {
        body: { action: 'city-page', table_id: tableId, city },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as TableAtlasCityData;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTableAtlasCity(
    tableId: string | null | undefined,
    city: string | null | undefined,
) {
    return useQuery({
        queryKey: queryKeys.atlas.city(tableId ?? '', city ?? ''),
        queryFn: () => fetchTableAtlasCity(tableId!, city!),
        enabled: !!tableId && !!city,
        staleTime: 1000 * 60 * 5,
    });
}
