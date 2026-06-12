/**
 * useMySoloEntries — viewer's own feed-only solo entries.
 *
 * TICKET-043: switched from direct `.from('entries').is('table_id', null)` to
 * `fn_my_solo_entries` RPC. Reason: the column-level REVOKE in migration
 * 20260509000005 removes authenticated's SELECT right on entries.table_id, so
 * PostgREST can no longer filter on it. fn_my_solo_entries is SECURITY DEFINER
 * and includes an auth.uid() check so callers cannot read another user's entries.
 *
 * The RPC returns flat rows (no nested joins). Restaurants and profiles are
 * fetched in a second query and merged in-memory.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';

interface SoloEntryRpcRow {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string | null;
    created_at: string;
    photo_url: string | null;
    liked: boolean | null;
}

async function fetchMySoloEntries(userId: string): Promise<SoloShareActivity[]> {
    // TICKET-043: fn_my_solo_entries uses SECURITY DEFINER to bypass the
    // column-level revoke on entries.table_id. Includes auth.uid() == p_user_id guard.
    const { data: rpcData, error } = await supabase
        .rpc('fn_my_solo_entries', { p_user_id: userId, p_limit: 50 });

    if (error) throw error;

    const rows = (rpcData ?? []) as SoloEntryRpcRow[];
    if (rows.length === 0) return [];

    // Batch-fetch restaurants and the user's profile.
    const restaurantIds = [...new Set(rows.map(r => r.restaurant_id).filter(Boolean))] as string[];

    const [restaurantsRes, profileRes] = await Promise.all([
        restaurantIds.length > 0
            ? supabase
                .from('restaurants')
                .select('id, name, address, city, photo_url')
                .in('id', restaurantIds)
            : Promise.resolve({ data: [], error: null }),
        supabase
            .from('profiles')
            .select('display_name')
            .eq('user_id', userId)
            .maybeSingle(),
    ]);

    const restaurantMap = new Map(
        ((restaurantsRes.data ?? []) as any[]).map((r: any) => [r.id, r])
    );
    const displayName = (profileRes.data as any)?.display_name ?? '';

    return rows.map((r): SoloShareActivity => ({
        type: 'solo_share',
        id: r.id,
        user_id: r.user_id,
        restaurant_id: r.restaurant_id,
        rating: r.rating,
        content: r.content,
        dish_description: r.dish_description,
        liked: r.liked ?? false,
        visited_at: r.visited_at ?? r.created_at,
        created_at: r.created_at,
        sort_date: r.visited_at ?? r.created_at,
        photo_url: r.photo_url,
        restaurants: r.restaurant_id ? (restaurantMap.get(r.restaurant_id) ?? null) : null,
        profiles: { display_name: displayName },
    }));
}

export function useMySoloEntries(userId: string | undefined) {
    return useQuery({
        queryKey: userId ? queryKeys.entries.mySolo(userId) : ['entries', 'mySolo', 'anon'],
        queryFn: () => fetchMySoloEntries(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
    });
}
