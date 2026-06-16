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
    /** TICKET-075: author's Letterboxd-style like. Read-only on feed/journal rows. */
    liked?: boolean;
    /** true when this entry is attached to a Table or Round (journal badge, 20260616000100). */
    is_shared?: boolean;
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
    /** Null for merged rounds (kind='merged', status=NULL). Live rounds: 'rating' | 'revealed' | 'closed'. */
    status: string | null;
    created_at: string;
    revealed_at: string | null;
    is_async: boolean;
    sort_date: string;
    average_rating: number | null;
    reaction_count?: number;
    comment_count?: number;
    top_emojis?: Array<{ emoji: string; count: number; last_reacted_at: string }>;
    my_reactions?: string[];
    /**
     * Round subtype discriminator (TICKET-044).
     * 'live'   = Round-Mode (table_nights state machine: start/rate/reveal/recap).
     * 'merged' = two solo entries bound together retroactively.
     * Undefined for rows pre-dating TICKET-044 (treat as 'live').
     */
    round_kind?: 'live' | 'merged';
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    };
    participants: {
        user_id: string;
        display_name?: string;
        avatar_url?: string | null;
        rating: number | null;
        notes: string | null;
        profiles: {
            display_name: string;
            avatar_url?: string | null;
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

export interface TopFourEditedActivity {
    type: 'top_4_edited';
    id: string;
    table_id: string;
    position: 1 | 2 | 3 | 4;
    actor_id: string;
    actor_name: string | null;
    actor_avatar_url: string | null;
    event_type: 'added' | 'removed' | 'swapped';
    prev_restaurant: { id: string; name: string | null } | null;
    next_restaurant: { id: string; name: string | null } | null;
    created_at: string;
    sort_date: string;
    my_reactions?: string[];
}

// TICKET-060: new feed item types (shape is hydrated by table-activity edge fn)
export interface SharedSaveActivityItem {
    type: 'shared_save';
    id: string;
    sort_date: string;
    table_id: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null } | null;
    restaurant: { id: string | null; name: string | null; city: string | null; cuisine: string | null; photo_url: string | null; verification?: string } | null;
    note?: string | null;
    extraction_status?: string | null;
    reaction_count: number;
    top_emojis: string[];
    my_reactions?: string[];
    created_at: string;
    // [H-6 FIX] camelCase aliases set by edge fn hydrator so SharedSaveCard props match
    shareId?: string;
    extractionStatus?: string | null;
    reactionCount?: number;
    topEmojis?: string[];
    myReactions?: string[];
    createdAt?: string;
}

export interface SharedSaveCardShapeForDigest {
    shareId: string;
    tableId: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null };
    restaurant: { id: string | null; name: string | null; city: string | null; cuisine: string | null; photo_url: string | null; verification?: string } | null;
    note?: string | null;
    extractionStatus?: string | null;
    reactionCount: number;
    topEmojis: string[];
    myReactions?: string[];
    createdAt: string;
}

export interface ShareDigestActivityItem {
    type: 'share_digest';
    id: string;
    sort_date: string;
    created_at: string;
    table_id: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null } | null;
    share_count: number;
    child_ids: string[];
    /** [H-6 FIX] Hydrated children already mapped to SharedSaveCardProps shape (camelCase) */
    childShares?: SharedSaveCardShapeForDigest[];
}

export interface RestaurantFloatActivityItem {
    type: 'restaurant_float';
    id: string;
    sort_date: string;
    created_at: string;
    float_id: string;
    table_id: string;
    restaurant: { id: string; name: string | null; city: string | null; cuisine: string | null; photo_url?: string | null } | null;
    distinct_count: number;
    members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
    first_crossed_at?: string;
}

export type ActivityItem =
    | SoloShareActivity
    | TableNightActivity
    | CollaborativeEntryActivity
    | TopFourEditedActivity
    | SharedSaveActivityItem
    | ShareDigestActivityItem
    | RestaurantFloatActivityItem;

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
