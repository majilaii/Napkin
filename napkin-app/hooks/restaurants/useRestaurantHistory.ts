/**
 * Restaurant history hooks.
 *
 * useTableRestaurantHistory — accumulated Table memory at a restaurant.
 *   Used by:
 *     - "Previously here" banner on Round detail (table-scoped)
 *     - Delta chip on Round hero
 *     - /restaurant/[id] screen
 *
 * useUserRestaurantHistory — accumulated personal memory at a restaurant,
 *   cross-Table. The user's own history is theirs to see.
 *   Used by:
 *     - "Previously here" banner on Entry detail
 *
 * Backed by the `restaurant-history` edge function.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// Helper — mirrors the pattern in useTableNight.ts
async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
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
            // ignore — fall through
        }
    }
    return error instanceof Error ? error : new Error(String(error));
}

export type Visit = {
    kind: 'round' | 'solo';
    id: string;
    entry_id?: string;
    table_night_id?: string;
    rating: number | null;
    date: string; // ISO string
    user_display_names: string[];
};

export interface RestaurantBasic {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    photo_url: string | null;
}

export interface TableRestaurantHistory {
    restaurant: RestaurantBasic | null;
    visits: Visit[];
    visit_count: number;
    table_average: number | null;
    last_visit: Visit | null;
}

export interface UserRestaurantHistory {
    visits: Visit[];
    visit_count: number;
    user_average: number | null;
    last_visit: Visit | null;
}

async function fetchTableHistory(
    restaurantId: string,
    tableId: string,
    excludeNightId?: string,
): Promise<TableRestaurantHistory> {
    const params = new URLSearchParams({
        action: 'table_history',
        restaurant_id: restaurantId,
        table_id: tableId,
    });
    if (excludeNightId) params.set('exclude_night_id', excludeNightId);

    const headers = await getAuthHeaders();
    const { data, error } = await supabase.functions.invoke(
        `restaurant-history?${params.toString()}`,
        { method: 'GET', headers },
    );
    if (error) throw await unwrapInvokeError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    return (data as { data: TableRestaurantHistory }).data;
}

async function fetchUserHistory(
    restaurantId: string,
    excludeEntryId?: string,
): Promise<UserRestaurantHistory> {
    const params = new URLSearchParams({
        action: 'user_history',
        restaurant_id: restaurantId,
    });
    if (excludeEntryId) params.set('exclude_entry_id', excludeEntryId);

    const headers = await getAuthHeaders();
    const { data, error } = await supabase.functions.invoke(
        `restaurant-history?${params.toString()}`,
        { method: 'GET', headers },
    );
    if (error) throw await unwrapInvokeError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    return (data as { data: UserRestaurantHistory }).data;
}

/**
 * Table-scoped history at a restaurant.
 *
 * @param restaurantId  The restaurant id.
 * @param tableId       The table context (must be a member).
 * @param excludeNightId  Optional — omit a specific round (e.g. the one
 *                        currently being viewed on Round detail).
 */
export function useTableRestaurantHistory(
    restaurantId: string | null | undefined,
    tableId: string | null | undefined,
    excludeNightId?: string,
) {
    return useQuery({
        queryKey: queryKeys.restaurants.tableHistory(
            restaurantId ?? '',
            tableId ?? '',
            excludeNightId,
        ),
        queryFn: () => fetchTableHistory(restaurantId!, tableId!, excludeNightId),
        enabled: !!restaurantId && !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * The signed-in user's personal history at a restaurant, across any Table.
 */
export function useUserRestaurantHistory(
    restaurantId: string | null | undefined,
    userId: string | null | undefined,
    excludeEntryId?: string,
) {
    return useQuery({
        queryKey: queryKeys.restaurants.userHistory(
            restaurantId ?? '',
            userId ?? '',
            excludeEntryId,
        ),
        queryFn: () => fetchUserHistory(restaurantId!, excludeEntryId),
        enabled: !!restaurantId && !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
