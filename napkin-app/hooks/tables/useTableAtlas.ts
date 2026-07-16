/**
 * useTableAtlas — city-index query for the Atlas sub-tab.
 *
 * Returns the stat line (members, cities, spots, founded_at) and the
 * list of cities that the Table has visited, ordered by most-recent visit.
 *
 * Calls: POST table-atlas { action: 'city-index', table_id }
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AtlasCityRow = {
    name: string;
    spot_count: number;
    member_count: number;
    last_visit_at: string;
    hero_photo_url: string | null;
    /** Optional while older cached/deployed payloads roll over; ambiguity fails closed. */
    hero_photo_source?: 'places' | 'user' | 'table' | 'none' | null;
    hero_places_photo_attribution_html?: string | null;
    /** Restaurant paired with the selected hero, for redundant-credit minimization. */
    hero_restaurant_name?: string | null;
};

export type AtlasStats = {
    members: number;
    cities: number;
    spots: number;
    founded_at: string | null;
};

export type TableAtlasData = {
    stats: AtlasStats;
    cities: AtlasCityRow[];
};

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchTableAtlas(tableId: string): Promise<TableAtlasData> {
    return callEdgeFn<TableAtlasData>('table-atlas', {
        action: 'city-index',
        body: { table_id: tableId },
    });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTableAtlas(tableId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.atlas.index(tableId ?? ''),
        queryFn: () => fetchTableAtlas(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
