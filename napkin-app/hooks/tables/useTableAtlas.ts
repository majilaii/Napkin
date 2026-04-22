/**
 * useTableAtlas — city-index query for the Atlas sub-tab.
 *
 * Returns the stat line (members, cities, spots, founded_at) and the
 * list of cities that the Table has visited, ordered by most-recent visit.
 *
 * Calls: POST table-atlas { action: 'city-index', table_id }
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AtlasCityRow = {
    name: string;
    spot_count: number;
    member_count: number;
    last_visit_at: string;
    hero_photo_url: string | null;
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
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('table-atlas', {
        body: { action: 'city-index', table_id: tableId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data as TableAtlasData;
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
