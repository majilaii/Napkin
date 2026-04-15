/**
 * Hook to fetch paginated table activity feed
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface SoloShareActivity {
    type: 'solo_share';
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string;
    created_at: string;
    sort_date: string;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: {
        display_name: string;
    };
}

export interface TableNightActivity {
    type: 'table_night';
    id: string;
    restaurant_id: string;
    host_user_id: string;
    status: string;
    created_at: string;
    revealed_at: string | null;
    is_async: boolean;
    sort_date: string;
    average_rating: number | null;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    };
    participants: {
        user_id: string;
        rating: number | null;
        notes: string | null;
        profiles: {
            display_name: string;
        };
    }[];
}

export interface CollaborativeEntryActivity {
    type: 'collaborative_entry';
    id: string;
    user_id: string;
    restaurant_id: string | null;
    visited_at: string;
    created_at: string;
    sort_date: string;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    participants: {
        user_id: string;
        rating: number | null;
        notes: string | null;
        profiles: {
            display_name: string;
        };
    }[];
    average_rating: number | null;
}

export type ActivityItem = SoloShareActivity | TableNightActivity | CollaborativeEntryActivity;

const PAGE_SIZE = 20;

export interface TableActivityFilters {
    filterType?: string;   // 'round' | 'solo_share'
    filterUserId?: string; // UUID
}

async function fetchTableActivity(
    tableId: string,
    offset: number,
    filters?: TableActivityFilters,
): Promise<ActivityItem[]> {
    const { data: { session } } = await supabase.auth.getSession();

    let url = `table-activity?table_id=${tableId}&limit=${PAGE_SIZE}&offset=${offset}`;
    if (filters?.filterType) url += `&filter_type=${encodeURIComponent(filters.filterType)}`;
    if (filters?.filterUserId) url += `&filter_user_id=${encodeURIComponent(filters.filterUserId)}`;

    const { data, error } = await supabase.functions.invoke(url, {
        method: 'GET',
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) throw error;
    return data?.data ?? [];
}

export function useTableActivity(
    tableId: string | null | undefined,
    filters?: TableActivityFilters,
) {
    return useInfiniteQuery<ActivityItem[], Error>({
        queryKey: queryKeys.tables.activity(tableId!, filters),
        queryFn: ({ pageParam }) =>
            fetchTableActivity(tableId!, pageParam as number, filters),
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.length < PAGE_SIZE) return undefined;
            return allPages.length * PAGE_SIZE;
        },
        enabled: !!tableId,
        staleTime: 1000 * 60 * 2,
    });
}
