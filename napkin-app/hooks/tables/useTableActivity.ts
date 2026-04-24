/**
 * Hook to fetch cursor-paginated table activity feed.
 * TICKET-035: rewrote from numeric-offset GET to cursor-based POST.
 *
 * Backed by fn_table_activity_page RPC — a UNION of entries + table_nights
 * sorted by sort_date DESC, id DESC. No more duplicates or gaps.
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';

export interface CompanionProfile {
    user_id: string;
    display_name: string;
}

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
    photo_url: string | null;
    photo_count?: number;
    reaction_count?: number;
    comment_count?: number;
    top_emojis?: Array<{ emoji: string; count: number; last_reacted_at: string }>;
    my_reactions?: string[];
    companions?: CompanionProfile[];
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
    reaction_count?: number;
    comment_count?: number;
    top_emojis?: Array<{ emoji: string; count: number; last_reacted_at: string }>;
    my_reactions?: string[];
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
    companions?: CompanionProfile[];
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

export interface TableActivityFilters {
    filterType?: string;   // 'round' | 'solo_share'
    filterUserId?: string; // UUID
}

async function fetchTableActivityPage(
    tableId: string,
    cursor: string | null,
    filters: TableActivityFilters | undefined,
    _token: string | null,
): Promise<Page<ActivityItem>> {
    const body: Record<string, unknown> = { table_id: tableId };
    if (cursor) body.cursor = cursor;
    if (filters?.filterType) body.filter_type = filters.filterType;
    if (filters?.filterUserId) body.filter_user_id = filters.filterUserId;
    return callEdgeFn<Page<ActivityItem>>('table-activity', { body });
}

export function useTableActivity(
    tableId: string | null | undefined,
    filters?: TableActivityFilters,
) {
    return useCursorPagedQuery<ActivityItem>({
        queryKey: queryKeys.tables.activity(tableId!, filters),
        fetchPage: (cursor, token) => fetchTableActivityPage(tableId!, cursor, filters, token),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages of activity items. */
export function flattenActivity(data: ReturnType<typeof useTableActivity>['data']): ActivityItem[] {
    return flattenPages(data);
}
